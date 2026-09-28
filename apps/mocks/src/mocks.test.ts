import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { createApp, type MocksConfig } from "./app.ts";
import { createDb, type Db, migrate } from "./db.ts";
import { SIGNATURE_HEADER, sign } from "./webhook.ts";

type Received = { signatureValid: boolean; body: Record<string, unknown> };

const PG_SECRET = "test-pg-secret";
const RELAY_SECRET = "test-relay-secret";
const received: Received[] = [];
let db: Db;
let mocks: Server;
let receiver: Server;
let base: string;

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

const waitFor = async <T>(check: () => T | undefined, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const eventsFor = (key: string, value: string) => received.filter((r) => r.body[key] === value);

const post = (path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });

let tradeSeq = 0;
const reserve = async (amount: number) => {
  const merchantTradeId = `T-${Date.now()}-${++tradeSeq}`;
  const response = await post("/pg/v1/payments/reserve", { merchantTradeId, amount, returnUrl: "http://merchant.test/return" });
  assert.equal(response.status, 201);
  return { merchantTradeId, ...((await response.json()) as { txId: string; paymentPageUrl: string }) };
};

before(async () => {
  // Same isolated database the API e2e suite uses; created on first run.
  const devUrl = process.env.DATABASE_URL ?? "postgresql://plandit:plandit@localhost:5432/plandit";
  const testUrl = new URL(devUrl);
  testUrl.pathname = "/plandit_test";
  const admin = new pg.Client({ connectionString: devUrl });
  await admin.connect();
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = 'plandit_test'")).rowCount) {
    await admin.query("CREATE DATABASE plandit_test");
  }
  await admin.end();

  db = createDb(testUrl.toString());
  await migrate(db);
  await db.query("TRUNCATE mock.pg_events, mock.pg_transactions, mock.relay_messages");

  receiver = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      const secret = "txId" in body ? PG_SECRET : RELAY_SECRET;
      received.push({ signatureValid: req.headers[SIGNATURE_HEADER] === sign(secret, raw), body });
      res.writeHead(200).end();
    });
  });
  const hook = await listen(receiver);

  const config: MocksConfig = {
    pg: { publicUrl: "http://mocks.test", webhookUrl: `${hook}/pg`, webhookSecret: PG_SECRET, slowMs: 300, webhookDelayMs: 200 },
    relay: { webhookUrl: `${hook}/relay`, webhookSecret: RELAY_SECRET, failRate: 0, delayMs: 30, rps: 3 },
  };
  mocks = createServer(createApp(db, config));
  base = await listen(mocks);
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300)); // let delayed webhooks finish
  mocks.close();
  receiver.close();
  await db.end();
});

describe("mock PG", () => {
  it("reserve is idempotent per merchantTradeId and rejects a different amount", async () => {
    const first = await reserve(10_000);
    assert.equal(first.paymentPageUrl, `http://mocks.test/pg/pay/${first.txId}`);
    const again = await post("/pg/v1/payments/reserve", { merchantTradeId: first.merchantTradeId, amount: 10_000, returnUrl: "http://merchant.test/return" });
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { txId: string }).txId, first.txId);
    const conflict = await post("/pg/v1/payments/reserve", { merchantTradeId: first.merchantTradeId, amount: 20_000, returnUrl: "http://merchant.test/return" });
    assert.equal(conflict.status, 409);
    assert.equal((await post("/pg/v1/payments/reserve", { amount: 5 })).status, 400);
  });

  it("00: confirm approves once and sends one signed APPROVED webhook", async () => {
    const { txId } = await reserve(10_000);
    const confirmed = (await (await post(`/pg/v1/payments/${txId}/confirm`)).json()) as { status: string };
    assert.equal(confirmed.status, "APPROVED");
    await post(`/pg/v1/payments/${txId}/confirm`); // retry: no second event

    const [hook] = await waitFor(() => (eventsFor("txId", txId).length ? eventsFor("txId", txId) : undefined));
    assert.equal(hook.signatureValid, true);
    assert.equal(hook.body.type, "APPROVED");
    assert.equal(hook.body.amount, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(eventsFor("txId", txId).length, 1);
  });

  it("01: approval fails with CARD_DECLINED and a FAILED webhook", async () => {
    const { txId } = await reserve(10_001);
    const result = (await (await post(`/pg/v1/payments/${txId}/confirm`)).json()) as { status: string; failureCode: string };
    assert.deepEqual([result.status, result.failureCode], ["FAILED", "CARD_DECLINED"]);
    const [hook] = await waitFor(() => (eventsFor("txId", txId).length ? eventsFor("txId", txId) : undefined));
    assert.equal(hook.body.type, "FAILED");
  });

  it("02: confirm answers only after the slow delay, but the approval is already recorded", async () => {
    const { txId } = await reserve(10_002);
    const started = Date.now();
    const pending = post(`/pg/v1/payments/${txId}/confirm`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const status = (await (await fetch(`${base}/pg/v1/payments/${txId}`)).json()) as { status: string };
    assert.equal(status.status, "APPROVED"); // re-query sees it while the caller is still waiting
    await pending;
    assert.ok(Date.now() - started >= 300);
  });

  it("03: sends the same event twice", async () => {
    const { txId } = await reserve(10_003);
    await post(`/pg/v1/payments/${txId}/confirm`);
    const hooks = await waitFor(() => (eventsFor("txId", txId).length === 2 ? eventsFor("txId", txId) : undefined));
    assert.equal(hooks[0].body.eventId, hooks[1].body.eventId);
  });

  it("04: delays the webhook; 05: never sends it (re-query still shows APPROVED)", async () => {
    const late = await reserve(10_004);
    const lost = await reserve(10_005);
    await post(`/pg/v1/payments/${late.txId}/confirm`);
    await post(`/pg/v1/payments/${lost.txId}/confirm`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(eventsFor("txId", late.txId).length, 0);
    await waitFor(() => (eventsFor("txId", late.txId).length ? true : undefined));
    assert.equal(eventsFor("txId", lost.txId).length, 0);
    const byTradeId = await fetch(`${base}/pg/v1/payments?merchantTradeId=${lost.merchantTradeId}`);
    assert.equal(((await byTradeId.json()) as { status: string }).status, "APPROVED");
  });

  it("hosted page: approve redirects (303) back to the merchant with the result", async () => {
    const { txId } = await reserve(20_000);
    const page = await fetch(`${base}/pg/pay/${txId}`);
    assert.match(await page.text(), /20,000원/);
    const response = await post(`/pg/pay/${txId}/approve`);
    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.searchParams.get("status"), "APPROVED");
    assert.equal(location.searchParams.get("txId"), txId);
  });

  it("cancel refunds an APPROVED payment once; resend re-delivers an event", async () => {
    const { txId } = await reserve(30_000);
    await post(`/pg/v1/payments/${txId}/confirm`);
    assert.equal((await post(`/pg/v1/payments/${txId}/cancel`)).status, 200);
    assert.equal((await post(`/pg/v1/payments/${txId}/cancel`)).status, 409);
    const canceled = await waitFor(() => eventsFor("txId", txId).find((e) => e.body.type === "CANCELED"));

    const resend = await post(`/pg/v1/admin/webhooks/${canceled.body.eventId}/resend`);
    assert.equal(((await resend.json()) as { httpStatus: number }).httpStatus, 200);
    assert.equal(eventsFor("eventId", canceled.body.eventId as string).length, 2);
  });
});

describe("mock relay", () => {
  const send = (to: string, body = "내일 10시 회의가 있어요") =>
    post("/relay/v1/messages", { to, body, kind: "SMS", clientRef: `ref-${to}-${Date.now()}` });

  it("accepts, then reports DELIVERED via a signed webhook, visible in the virtual inbox", async () => {
    const response = await send("010-0000-0001", "인박스 확인용 문자");
    assert.equal(response.status, 202);
    const { msgId } = (await response.json()) as { msgId: string };

    const hook = await waitFor(() => eventsFor("msgId", msgId)[0]);
    assert.equal(hook.signatureValid, true);
    assert.equal(hook.body.status, "DELIVERED");
    assert.equal(((await (await fetch(`${base}/relay/v1/messages/${msgId}`)).json()) as { status: string }).status, "DELIVERED");
    assert.match(await (await fetch(`${base}/inbox?phone=010-0000-0001`)).text(), /인박스 확인용 문자/);
  });

  it("numbers ending in 9 fail with INVALID_NUMBER", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_000)); // fresh rate-limit window
    const { msgId } = (await (await send("010-0000-0009")).json()) as { msgId: string };
    const hook = await waitFor(() => eventsFor("msgId", msgId)[0]);
    assert.deepEqual([hook.body.status, hook.body.failCode], ["FAILED", "INVALID_NUMBER"]);
  });

  it("returns 429 beyond the per-second limit and 400 for bad input", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const statuses = await Promise.all(Array.from({ length: 5 }, (_, i) => send(`010-0000-010${i}`).then((r) => r.status)));
    assert.equal(statuses.filter((s) => s === 202).length, 3);
    assert.equal(statuses.filter((s) => s === 429).length, 2);
    assert.equal((await post("/relay/v1/messages", { to: "12345", body: "x" })).status, 400);
  });
});
