import { type AttemptUsage, estimateInputTokens } from "@plandit/shared/ai";

import { LlmError, type LlmClient, type LlmErrorCode, type LlmRequest, type LlmResult, requestText } from "./llm-client";

export const MOCK_MODEL = "mock-llm";

export type MockReply = {
  text?: string;
  stopReason?: LlmResult["stopReason"];
  /** Defaults are derived from the request and reply lengths */
  attempts?: AttemptUsage[];
  error?: LlmErrorCode;
  /** The call stays in flight until this settles (a slow model) */
  wait?: Promise<unknown>;
};

/**
 * Stand-in model for local runs and tests (LLM_PROVIDER=mock): no network, deterministic. Without a script it answers a
 * JSON Schema request with the smallest valid document and anything else with a fixed sentence.
 */
export class MockLlmAdapter implements LlmClient {
  readonly provider = "mock" as const;
  readonly servingModels = [MOCK_MODEL];
  /** complete() calls so far — lets tests prove "the model was never called" */
  calls = 0;
  private script: MockReply[] = [];
  private responders: Array<{ match: (request: LlmRequest) => boolean; reply: (request: LlmRequest) => MockReply }> = [];

  /** Test hook: the next calls answer with these, in order, then the default reply. */
  enqueue(...replies: MockReply[]) {
    this.script.push(...replies);
  }

  reset() {
    this.script = [];
    this.calls = 0;
  }

  /**
   * Default answer for one kind of request, so a feature looks real locally without an API key (e.g. an itinerary on
   * the requested dates instead of a bare schema sample). Scripted replies still come first.
   */
  respondTo(match: (request: LlmRequest) => boolean, reply: (request: LlmRequest) => MockReply) {
    this.responders.push({ match, reply });
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    this.calls++;
    const reply = this.script.shift() ?? this.responders.find((r) => r.match(request))?.reply(request) ?? {};
    await reply.wait;
    if (reply.error) throw new LlmError(reply.error, `Mock model: ${reply.error}`);

    const text = reply.text ?? (request.jsonSchema ? JSON.stringify(sampleFor(request.jsonSchema)) : "모의 응답이에요.");
    return {
      model: MOCK_MODEL,
      text,
      stopReason: reply.stopReason ?? "end",
      attempts: reply.attempts ?? [
        {
          model: MOCK_MODEL,
          inputTokens: Math.ceil(estimateInputTokens(requestText(request)) / 2),
          outputTokens: estimateInputTokens(text),
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
        },
      ],
    };
  }
}

type JsonSchema = {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  exclusiveMinimum?: number;
  format?: string;
};

/** Small document satisfying a JSON Schema: required keys only, max(1, minItems) items, minimum numbers. No `pattern` support. */
export function sampleFor(schema: JsonSchema): unknown {
  if ("const" in schema) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  const branch = schema.anyOf?.[0] ?? schema.oneOf?.[0];
  if (branch) return sampleFor(branch);

  const type = Array.isArray(schema.type) ? (schema.type.find((t) => t !== "null") ?? "null") : schema.type;
  switch (type) {
    case "object":
      return Object.fromEntries((schema.required ?? []).map((key) => [key, sampleFor(schema.properties?.[key] ?? {})]));
    case "array":
      // A schema sent to a model has no minItems left (see toLlmJsonSchema), so give it one element anyway.
      return Array.from({ length: Math.max(1, schema.minItems ?? 1) }, () => sampleFor(schema.items ?? {}));
    case "string":
      if (schema.format === "date") return "2026-01-01";
      if (schema.format === "date-time") return "2026-01-01T00:00:00.000Z";
      return "모의".padEnd(schema.minLength ?? 0, "!");
    case "integer":
    case "number":
      return schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 0);
    case "boolean":
      return false;
    default:
      return null;
  }
}
