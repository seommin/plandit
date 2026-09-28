import { createHmac } from "crypto";

import { creditsForAmount } from "@plandit/shared/credits";

import { ApiError } from "../common/api-error";
import { MockPgAdapter } from "./mock-pg.adapter";

const body = {
  eventId: "evt_1",
  txId: "tx_1",
  merchantTradeId: "P260928-000001",
  type: "APPROVED",
  amount: 10_000,
  method: "CARD",
  failureCode: null,
  occurredAt: "2026-09-28T00:00:00.000Z",
};
const signed = (raw: string, secret = "unit-secret") => ({
  "x-mock-signature": createHmac("sha256", secret).update(raw).digest("hex"),
});

describe("MockPgAdapter.parseWebhook", () => {
  const adapter = new MockPgAdapter();
  const raw = JSON.stringify(body);

  beforeAll(() => {
    process.env.MOCK_PG_WEBHOOK_SECRET = "unit-secret";
  });

  it("accepts a correctly signed body and normalizes it", () => {
    expect(adapter.parseWebhook(Buffer.from(raw), signed(raw))).toMatchObject({
      eventId: "evt_1",
      type: "APPROVED",
      tradeId: "P260928-000001",
      providerTxId: "tx_1",
      amount: 10_000,
    });
  });

  it("rejects a missing signature, a wrong secret, and a body changed after signing", () => {
    expect(adapter.parseWebhook(Buffer.from(raw), {})).toBeNull();
    expect(adapter.parseWebhook(Buffer.from(raw), signed(raw, "other-secret"))).toBeNull();
    const tampered = raw.replace("10000", "99999");
    expect(adapter.parseWebhook(Buffer.from(tampered), signed(raw))).toBeNull();
  });

  it("throws 400 for a signed body with the wrong shape", () => {
    const bad = JSON.stringify({ eventId: "evt_2" });
    expect(() => adapter.parseWebhook(Buffer.from(bad), signed(bad))).toThrow(ApiError);
  });
});

describe("creditsForAmount", () => {
  it("is 1 credit per 10 KRW, dropping the remainder", () => {
    expect(creditsForAmount(10_000)).toBe(1_000);
    expect(creditsForAmount(10_003)).toBe(1_000);
    expect(creditsForAmount(1_009)).toBe(100);
  });
});
