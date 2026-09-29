import { createHmac } from "crypto";

import type { INestApplication, INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";

import { prisma } from "@plandit/database/prisma";

import { LedgerService } from "../src/credit/ledger.service";
import { ReminderDispatchService } from "../src/reminder/reminder-dispatch.service";
import { fireAtFor } from "../src/reminder/reminder-time";
import { ReminderQueue } from "../src/reminder/reminder.queue";
import { WorkerModule } from "../src/worker/worker.module";
import { as, closeTestApp, createTestApp, MOCK_RELAY_SECRET, registerUser, resetDatabase, startMocksFor, waitFor } from "./helpers";

describe("PLANDIT-7 reminder delivery queue (e2e: api + BullMQ worker + mock carrier)", () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let mocks: { base: string; stop: () => void };
  let owner: { id: string; email: string };
  let ownerWorkspaceId: string;
  const apiWebhookUrl = () => process.env.RELAY_WEBHOOK_URL!;

  const createEvent = async (userId: string, startsInMs: number, title = "팀 회의") => {
    const startsAt = new Date(Date.now() + startsInMs);
    const response = await as(app, userId)
      .post("/events")
      .send({ title, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString() })
      .expect(201);
    return response.body.event as { id: string };
  };
  const setReminders = (userId: string, eventId: string, reminders: object[]) =>
    as(app, userId).put(`/events/${eventId}/reminders`).send({ reminders });
  const deliveriesOf = (eventId: string) =>
    prisma.reminderDelivery.findMany({ where: { reminder: { eventId } }, orderBy: { queuedAt: "asc" } });
  const settledDeliveries = (eventId: string, expected: number, timeoutMs = 15_000) =>
    waitFor(async () => {
      const rows = await deliveriesOf(eventId);
      return rows.length === expected && rows.every((d) => !["QUEUED", "SENT"].includes(d.status)) ? rows : null;
    }, timeoutMs);
  const ledgerFor = (deliveryIds: string[], type: "DEBIT" | "REFUND") =>
    prisma.creditLedger.findMany({ where: { refType: "REMINDER_DELIVERY", refId: { in: deliveryIds }, type } });
  const balanceOf = async (workspaceId: string) =>
    (await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } })).balance;
  const charge = async (workspaceId: string, credits: number) => {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } });
    await app.get(LedgerService).append({
      accountId: account.id, type: "CHARGE", amount: credits, refType: "MANUAL", refId: `seed-${workspaceId}`,
      idempotencyKey: `TEST:seed:${workspaceId}:${credits}`,
    });
  };

  beforeAll(async () => {
    Object.assign(process.env, { RELAY_BACKOFF_MS: "100", RELAY_SEND_ATTEMPTS: "10", RELAY_RECONCILE_EVERY_MS: "3600000" });
    app = await createTestApp();
    mocks = await startMocksFor(app, 4197, { RELAY_FAIL_RATE: "0", RELAY_DELAY_MS: "50", RELAY_RPS: "25" });
    await app.get(ReminderQueue).queue.obliterate({ force: true }); // leftovers from earlier runs
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });

    await resetDatabase();
    owner = await registerUser(app, "owner");
    ownerWorkspaceId = (await prisma.workspace.findUniqueOrThrow({ where: { personalOwnerId: owner.id } })).id;
    await as(app, owner.id).patch("/me").send({ phone: "010-0000-1234" }).expect(200);
    await charge(ownerWorkspaceId, 500);
  }, 30_000);

  afterAll(async () => {
    await worker?.close();
    mocks?.stop();
    await closeTestApp(app);
  });

  it("validates the reminder list and phone numbers", async () => {
    const event = await createEvent(owner.id, 3_600_000);
    const dup = { minutesBefore: 10, channel: "SMS" };
    await setReminders(owner.id, event.id, [dup, dup]).expect(400);
    await as(app, owner.id).patch("/me").send({ phone: "12345" }).expect(400);
    const ok = await setReminders(owner.id, event.id, [dup, { minutesBefore: 60, channel: "PUSH" }]).expect(200);
    expect(ok.body.reminders).toHaveLength(2);
  });

  it("SMS: debit 1 credit → carrier → DELIVERED, and the text shows up in the virtual inbox", async () => {
    const before = await balanceOf(ownerWorkspaceId);
    const event = await createEvent(owner.id, 61_000, "주간 보고"); // fires ~1s from now (1 minute before start)
    await setReminders(owner.id, event.id, [{ minutesBefore: 1, channel: "SMS" }]).expect(200);

    const [delivery] = await settledDeliveries(event.id, 1);
    expect(delivery).toMatchObject({ status: "DELIVERED", credits: 1, toPhone: "01000001234" });
    expect(await ledgerFor([delivery.id], "DEBIT")).toHaveLength(1);
    expect(await balanceOf(ownerWorkspaceId)).toBe(before - 1n);
    expect(await (await fetch(`${mocks.base}/inbox?phone=010-0000-1234`)).text()).toContain("주간 보고");
  });

  it("moving the event: the old fire time sends nothing, a job exists for the new time", async () => {
    const event = await createEvent(owner.id, 62_000); // would fire in ~2s
    await setReminders(owner.id, event.id, [{ minutesBefore: 1, channel: "SMS" }]).expect(200);
    const newStart = new Date(Date.now() + 2 * 3_600_000);
    await as(app, owner.id)
      .patch(`/events/${event.id}`)
      .send({ startsAt: newStart.toISOString(), endsAt: new Date(newStart.getTime() + 3_600_000).toISOString() })
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 3_500));
    expect(await deliveriesOf(event.id)).toHaveLength(0);

    const [reminder] = await prisma.eventReminder.findMany({ where: { eventId: event.id } });
    const newFireAt = fireAtFor({ startsAt: newStart, allDay: false }, 1, "Asia/Seoul");
    expect(await app.get(ReminderQueue).queue.getJob(`fire_${reminder.id}_${newFireAt.getTime()}`)).toBeDefined();
  });

  describe("100 recipients, 30 of them with numbers the carrier rejects (+ 429 back-off at 25 req/s)", () => {
    let eventId: string;
    let rows: Awaited<ReturnType<typeof deliveriesOf>>;
    let balanceBefore: bigint;

    beforeAll(async () => {
      await prisma.user.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          email: `guest${i}@test.plandit.dev`,
          name: `guest${i}`,
          phone: `0100000${String(i).padStart(3, "0")}${i < 30 ? 9 : 1}`, // ends in 9 → INVALID_NUMBER
        })),
      });
      const guests = await prisma.user.findMany({ where: { email: { startsWith: "guest" } }, select: { id: true, email: true } });

      balanceBefore = await balanceOf(ownerWorkspaceId);
      eventId = (await createEvent(owner.id, 61_000, "전사 공지")).id;
      await prisma.eventAttendee.createMany({ data: guests.map((g) => ({ eventId, userId: g.id, email: g.email })) });
      await setReminders(owner.id, eventId, [{ minutesBefore: 1, channel: "SMS", audience: "ATTENDEES" }]).expect(200);

      rows = await settledDeliveries(eventId, 101, 45_000);
    }, 60_000);

    it("every delivery ends DELIVERED or FAILED(INVALID_NUMBER)", () => {
      expect(rows.filter((d) => d.status === "DELIVERED")).toHaveLength(71); // 70 guests + owner
      expect(rows.filter((d) => d.status === "FAILED").every((d) => d.failCode === "INVALID_NUMBER")).toBe(true);
      expect(rows.filter((d) => d.status === "FAILED")).toHaveLength(30);
    });

    it("invariant: debited = delivered + refunded, and no double refund", async () => {
      const ids = rows.map((d) => d.id);
      const debits = await ledgerFor(ids, "DEBIT");
      const refunds = await ledgerFor(ids, "REFUND");
      const debited = -debits.reduce((sum, e) => sum + e.amount, 0n);
      const refunded = refunds.reduce((sum, e) => sum + e.amount, 0n);
      const delivered = BigInt(rows.filter((d) => d.status === "DELIVERED").reduce((sum, d) => sum + d.credits, 0));

      expect(debited).toBe(delivered + refunded);
      expect(debits).toHaveLength(101);
      expect(refunds).toHaveLength(30);
      expect(new Set(refunds.map((r) => r.refId)).size).toBe(30);
      expect(await balanceOf(ownerWorkspaceId)).toBe(balanceBefore - delivered);
    });

    it("the carrier's rate limit really kicked in: sends were retried with back-off", async () => {
      const completed = await app.get(ReminderQueue).queue.getCompleted(0, 1_000);
      const retried = completed.filter((job) => job.name === "send" && job.attemptsMade > 1);
      expect(retried.length).toBeGreaterThan(0);
    });

    it("a repeated result webhook refunds nothing more", async () => {
      const failed = rows.find((d) => d.status === "FAILED")!;
      const [{ event_id: resultEventId }] = await prisma.$queryRaw<{ event_id: string }[]>`
        SELECT event_id FROM mock.relay_messages WHERE msg_id = ${failed.relayMsgId}`;
      const resend = await fetch(`${mocks.base}/relay/v1/admin/webhooks/${resultEventId}/resend`, { method: "POST" });
      expect(((await resend.json()) as { httpStatus: number }).httpStatus).toBe(200);

      expect(await prisma.relayEvent.count({ where: { eventId: resultEventId } })).toBe(1);
      expect(await ledgerFor([failed.id], "REFUND")).toHaveLength(1);
    });

    it("a late FAILED for a delivered message (new eventId) is recorded but does not refund", async () => {
      const delivered = rows.find((d) => d.status === "DELIVERED")!;
      const raw = JSON.stringify({ eventId: "evt_late_fail", msgId: delivered.relayMsgId, clientRef: delivered.id, status: "FAILED", failCode: "LATE", occurredAt: new Date().toISOString() });
      const response = await request(app.getHttpServer())
        .post("/webhooks/relay/mock")
        .set("content-type", "application/json")
        .set("x-mock-signature", createHmac("sha256", MOCK_RELAY_SECRET).update(raw).digest("hex"))
        .send(raw)
        .expect(200);
      expect(response.body.result).toBe("ALREADY_APPLIED");
      expect(await ledgerFor([delivered.id], "REFUND")).toHaveLength(0);
    });

    it("forged result webhooks are rejected", async () => {
      await request(app.getHttpServer())
        .post("/webhooks/relay/mock")
        .set("content-type", "application/json")
        .set("x-mock-signature", "deadbeef")
        .send(JSON.stringify({ eventId: "evt_forged", msgId: "x", clientRef: null, status: "FAILED", failCode: null }))
        .expect(401);
      expect(await prisma.relayEvent.count({ where: { eventId: "evt_forged" } })).toBe(0);
    });
  });

  it("not enough credits: SKIPPED, nothing charged, push fallback attempted", async () => {
    const poor = await registerUser(app, "poor");
    await as(app, poor.id).patch("/me").send({ phone: "010-0000-5555" }).expect(200);
    const event = await createEvent(poor.id, 61_000);
    await setReminders(poor.id, event.id, [{ minutesBefore: 1, channel: "SMS" }]).expect(200);

    const [delivery] = await settledDeliveries(event.id, 1);
    expect(delivery).toMatchObject({ status: "SKIPPED", failCode: "INSUFFICIENT_CREDITS", fallback: "PUSH_UNAVAILABLE" });
    expect(await ledgerFor([delivery.id], "DEBIT")).toHaveLength(0);
  });

  it("PUSH is free: delivered through the push provider without touching credits", async () => {
    const pushUser = await registerUser(app, "pusher");
    await prisma.pushSubscription.create({ data: { userId: pushUser.id, provider: "NOOP", endpoint: "noop://device-1" } });
    const event = await createEvent(pushUser.id, 61_000);
    await setReminders(pushUser.id, event.id, [{ minutesBefore: 1, channel: "PUSH" }]).expect(200);

    const [delivery] = await settledDeliveries(event.id, 1);
    expect(delivery).toMatchObject({ status: "DELIVERED", credits: 0 });
    expect(await prisma.creditLedger.count({ where: { refId: delivery.id } })).toBe(0);
  });

  it("lost result webhook: the re-query job settles the delivery from the carrier's record", async () => {
    const realWebhook = apiWebhookUrl();
    process.env.RELAY_WEBHOOK_URL = "http://127.0.0.1:1/nowhere"; // the carrier's callback will never arrive
    try {
      const event = await createEvent(owner.id, 61_000, "결과 유실");
      await setReminders(owner.id, event.id, [{ minutesBefore: 1, channel: "SMS" }]).expect(200);
      const [sent] = await waitFor(async () => {
        const rows = await deliveriesOf(event.id);
        return rows[0]?.status === "SENT" ? rows : null;
      }, 10_000);
      await new Promise((resolve) => setTimeout(resolve, 300)); // carrier decides (DELIVERED) but can't tell us

      const summary = await worker.get(ReminderDispatchService).reconcileSent(new Date(Date.now() + 11 * 60_000));
      expect(summary.settled).toBeGreaterThanOrEqual(1);
      expect((await prisma.reminderDelivery.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe("DELIVERED");
    } finally {
      process.env.RELAY_WEBHOOK_URL = realWebhook;
    }
  }, 20_000);

  it("ADMIN can list the workspace's deliveries", async () => {
    const response = await as(app, owner.id).get(`/workspaces/${ownerWorkspaceId}/reminder-deliveries?status=FAILED&limit=5`).expect(200);
    expect(response.body.items).toHaveLength(5);
    expect(response.body.items[0]).toMatchObject({ status: "FAILED", refunded: true });
  });
});
