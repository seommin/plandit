import { z } from "zod";

import { ApiError, ErrorCode } from "../common/api-error";
import { isValidHmacSha256 } from "../common/safe-equal";
import { type MessageProvider, MessageProviderError, type RelayResult, type RelayWebhookEvent } from "./message-provider";

export const webhookSchema = z.object({
  eventId: z.string().min(1),
  msgId: z.string().min(1),
  clientRef: z.string().nullable(),
  status: z.enum(["DELIVERED", "FAILED"]),
  failCode: z.string().nullable(),
});

/** Talks to apps/mocks /relay over HTTP only. */
export class MockRelayAdapter implements MessageProvider {
  private get baseUrl() {
    return process.env.MOCK_RELAY_BASE_URL ?? "http://localhost:4100/relay";
  }

  private get secret() {
    const secret = process.env.MOCK_RELAY_WEBHOOK_SECRET;
    if (!secret && process.env.NODE_ENV === "production") throw new Error("MOCK_RELAY_WEBHOOK_SECRET is required.");
    return secret ?? "local-mock-relay-secret";
  }

  private async call(path: string, init?: RequestInit) {
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(5_000) });
    } catch (error) {
      throw new MessageProviderError(`Carrier unreachable: ${(error as Error).message}`, true);
    }
  }

  async send(input: { to: string; body: string; kind: string; clientRef: string }) {
    const callbackUrl = process.env.RELAY_WEBHOOK_URL;
    const response = await this.call("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, ...(callbackUrl ? { callbackUrl } : {}) }),
    });
    if (!response.ok) {
      throw new MessageProviderError(
        `Carrier answered ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    return { msgId: ((await response.json()) as { msgId: string }).msgId };
  }

  async lookup(msgId: string): Promise<RelayResult | null> {
    const response = await this.call(`/v1/messages/${encodeURIComponent(msgId)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new MessageProviderError(`Carrier lookup answered ${response.status}`, true);
    const body = (await response.json()) as RelayResult;
    return { msgId: body.msgId, status: body.status, failCode: body.failCode };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): RelayWebhookEvent | null {
    if (!isValidHmacSha256(rawBody, headers["x-mock-signature"], this.secret)) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new ApiError(ErrorCode.VALIDATION_FAILED, "Webhook body is not JSON.");
    }
    const parsed = webhookSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError(ErrorCode.VALIDATION_FAILED, "Unexpected webhook payload.");
    return { ...parsed.data, raw };
  }
}
