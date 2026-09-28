import { type ChildProcess, spawn } from "child_process";
import { createHmac } from "crypto";
import type { AddressInfo } from "net";
import path from "path";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { prisma } from "@plandit/database/prisma";

import { as, closeTestApp, createTestApp, registerUser, resetDatabase } from "./helpers";

const SECRET = "e2e-mock-pg-secret";
const MOCKS_PORT = 4199;

const waitFor = async <T>(check: () => Promise<T | undefined | null | false>, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

/** Signs like the mock PG does, to craft webhooks the PG itself wouldn't send in these scenarios. */
const signedWebhook = (app: INestApplication, payload: object, secret = SECRET) => {
  const raw = JSON.stringify(payload);
  return request(app.getHttpServer())
    .post("/webhooks/payments/mock")
    .set("content-type", "application/json")
    .set("x-mock-signature", createHmac("sha256", secret).update(raw).digest("hex"))
    .send(raw);
};

describe("PLANDIT-5 charge flow (e2e, with the real mock PG process)", () => {
  let app: INestApplication;
  let mocks: ChildProcess;
  let owner: { id: string; email: string };
  let member: { id: string; email: string };
  let workspaceId: string;
  let accountId: string;
  const mocksBase = `http://127.0.0.1:${MOCKS_PORT}`;

  const charge = async (amount: number) => {
    const response = await as(app, owner.id).post(`/workspaces/${workspaceId}/payments/charge`).send({ amount }).expect(201);
    return response.body.payment as { id: string; tradeId: string; status: string; paymentPageUrl: string; credits: number };
  };
  /** The user pressing "approve" on the PG page. */
  const approveAtPg = async (paymentId: string) => {
    const { providerTxId } = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const response = await fetch(`${mocksBase}/pg/v1/payments/${providerTxId}/confirm`, { method: "POST" });
    expect(response.ok).toBe(true);
  };
  const statusOf = async (paymentId: string) => (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status;
  const chargeRows = (paymentId: string) => prisma.creditLedger.count({ where: { refType: "PAYMENT", refId: paymentId } });

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0, "127.0.0.1");
    const apiPort = (app.getHttpServer().address() as AddressInfo).port;

    process.env.MOCK_PG_BASE_URL = `${mocksBase}/pg`;
    process.env.MOCK_PG_WEBHOOK_SECRET = SECRET;
    process.env.PAYMENT_WEBHOOK_URL = `http://127.0.0.1:${apiPort}/webhooks/payments/mock`;

    mocks = spawn(process.execPath, ["src/main.ts"], {
      cwd: path.resolve(__dirname, "../../mocks"),
      env: {
        ...process.env,
        MOCKS_PORT: String(MOCKS_PORT),
        MOCKS_PUBLIC_URL: mocksBase,
        MOCK_PG_WEBHOOK_SECRET: SECRET,
        MOCK_PG_WEBHOOK_DELAY_MS: "100",
        MOCK_PG_SLOW_MS: "200",
      },
      stdio: "ignore",
    });
    await waitFor(() => fetch(`${mocksBase}/health`).then((r) => r.ok).catch(() => false), 15_000);

    await resetDatabase();
    [owner, member] = await Promise.all(["owner", "member"].map((name) => registerUser(app, name)));
    const team = await as(app, owner.id).post("/workspaces").send({ name: "충전팀" }).expect(201);
    workspaceId = team.body.workspace.id;
    await as(app, owner.id).post(`/workspaces/${workspaceId}/members`).send({ email: member.email }).expect(201);
    accountId = (await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } })).id;
  }, 30_000);

  afterAll(async () => {
    mocks?.kill();
    await closeTestApp(app);
  });

  it("00 normal: RESERVE is saved before the PG call; the webhook grants credits exactly once", async () => {
    const payment = await charge(10_000);
    expect(payment).toMatchObject({ status: "RESERVE", credits: 1_000 });
    expect(payment.tradeId).toMatch(/^P\d{6}-\d{6}$/);
    expect(payment.paymentPageUrl).toMatch(`${mocksBase}/pg/pay/`);
    expect(await chargeRows(payment.id)).toBe(0); // nothing granted before the PG confirms

    await approveAtPg(payment.id);
    await waitFor(async () => (await statusOf(payment.id)) === "APPROVED");

    expect(await chargeRows(payment.id)).toBe(1);
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { events: true } });
    expect(stored.ledgerId).not.toBeNull();
    expect(stored.events.map((e) => e.result)).toEqual(["APPLIED"]);
    expect((await prisma.creditAccount.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(1_000n);
  });

  it("03 duplicate delivery: the same eventId twice → 1 event row, 1 ledger row", async () => {
    const payment = await charge(10_003);
    await approveAtPg(payment.id);
    await waitFor(async () => {
      const [row] = await prisma.$queryRaw<{ sent: number }[]>`
        SELECT COALESCE(SUM(sent_count), 0)::int AS sent FROM mock.pg_events e
        JOIN mock.pg_transactions t USING (tx_id) WHERE t.merchant_trade_id = ${payment.tradeId}`;
      return row.sent === 2;
    });

    expect(await statusOf(payment.id)).toBe("APPROVED");
    expect(await prisma.paymentEvent.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(await chargeRows(payment.id)).toBe(1);
  });

  it("a different eventId for an already approved payment is stored but changes nothing", async () => {
    const payment = await prisma.payment.findFirstOrThrow({ where: { workspaceId, status: "APPROVED" } });
    const before = await prisma.creditAccount.findUniqueOrThrow({ where: { id: accountId } });

    const response = await signedWebhook(app, {
      eventId: "evt_replayed_elsewhere",
      txId: payment.providerTxId,
      merchantTradeId: payment.tradeId,
      type: "APPROVED",
      amount: payment.amount,
      method: "CARD",
      failureCode: null,
      occurredAt: new Date().toISOString(),
    }).expect(200);

    expect(response.body.result).toBe("ALREADY_APPLIED");
    expect(await prisma.paymentEvent.findUnique({ where: { eventId: "evt_replayed_elsewhere" } })).not.toBeNull();
    expect(await chargeRows(payment.id)).toBe(1);
    expect((await prisma.creditAccount.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(before.balance);
  });

  it("a wrong signature → 401 and nothing is stored or credited", async () => {
    const payment = await charge(20_000);
    const eventsBefore = await prisma.paymentEvent.count();
    await signedWebhook(
      app,
      {
        eventId: "evt_forged",
        txId: "tx_forged",
        merchantTradeId: payment.tradeId,
        type: "APPROVED",
        amount: 20_000,
        method: "CARD",
        failureCode: null,
        occurredAt: new Date().toISOString(),
      },
      "attacker-secret",
    ).expect(401);

    expect(await prisma.paymentEvent.count()).toBe(eventsBefore);
    expect(await statusOf(payment.id)).toBe("RESERVE");
    expect(await chargeRows(payment.id)).toBe(0);
  });

  it("an amount that differs from our record is never credited", async () => {
    const payment = await charge(30_000);
    const response = await signedWebhook(app, {
      eventId: "evt_amount_mismatch",
      txId: "tx_x",
      merchantTradeId: payment.tradeId,
      type: "APPROVED",
      amount: 3_000_000,
      method: "CARD",
      failureCode: null,
      occurredAt: new Date().toISOString(),
    }).expect(200);
    expect(response.body.result).toBe("AMOUNT_MISMATCH");
    expect(await statusOf(payment.id)).toBe("RESERVE");
    expect(await chargeRows(payment.id)).toBe(0);
  });

  it("01 declined: FAILED with the PG's failure code, no credits", async () => {
    const payment = await charge(10_001);
    await approveAtPg(payment.id);
    await waitFor(async () => (await statusOf(payment.id)) === "FAILED");
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(stored.failureCode).toBe("CARD_DECLINED");
    expect(await chargeRows(payment.id)).toBe(0);
  });

  it("PG unreachable → 502, and the trade is still on record as UNKNOWN for the re-query job", async () => {
    process.env.MOCK_PG_BASE_URL = "http://127.0.0.1:1/pg";
    try {
      const response = await as(app, owner.id).post(`/workspaces/${workspaceId}/payments/charge`).send({ amount: 5_000 }).expect(502);
      expect(response.body.code).toBe("PAYMENT_GATEWAY_ERROR");
      expect(await statusOf(response.body.details.paymentId)).toBe("UNKNOWN");
    } finally {
      process.env.MOCK_PG_BASE_URL = `${mocksBase}/pg`;
    }
  });

  it("guards: MEMBER cannot charge (403), amounts outside 1,000~1,000,000 KRW are rejected (400)", async () => {
    await as(app, member.id).post(`/workspaces/${workspaceId}/payments/charge`).send({ amount: 10_000 }).expect(403);
    await as(app, owner.id).post(`/workspaces/${workspaceId}/payments/charge`).send({ amount: 500 }).expect(400);
  });

  it("lists and reads payments for ADMIN+", async () => {
    const list = await as(app, owner.id).get(`/workspaces/${workspaceId}/payments?order=desc&limit=3`).expect(200);
    expect(list.body.items).toHaveLength(3);
    expect(list.body.nextCursor).toBeTruthy();
    const one = await as(app, owner.id).get(`/workspaces/${workspaceId}/payments/${list.body.items[0].id}`).expect(200);
    expect(one.body.payment.id).toBe(list.body.items[0].id);
    await as(app, member.id).get(`/workspaces/${workspaceId}/payments`).expect(403);
  });
});
