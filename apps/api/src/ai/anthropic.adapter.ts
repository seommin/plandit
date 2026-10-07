import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "@nestjs/common";

import { AI_FALLBACK_MODELS, type AttemptUsage } from "@plandit/shared/ai";

import { LlmError, type LlmClient, type LlmErrorCode, type LlmMessage, type LlmRequest, type LlmResult } from "./llm-client";

/** Server-side refusal fallback, the `"default"` form (Anthropic picks the fallback model by refusal category). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type AnthropicAdapterOptions = {
  model: string;
  /** Re-run a safety-classifier refusal on a fallback model inside the same call */
  refusalFallback: boolean;
  timeoutMs: number;
  maxRetries: number;
  /** Tests only: a local fake API. Otherwise the SDK reads ANTHROPIC_API_KEY (or another configured credential). */
  apiKey?: string;
  baseURL?: string;
};

/**
 * Claude over the official SDK. Structured output goes through `output_config.format` (json_schema): Claude Opus 5.5
 * rejects a forced `tool_choice`, so tools are not used just to get JSON back. Thinking is always on for this model;
 * `effort` is the only dial and is sent explicitly.
 */
export class AnthropicAdapter implements LlmClient {
  readonly provider = "anthropic" as const;
  readonly servingModels: readonly string[];
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicAdapterOptions) {
    this.client = new Anthropic({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries,
    });
    this.servingModels = [...new Set([options.model, ...(options.refusalFallback ? AI_FALLBACK_MODELS : [])])];
  }

  static fromEnv() {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      // The SDK only fails at the first call (reported as LLM_ERROR), so say it at boot.
      new Logger(AnthropicAdapter.name).warn("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty: calls will fail unless an `ant auth login` profile exists");
    }
    return new AnthropicAdapter({
      model: process.env.LLM_MODEL ?? "claude-opus-5-5",
      refusalFallback: (process.env.LLM_REFUSAL_FALLBACK ?? "default") !== "off",
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 300_000),
      maxRetries: Number(process.env.LLM_MAX_RETRIES ?? 2),
    });
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages.create({
        model: this.options.model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: request.messages.map(toParam),
        output_config: {
          effort: request.effort ?? "medium",
          ...(request.jsonSchema ? { format: { type: "json_schema" as const, schema: request.jsonSchema } } : {}),
        },
        ...(request.tools?.length
          ? {
              // strict: the input matches the schema. tool_choice stays auto — forcing a tool is a 400 on this model.
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
                strict: true,
              })),
            }
          : {}),
        ...(request.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
        ...(this.options.refusalFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      });
    } catch (error) {
      throw toLlmError(error);
    }

    return {
      model: message.model,
      text: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
      stopReason: toStopReason(message.stop_reason),
      toolCalls: message.content.flatMap((block) => (block.type === "tool_use" ? [{ id: block.id, name: block.name, input: block.input }] : [])),
      // Every block as received (thinking included, even when its text is empty): it goes back unchanged.
      replay: message.content,
      attempts: attemptsOf(message),
    };
  }
}

function toParam(message: LlmMessage): Anthropic.Beta.BetaMessageParam {
  if (message.role === "assistant") {
    return { role: "assistant", content: (message.replay as Anthropic.Beta.BetaContentBlockParam[] | undefined) ?? message.content };
  }
  if (!message.toolResults?.length) return { role: "user", content: message.content };
  return {
    role: "user",
    content: [
      ...message.toolResults.map((r) => ({ type: "tool_result" as const, tool_use_id: r.toolCallId, content: r.content, is_error: r.isError ?? false })),
      ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
    ],
  };
}

function toStopReason(reason: Anthropic.Beta.BetaStopReason | null): LlmResult["stopReason"] {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

/**
 * `usage.iterations` is the per-attempt source of truth when present (a declined attempt and the fallback that served
 * the reply are separate entries, each at its own model's price); top-level `usage` covers only the serving attempt.
 */
export function attemptsOf(message: Anthropic.Beta.BetaMessage): AttemptUsage[] {
  const { usage } = message;
  if (usage.iterations?.length) {
    return usage.iterations.map((entry) => ({
      model: ("model" in entry && entry.model) || message.model,
      inputTokens: entry.input_tokens,
      outputTokens: entry.output_tokens,
      cacheReadInputTokens: entry.cache_read_input_tokens ?? 0,
      cacheWriteInputTokens: entry.cache_creation_input_tokens ?? 0,
    }));
  }
  return [
    {
      model: message.model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteInputTokens: usage.cache_creation_input_tokens ?? 0,
    },
  ];
}

/** Most specific first: in this SDK the connection errors are subclasses of APIError. */
export function toLlmError(error: unknown): LlmError {
  const code = ((): LlmErrorCode => {
    if (error instanceof Anthropic.APIConnectionTimeoutError) return "LLM_TIMEOUT";
    if (error instanceof Anthropic.APIConnectionError) return "LLM_UNAVAILABLE";
    if (error instanceof Anthropic.RateLimitError) return "LLM_RATE_LIMITED";
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "LLM_AUTH";
    if (error instanceof Anthropic.InternalServerError) return error.status === 529 ? "LLM_OVERLOADED" : "LLM_UNAVAILABLE";
    if (error instanceof Anthropic.APIError && error.status !== undefined && error.status < 500) return "LLM_BAD_REQUEST";
    return "LLM_ERROR";
  })();
  const status = error instanceof Anthropic.APIError && error.status !== undefined ? ` (${error.status})` : "";
  return new LlmError(code, `Anthropic${status}: ${error instanceof Error ? error.message : String(error)}`);
}
