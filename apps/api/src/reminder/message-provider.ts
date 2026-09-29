export type MessageKind = "SMS" | "LMS" | "ALIMTALK";

export type RelayResult = {
  msgId: string;
  status: "ACCEPTED" | "DELIVERED" | "FAILED";
  failCode: string | null;
};

export type RelayWebhookEvent = {
  eventId: string;
  msgId: string;
  /** Our ReminderDelivery.id, echoed back */
  clientRef: string | null;
  status: "DELIVERED" | "FAILED";
  failCode: string | null;
  raw: unknown;
};

/** `retryable`: 429 / 5xx / network — worth another attempt with backoff. Otherwise the request itself is bad. */
export class MessageProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** SMS/AlimTalk carrier. The mock carrier today; a real one later without touching the reminder services. */
export interface MessageProvider {
  /** `clientRef` makes the call idempotent at the carrier: resending the same ref returns the same message. */
  send(input: { to: string; body: string; kind: MessageKind; clientRef: string }): Promise<{ msgId: string }>;
  /** null = the carrier has no such message */
  lookup(msgId: string): Promise<RelayResult | null>;
  /** null when the signature is missing or wrong */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): RelayWebhookEvent | null;
}

export const MESSAGE_PROVIDER = Symbol("MESSAGE_PROVIDER");
