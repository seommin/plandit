import type { INestApplication, INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { prisma } from "@plandit/database/prisma";

import { PaymentReconcileService } from "../src/payment/payment-reconcile.service";
import { WorkerModule } from "../src/worker/worker.module";
import {
  approveAtPg,
  as,
  closeTestApp,
  createTestApp,
  registerUser,
  resetDatabase,
  startMocksFor,
  waitFor,
} from "./helpers";

describe("PLANDIT-6 unsettled payment re-query (e2e)", () => {
  let app: INestApplication;
  let mocks: { base: string; stop: () => void };
  let reconcile: PaymentReconcileService;
  let owner: { id: string };
  let workspaceId: string;

  const charge = async (amount: number) =>
    (await as(app, owner.id).post(`/workspaces/${workspaceId}/payments/charge`).send({ amount }).expect(201)).body
      .payment as { id: string; tradeId: string };
  const payment = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });
  const chargeRows = (id: string) => prisma.creditLedger.count({ where: { refType: "PAYMENT", refId: id } });
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000);

  beforeAll(async () => {
    process.env.RECONCILE_MIN_AGE_MS = "0";
    app = await createTestApp();
    mocks = await startMocksFor(app, 4198);
    reconcile = app.get(PaymentReconcileService);

    await resetDatabase();
    owner = await registerUser(app, "owner");
    workspaceId = (await prisma.workspace.findUniqueOrThrow({ where: { personalOwnerId: owner.id } })).id;
  }, 30_000);

  afterAll(async () => {
    delete process.env.RECONCILE_MIN_AGE_MS;
    delete process.env.RECONCILE_EVERY_MS;
    mocks?.stop();
    await closeTestApp(app);
  });

  it("05 webhook lost: the re-query approves once; the late webhook afterwards changes nothing", async () => {
    const { id, tradeId } = await charge(10_005);
    await approveAtPg(mocks.base, id);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await payment(id)).status).toBe("RESERVE"); // the PG approved, but told us nothing

    expect(await reconcile.reconcileOne(id)).toBe("approved");
    expect((await payment(id)).status).toBe("APPROVED");
    expect(await chargeRows(id)).toBe(1);

    // The PG finally delivers the original event (operator resend = what a PG retry looks like).
    const [{ event_id: eventId }] = await prisma.$queryRaw<{ event_id: string }[]>`
      SELECT e.event_id FROM mock.pg_events e JOIN mock.pg_transactions t USING (tx_id)
      WHERE t.merchant_trade_id = ${tradeId}`;
    const resend = await fetch(`${mocks.base}/pg/v1/admin/webhooks/${eventId}/resend`, { method: "POST" });
    expect(((await resend.json()) as { httpStatus: number }).httpStatus).toBe(200);

    expect((await prisma.paymentEvent.findUniqueOrThrow({ where: { eventId } })).result).toBe("ALREADY_APPLIED");
    expect(await chargeRows(id)).toBe(1);
    expect((await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } })).balance).toBe(1_000n);
  });

  it("UNKNOWN that never reached the PG → FAILED(PG_NOT_FOUND), nothing credited", async () => {
    process.env.MOCK_PG_BASE_URL = "http://127.0.0.1:1/pg";
    const response = await as(app, owner.id).post(`/workspaces/${workspaceId}/payments/charge`).send({ amount: 7_000 }).expect(502);
    process.env.MOCK_PG_BASE_URL = `${mocks.base}/pg`;
    const id = response.body.details.paymentId as string;
    expect((await payment(id)).status).toBe("UNKNOWN");

    expect(await reconcile.reconcileOne(id)).toBe("failed");
    expect(await payment(id)).toMatchObject({ status: "FAILED", failureCode: "PG_NOT_FOUND" });
    expect(await chargeRows(id)).toBe(0);
  });

  it("not paid yet stays pending; after 24h it expires", async () => {
    const { id } = await charge(8_000); // user opened the page but never pressed approve
    expect(await reconcile.reconcileOne(id)).toBe("pending");
    expect((await payment(id)).status).toBe("RESERVE");

    expect(await reconcile.reconcileOne(id, inHours(25))).toBe("expired");
    expect(await payment(id)).toMatchObject({ status: "FAILED", failureCode: "EXPIRED" });
  });

  it("a payment the webhook already settled is left alone", async () => {
    const { id } = await charge(9_000);
    await approveAtPg(mocks.base, id);
    await waitFor(async () => (await payment(id)).status === "APPROVED");
    expect(await reconcile.reconcileOne(id)).toBe("settled");
    expect(await chargeRows(id)).toBe(1);
  });

  it("run() only picks RESERVE/UNKNOWN older than the minimum age", async () => {
    process.env.RECONCILE_MIN_AGE_MS = String(10 * 60_000);
    try {
      await charge(6_000);
      expect((await reconcile.run()).checked).toBe(0); // too fresh to bother the PG
    } finally {
      process.env.RECONCILE_MIN_AGE_MS = "0";
    }
  });

  it("the BullMQ worker process runs the job on its own schedule", async () => {
    await prisma.payment.updateMany({ where: { status: { in: ["RESERVE", "UNKNOWN"] } }, data: { status: "FAILED" } });
    const { id } = await charge(11_005); // scenario 05 again: no webhook will come
    await approveAtPg(mocks.base, id);

    process.env.RECONCILE_EVERY_MS = "300";
    const worker: INestApplicationContext = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    try {
      await waitFor(async () => (await payment(id)).status === "APPROVED", 10_000);
      expect(await chargeRows(id)).toBe(1);
    } finally {
      await worker.close();
    }
  }, 20_000);

  it("audit rows say which path settled each payment", async () => {
    const bySource = async (action: string, source: string) =>
      prisma.auditLog.count({ where: { workspaceId, action, payload: { path: ["source"], equals: source } } });
    expect(await bySource("payment.approved", "reconcile")).toBe(2); // 05 twice (direct call + worker)
    expect(await bySource("payment.approved", "webhook")).toBe(1); // the one the webhook won
    expect(await bySource("payment.failed", "reconcile")).toBe(1); // PG_NOT_FOUND
    expect(await bySource("payment.expired", "reconcile")).toBe(1);
  });
});
