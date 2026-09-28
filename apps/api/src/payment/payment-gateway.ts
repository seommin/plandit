import type { PaymentProvider } from "@plandit/database/prisma";

/** Normalized PG webhook, whatever the provider's wire format is. */
export type PaymentWebhookEvent = {
  eventId: string;
  type: "APPROVED" | "FAILED" | "CANCELED";
  /** Our Payment.tradeId, echoed back by the PG */
  tradeId: string;
  providerTxId: string;
  amount: number;
  method: string | null;
  failureCode: string | null;
  occurredAt: Date;
  /** Original body, stored for audit */
  raw: unknown;
};

/** `retryable`: the PG may or may not have recorded the request (timeout, 5xx) → the payment becomes UNKNOWN. */
export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Everything the payment service needs from a PG. Swapping the mock for a real provider (e.g. Toss test keys)
 * means adding another implementation and a PAYMENT_PROVIDER value — the services don't change.
 */
export interface PaymentGateway {
  readonly provider: PaymentProvider;
  reserve(input: { tradeId: string; amount: number; returnUrl: string }): Promise<{
    providerTxId: string;
    paymentPageUrl: string;
  }>;
  /** Returns null when the signature is missing or wrong. Throws ApiError(400) for a signed but malformed body. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentWebhookEvent | null;
}

export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");
