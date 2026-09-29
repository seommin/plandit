import { Inject, Injectable, Logger } from "@nestjs/common";

import { Prisma, prisma } from "@plandit/database/prisma";

import { ApiError, ErrorCode } from "../common/api-error";
import { webhookEvents } from "../metrics/metrics";
import { MESSAGE_PROVIDER, type MessageProvider } from "./message-provider";
import { ReminderDispatchService } from "./reminder-dispatch.service";

/** Carrier result webhook: signature → event (eventId unique) → settle the delivery (refund on failure), one transaction. */
@Injectable()
export class RelayWebhookService {
  private readonly logger = new Logger(RelayWebhookService.name);

  constructor(
    @Inject(MESSAGE_PROVIDER) private readonly carrier: MessageProvider,
    private readonly dispatch: ReminderDispatchService,
  ) {}

  async handle(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const event = this.carrier.parseWebhook(rawBody, headers);
    if (!event) {
      webhookEvents.inc({ source: "relay", result: "invalid_signature" });
      throw new ApiError(ErrorCode.UNAUTHORIZED, "Invalid webhook signature.");
    }

    const outcome = await prisma.$transaction(
      async (tx) => {
        const { count } = await tx.relayEvent.createMany({
          data: [{ eventId: event.eventId, status: event.status, payload: event.raw as Prisma.InputJsonValue, result: "PENDING" }],
          skipDuplicates: true,
        });
        if (count === 0) return { eventId: event.eventId, result: "DUPLICATE_EVENT" };

        // clientRef is our delivery id; msgId covers carriers that don't echo it.
        const delivery = await tx.reminderDelivery.findFirst({
          where: { OR: [...(event.clientRef ? [{ id: event.clientRef }] : []), { relayMsgId: event.msgId }] },
          select: { id: true },
        });
        if (!delivery) {
          this.logger.warn({ eventId: event.eventId, msgId: event.msgId }, "Result for unknown delivery");
          await tx.relayEvent.update({ where: { eventId: event.eventId }, data: { result: "UNKNOWN_DELIVERY" } });
          return { eventId: event.eventId, result: "UNKNOWN_DELIVERY" };
        }

        await tx.reminderDelivery.updateMany({ where: { id: delivery.id, relayMsgId: null }, data: { relayMsgId: event.msgId } });
        const result = await this.dispatch.settle(delivery.id, { status: event.status, failCode: event.failCode }, tx);
        await tx.relayEvent.update({ where: { eventId: event.eventId }, data: { result, deliveryId: delivery.id } });
        return { eventId: event.eventId, result };
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
    webhookEvents.inc({ source: "relay", result: outcome.result });
    return outcome;
  }
}
