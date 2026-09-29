import { z } from "zod";

import { ApiError, ErrorCode } from "../common/api-error";
import { isValidHmacSha256 } from "../common/safe-equal";
import {
  type PaymentGateway,
  PaymentGatewayError,
  type PaymentLookup,
  type PaymentWebhookEvent,
} from "./payment-gateway";

const webhookSchema = z.object({
  eventId: z.string().min(1),
  txId: z.string().min(1),
  merchantTradeId: z.string().min(1),
  type: z.enum(["APPROVED", "FAILED", "CANCELED"]),
  amount: z.number().int(),
  method: z.string().nullable(),
  failureCode: z.string().nullable(),
  occurredAt: z.string(),
});

/** Talks to apps/mocks over HTTP only (it never imports mock code). */
export class MockPgAdapter implements PaymentGateway {
  readonly provider = "MOCK_PG" as const;

  private get baseUrl() {
    return process.env.MOCK_PG_BASE_URL ?? "http://localhost:4100/pg";
  }

  private get secret() {
    const secret = process.env.MOCK_PG_WEBHOOK_SECRET;
    if (!secret && process.env.NODE_ENV === "production") throw new Error("MOCK_PG_WEBHOOK_SECRET is required.");
    return secret ?? "local-mock-pg-secret";
  }

  async reserve({ tradeId, amount, returnUrl }: { tradeId: string; amount: number; returnUrl: string }) {
    const webhookUrl = process.env.PAYMENT_WEBHOOK_URL;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/payments/reserve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchantTradeId: tradeId, amount, returnUrl, ...(webhookUrl ? { webhookUrl } : {}) }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new PaymentGatewayError(`PG unreachable: ${(error as Error).message}`, true);
    }

    if (!response.ok) {
      throw new PaymentGatewayError(`PG rejected reserve with ${response.status}`, response.status >= 500);
    }
    const body = (await response.json()) as { txId: string; paymentPageUrl: string };
    return { providerTxId: body.txId, paymentPageUrl: body.paymentPageUrl };
  }

  async lookup(tradeId: string): Promise<PaymentLookup | null> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/payments?merchantTradeId=${encodeURIComponent(tradeId)}`, {
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new PaymentGatewayError(`PG unreachable: ${(error as Error).message}`, true);
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new PaymentGatewayError(`PG lookup failed with ${response.status}`, true);

    const body = (await response.json()) as {
      txId: string;
      status: PaymentLookup["status"];
      amount: number;
      method: string | null;
      failureCode: string | null;
      approvedAt: string | null;
    };
    return {
      status: body.status,
      providerTxId: body.txId,
      amount: body.amount,
      method: body.method,
      failureCode: body.failureCode,
      approvedAt: body.approvedAt ? new Date(body.approvedAt) : null,
    };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentWebhookEvent | null {
    if (!isValidHmacSha256(rawBody, headers["x-mock-signature"], this.secret)) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new ApiError(ErrorCode.VALIDATION_FAILED, "Webhook body is not JSON.");
    }
    const parsed = webhookSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError(ErrorCode.VALIDATION_FAILED, "Unexpected webhook payload.");

    const event = parsed.data;
    return {
      eventId: event.eventId,
      type: event.type,
      tradeId: event.merchantTradeId,
      providerTxId: event.txId,
      amount: event.amount,
      method: event.method,
      failureCode: event.failureCode,
      occurredAt: new Date(event.occurredAt),
      raw,
    };
  }
}
