import { Inject, Injectable, Logger } from "@nestjs/common";

import { Prisma, prisma, type ReminderDelivery } from "@plandit/database/prisma";
import { CHANNEL_CREDITS } from "@plandit/shared/reminders";

import { ApiError, ErrorCode } from "../common/api-error";
import { LedgerService } from "../credit/ledger.service";
import { reminderDeliveries } from "../metrics/metrics";
import { MESSAGE_PROVIDER, type MessageProvider, MessageProviderError } from "./message-provider";
import { sendPushToUser } from "./push-sender";
import { fireAtFor } from "./reminder-time";
import { ReminderQueue } from "./reminder.queue";

type Tx = Prisma.TransactionClient;
export type SettleResult = "APPLIED" | "ALREADY_APPLIED";

function composeMessage(event: { title: string; startsAt: Date; allDay: boolean; location: string | null }, timeZone: string) {
  const when = event.allDay
    ? "오늘"
    : new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(event.startsAt);
  return `[Plandit] ${when} ${event.title}${event.location ? ` @${event.location}` : ""}`.slice(0, 90);
}

/**
 * Worker side. fire() fans a reminder out into one ReminderDelivery per recipient (written QUEUED first), send()
 * delivers one of them, settle() records the carrier's verdict. Money rule: a paid delivery is debited before the
 * carrier call and refunded exactly once if it fails — keys REMINDER_DELIVERY:{id}:DEBIT / :REFUND.
 */
@Injectable()
export class ReminderDispatchService {
  private readonly logger = new Logger(ReminderDispatchService.name);

  constructor(
    @Inject(MESSAGE_PROVIDER) private readonly carrier: MessageProvider,
    private readonly ledger: LedgerService,
    private readonly queue: ReminderQueue,
  ) {}

  async fire(reminderId: string, fireAtIso: string, traceId?: string) {
    const reminder = await prisma.eventReminder.findUnique({
      where: { id: reminderId },
      include: {
        event: {
          include: {
            calendar: { select: { timezone: true, workspaceId: true } },
            attendees: { where: { userId: { not: null } }, select: { userId: true } },
          },
        },
      },
    });
    if (!reminder || reminder.event.status === "CANCELLED") return { status: "stale" as const, deliveries: 0 };

    const { event } = reminder;
    const fireAt = fireAtFor(event, reminder.minutesBefore, event.calendar.timezone);
    if (fireAt.getTime() !== new Date(fireAtIso).getTime()) return { status: "stale" as const, deliveries: 0 }; // event moved

    const recipients = new Set([event.createdById]);
    if (reminder.audience === "ATTENDEES") event.attendees.forEach((a) => recipients.add(a.userId!));

    await prisma.reminderDelivery.createMany({
      data: [...recipients].map((userId) => ({
        reminderId,
        userId,
        workspaceId: event.calendar.workspaceId,
        channel: reminder.channel,
        fireAt,
        credits: CHANNEL_CREDITS[reminder.channel],
      })),
      skipDuplicates: true, // a retried fire job must not create a second delivery per person
    });
    const queued = await prisma.reminderDelivery.findMany({
      where: { reminderId, fireAt, status: "QUEUED" },
      select: { id: true },
    });
    await this.queue.enqueueSends(queued.map((d) => d.id), traceId, reminder.channel !== "PUSH");
    return { status: "fired" as const, deliveries: queued.length };
  }

  /** `finalAttempt`: no more BullMQ retries left, so a retryable carrier error becomes a failure (and a refund). */
  async send(deliveryId: string, finalAttempt: boolean) {
    const delivery = await prisma.reminderDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        user: { select: { phone: true } },
        reminder: {
          include: {
            event: { select: { title: true, startsAt: true, allDay: true, location: true, calendar: { select: { timezone: true } } } },
          },
        },
      },
    });
    if (!delivery || delivery.status !== "QUEUED") return "noop";

    const event = delivery.reminder?.event;
    if (!event) return this.settle(deliveryId, { status: "SKIPPED", failCode: "EVENT_DELETED" });
    const body = composeMessage(event, event.calendar.timezone);

    if (delivery.channel === "PUSH") {
      const sent = await sendPushToUser(delivery.userId, { title: event.title, body });
      return this.settle(deliveryId, sent ? { status: "DELIVERED", failCode: null } : { status: "FAILED", failCode: "NO_PUSH_SUBSCRIPTION" });
    }

    const phone = delivery.user.phone;
    if (!phone) return this.skipWithPushFallback(delivery, "NO_PHONE", event.title, body);

    if (!delivery.debitLedgerId) {
      try {
        await this.debit(delivery, phone);
      } catch (error) {
        if (error instanceof ApiError && error.code === ErrorCode.INSUFFICIENT_CREDITS) {
          return this.skipWithPushFallback(delivery, "INSUFFICIENT_CREDITS", event.title, body);
        }
        throw error;
      }
    }

    let msgId: string;
    try {
      ({ msgId } = await this.carrier.send({
        to: phone,
        body,
        kind: delivery.channel === "ALIMTALK" ? "ALIMTALK" : "SMS",
        clientRef: delivery.id, // carrier-side idempotency: a retry after a lost response can't send twice
      }));
    } catch (error) {
      if (error instanceof MessageProviderError && error.retryable && !finalAttempt) throw error; // BullMQ backs off
      this.logger.warn({ deliveryId, err: error }, "Carrier gave up on delivery");
      return this.settle(deliveryId, {
        status: "FAILED",
        failCode: error instanceof MessageProviderError && error.retryable ? "RELAY_UNAVAILABLE" : "RELAY_REJECTED",
      });
    }

    // The result webhook may already have settled it; only move forward from QUEUED.
    await prisma.reminderDelivery.updateMany({ where: { id: deliveryId, relayMsgId: null }, data: { relayMsgId: msgId } });
    await prisma.reminderDelivery.updateMany({
      where: { id: deliveryId, status: "QUEUED" },
      data: { status: "SENT", sentAt: new Date() },
    });
    return "sent";
  }

  private async debit(delivery: ReminderDelivery, phone: string) {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId: delivery.workspaceId } });
    await prisma.$transaction(async (tx) => {
      const { entry } = await this.ledger.append(
        {
          accountId: account.id,
          type: "DEBIT",
          amount: -delivery.credits,
          refType: "REMINDER_DELIVERY",
          refId: delivery.id,
          idempotencyKey: `REMINDER_DELIVERY:${delivery.id}:DEBIT`,
        },
        tx,
      );
      await tx.reminderDelivery.update({ where: { id: delivery.id }, data: { debitLedgerId: entry.id, toPhone: phone } });
    });
  }

  private async skipWithPushFallback(delivery: ReminderDelivery, reason: string, title: string, body: string) {
    const pushed = await sendPushToUser(delivery.userId, { title, body });
    const { count } = await prisma.reminderDelivery.updateMany({
      where: { id: delivery.id, status: "QUEUED" },
      data: { status: "SKIPPED", failCode: reason, fallback: pushed ? "PUSH_SENT" : "PUSH_UNAVAILABLE", resultAt: new Date() },
    });
    if (count) reminderDeliveries.inc({ channel: delivery.channel, status: "SKIPPED" });
    return "skipped";
  }

  /**
   * Final state of a delivery, from the webhook, the re-query job, or the sender giving up. Locks the row, moves
   * only from QUEUED/SENT, and refunds a debited delivery that FAILED — once, by ledger key.
   */
  async settle(
    deliveryId: string,
    outcome: { status: "DELIVERED" | "FAILED" | "SKIPPED"; failCode: string | null },
    outerTx?: Tx,
  ): Promise<SettleResult> {
    const run = async (tx: Tx): Promise<SettleResult> => {
      await tx.$queryRaw`SELECT "id" FROM "ReminderDelivery" WHERE "id" = ${deliveryId} FOR UPDATE`;
      const delivery = await tx.reminderDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
      if (delivery.status !== "QUEUED" && delivery.status !== "SENT") return "ALREADY_APPLIED";

      let refundLedgerId: bigint | undefined;
      if (outcome.status !== "DELIVERED" && delivery.debitLedgerId) {
        const account = await tx.creditAccount.findUniqueOrThrow({ where: { workspaceId: delivery.workspaceId } });
        const { entry } = await this.ledger.append(
          {
            accountId: account.id,
            type: "REFUND",
            amount: delivery.credits,
            refType: "REMINDER_DELIVERY",
            refId: delivery.id,
            idempotencyKey: `REMINDER_DELIVERY:${delivery.id}:REFUND`,
          },
          tx,
        );
        refundLedgerId = entry.id;
      }
      await tx.reminderDelivery.update({
        where: { id: deliveryId },
        data: { status: outcome.status, failCode: outcome.failCode, resultAt: new Date(), refundLedgerId },
      });
      reminderDeliveries.inc({ channel: delivery.channel, status: outcome.status });
      return "APPLIED";
    };
    return outerTx ? run(outerTx) : prisma.$transaction(run, { maxWait: 10_000, timeout: 10_000 });
  }

  /** Deliveries accepted by the carrier but with no result after RELAY_RESULT_TIMEOUT_MS: ask the carrier. */
  async reconcileSent(now = new Date(), minAgeMs = Number(process.env.RELAY_RESULT_TIMEOUT_MS ?? 10 * 60_000)) {
    const stale = await prisma.reminderDelivery.findMany({
      where: { status: "SENT", sentAt: { lte: new Date(now.getTime() - minAgeMs) } },
      take: 100,
      select: { id: true, relayMsgId: true },
    });
    const summary = { checked: 0, settled: 0, pending: 0, errors: 0 };
    for (const delivery of stale) {
      summary.checked++;
      try {
        const result = await this.carrier.lookup(delivery.relayMsgId!);
        if (result?.status === "ACCEPTED") {
          summary.pending++;
          continue;
        }
        await this.settle(
          delivery.id,
          result ? { status: result.status, failCode: result.failCode } : { status: "FAILED", failCode: "RELAY_LOST" },
        );
        summary.settled++;
      } catch (error) {
        summary.errors++;
        this.logger.error({ deliveryId: delivery.id, err: error }, "Delivery re-query failed");
      }
    }
    if (summary.checked) this.logger.log(summary, "Delivery re-query finished");
    return summary;
  }
}
