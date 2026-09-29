import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { prisma } from "@plandit/database/prisma";

import { ReminderQueue } from "../src/reminder/reminder.queue";
import { approveAtPg, as, closeTestApp, createTestApp, registerUser, resetDatabase, startMocksFor } from "./helpers";

const TOKEN = "e2e-metrics-token";

/** Value of one sample line, e.g. metric('plandit_payments_unsettled', 'status="RESERVE"'). */
const sample = (text: string, name: string, labels = "") => {
  const line = text.split("\n").find((l) => l.startsWith(`${name}${labels ? `{${labels}` : ""}`) && !l.startsWith("#"));
  return line ? Number(line.split(" ").pop()) : undefined;
};

describe("PLANDIT-14 monitoring + runbook recovery (e2e)", () => {
  let app: INestApplication;
  let mocks: { base: string; stop: () => void };
  let owner: { id: string; email: string };
  let operator: { id: string; email: string };
  let workspaceId: string;

  const scrape = async () =>
    (await request(app.getHttpServer()).get("/metrics").set("authorization", `Bearer ${TOKEN}`).expect(200)).text;

  beforeAll(async () => {
    process.env.METRICS_TOKEN = TOKEN;
    app = await createTestApp();
    mocks = await startMocksFor(app, 4196);
    await resetDatabase();
    [owner, operator] = await Promise.all(["owner", "operator"].map((n) => registerUser(app, n)));
    process.env.PLATFORM_ADMIN_EMAILS = operator.email;
    workspaceId = (await prisma.workspace.findUniqueOrThrow({ where: { personalOwnerId: owner.id } })).id;
  }, 30_000);

  afterAll(async () => {
    delete process.env.METRICS_TOKEN;
    mocks?.stop();
    await closeTestApp(app);
  });

  it("/metrics requires the token and exposes HTTP metrics by route pattern", async () => {
    await request(app.getHttpServer()).get("/metrics").expect(401);
    await as(app, owner.id).get(`/workspaces/${workspaceId}/credits`).expect(200);

    const text = await scrape();
    expect(sample(text, "plandit_http_requests_total", 'method="GET",route="/workspaces/:workspaceId/credits",status="200"')).toBeGreaterThanOrEqual(1);
    expect(text).not.toContain(workspaceId); // raw ids never become labels
    expect(text).toContain('plandit_queue_jobs{queue="reminders",state="waiting"}');
  });

  it("forged webhooks show up as invalid_signature", async () => {
    await request(app.getHttpServer()).post("/webhooks/payments/mock").set("x-mock-signature", "bad").send({}).expect(401);
    expect(sample(await scrape(), "plandit_webhook_events_total", 'source="pg",result="invalid_signature"')).toBe(1);
  });

  it("runbook: lost webhook → metric shows a stuck payment → operator forces the re-query → metric back to 0", async () => {
    // 1. Incident: scenario 05, the PG approved but never told us.
    const charged = await as(app, owner.id).post(`/workspaces/${workspaceId}/payments/charge`).send({ amount: 10_005 }).expect(201);
    await approveAtPg(mocks.base, charged.body.payment.id);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 2. Detect: the dashboard/alert metric.
    let text = await scrape();
    expect(sample(text, "plandit_payments_unsettled", 'status="RESERVE"')).toBe(1);
    expect(sample(text, "plandit_payments_unsettled_oldest_seconds")).toBeGreaterThan(0);

    // 3. Recover: runbook command (operator only).
    await as(app, owner.id).post("/admin/jobs/payment-reconcile?minAgeMs=0").expect(403);
    const run = await as(app, operator.id)
      .post("/admin/jobs/payment-reconcile?minAgeMs=0")
      .set("x-trace-id", "runbook-incident-42")
      .expect(201);
    expect(run.body).toMatchObject({ checked: 1, approved: 1 });

    // 4. Verify: metric back to normal, credits granted once, and the audit row points at the operator's call.
    text = await scrape();
    expect(sample(text, "plandit_payments_unsettled", 'status="RESERVE"')).toBe(0);
    expect(sample(text, "plandit_ledger_appends_total", 'type="CHARGE",outcome="applied"')).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "payment.approved", targetId: charged.body.payment.id } });
    expect(audit).toMatchObject({ traceId: "runbook-incident-42", payload: { source: "reconcile" } });
  });

  it("runbook: a drifted balance cache is rebuilt from the ledger", async () => {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } });
    await prisma.$executeRaw`UPDATE "CreditAccount" SET "balance" = 424242 WHERE "id" = ${account.id}`;
    const fixed = await as(app, operator.id).post(`/admin/credit-accounts/${account.id}/recalculate`).expect(201);
    expect(fixed.body).toEqual({ accountId: account.id, before: 424242, after: 1_000 });
  });

  it("the trace id of the request that set a reminder travels with its job", async () => {
    const start = new Date(Date.now() + 3_600_000);
    const created = await as(app, owner.id)
      .post("/events")
      .send({ title: "추적", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString() })
      .expect(201);
    await as(app, owner.id)
      .put(`/events/${created.body.event.id}/reminders`)
      .set("x-trace-id", "trace-reminder-7")
      .send({ reminders: [{ minutesBefore: 10, channel: "PUSH" }] })
      .expect(200);

    const [reminder] = await prisma.eventReminder.findMany({ where: { eventId: created.body.event.id } });
    const job = await app.get(ReminderQueue).queue.getJob(`fire_${reminder.id}_${start.getTime() - 600_000}`);
    expect(job?.data.traceId).toBe("trace-reminder-7");
  });
});
