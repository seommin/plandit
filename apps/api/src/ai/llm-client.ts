import { z } from "zod";

import type { AttemptUsage } from "@plandit/shared/ai";

export type LlmMessage = { role: "user" | "assistant"; content: string };

/**
 * Non-streaming requests stay under this output cap (thinking included), which keeps a single HTTP response inside
 * LLM_TIMEOUT_MS. A feature needing longer output should switch the adapter to streaming first.
 */
export const MAX_OUTPUT_TOKENS = 16_000;

export type LlmRequest = {
  system: string;
  messages: LlmMessage[];
  /** Output cap, thinking included. The credit reservation is priced with it. */
  maxOutputTokens: number;
  effort?: "low" | "medium" | "high";
  /** JSON Schema the reply must follow (structured output). `text` is then one JSON document. */
  jsonSchema?: Record<string, unknown>;
};

export type LlmResult = {
  /** Model that produced the reply (a server-side fallback model when one served it) */
  model: string;
  text: string;
  stopReason: "end" | "max_tokens" | "refusal" | "other";
  /** What we are billed for: one entry per model attempt, declined attempts and fallbacks included. */
  attempts: AttemptUsage[];
};

export const LLM_ERROR_CODES = [
  "LLM_TIMEOUT",
  "LLM_RATE_LIMITED",
  "LLM_OVERLOADED",
  "LLM_UNAVAILABLE",
  "LLM_BAD_REQUEST",
  "LLM_AUTH",
  "LLM_ERROR",
] as const;
export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

/** The call produced no reply. The SDK has already retried what was worth retrying (429, 5xx, timeouts). */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A language model behind one method. Services only see this; swapping the provider means another implementation
 * and an LLM_PROVIDER value.
 */
export interface LlmClient {
  readonly provider: "anthropic" | "mock";
  /** Every model that may serve a request (the configured one plus server-side fallbacks). Reservations use the dearest. */
  readonly servingModels: readonly string[];
  complete(request: LlmRequest): Promise<LlmResult>;
}

export const LLM_CLIENT = Symbol("LLM_CLIENT");

/** All the text a request sends, for the input-token estimate. */
export function requestText(request: LlmRequest) {
  const schema = request.jsonSchema ? JSON.stringify(request.jsonSchema) : "";
  return [request.system, ...request.messages.map((m) => m.content), schema].join("\n");
}

/** Keywords structured output accepts; everything else (minLength, maximum, pattern, minItems …) is dropped. */
const KEPT_KEYWORDS = new Set(["type", "properties", "required", "items", "enum", "const", "anyOf", "allOf", "$ref", "$defs", "description", "title"]);
const KEPT_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

function keepSupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(keepSupported);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" || key === "$defs") {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, keepSupported(v)]));
    } else if (key === "format") {
      if (KEPT_FORMATS.has(value as string)) out.format = value;
    } else if (KEPT_KEYWORDS.has(key)) {
      out[key] = key === "enum" || key === "const" || key === "required" ? value : keepSupported(value);
    }
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

/**
 * `jsonSchema` from the zod schema that will also validate the reply in `parse`. Structured output rejects numeric,
 * length and array-size constraints, so they are stripped here and enforced by that zod schema afterwards.
 */
export function toLlmJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return keepSupported(z.toJSONSchema(schema)) as Record<string, unknown>;
}
