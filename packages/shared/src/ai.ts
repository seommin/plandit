import { z } from "zod";

/**
 * Credits per 1M tokens, by model. 1 credit = 10 KRW (credits.ts): list price in USD × 1,400 KRW ÷ 10, no margin.
 * Cache writes use the 5-minute TTL price (1.25× input). The api refuses to start with a model missing here.
 */
export type TokenRates = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const AI_MODEL_RATES: Record<string, TokenRates> = {
  "claude-opus-5-5": { input: 560, output: 2_800, cacheRead: 28, cacheWrite: 700 },
  "claude-opus-5": { input: 700, output: 3_500, cacheRead: 70, cacheWrite: 875 },
  "claude-opus-4-8": { input: 700, output: 3_500, cacheRead: 70, cacheWrite: 875 },
  // The in-process mock (LLM_PROVIDER=mock) is priced like the default model so local numbers look real.
  "mock-llm": { input: 560, output: 2_800, cacheRead: 28, cacheWrite: 700 },
};

/** Where Anthropic's server-side fallback (`fallbacks: "default"`) may send a refused request. */
export const AI_FALLBACK_MODELS = ["claude-opus-5", "claude-opus-4-8"] as const;

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
};
export type AttemptUsage = TokenUsage & { model: string };

const PER = 1_000_000;

/** Every attempt at its own model's rate, summed, then rounded up: any tokens used cost at least 1 credit. */
export function creditsForAttempts(attempts: AttemptUsage[], ratesFor: (model: string) => TokenRates) {
  const microCredits = attempts.reduce((sum, a) => {
    const r = ratesFor(a.model);
    return (
      sum +
      a.inputTokens * r.input +
      a.outputTokens * r.output +
      a.cacheReadInputTokens * r.cacheRead +
      a.cacheWriteInputTokens * r.cacheWrite
    );
  }, 0);
  return Math.ceil(microCredits / PER);
}

/** The most any of these models charges for each kind of token — what a reservation must cover. */
export function ceilingRates(models: readonly string[]): TokenRates {
  return models.reduce<TokenRates>(
    (max, model) => {
      const r = AI_MODEL_RATES[model];
      if (!r) throw new Error(`No credit rates for model "${model}".`);
      return {
        input: Math.max(max.input, r.input),
        output: Math.max(max.output, r.output),
        cacheRead: Math.max(max.cacheRead, r.cacheRead),
        cacheWrite: Math.max(max.cacheWrite, r.cacheWrite),
      };
    },
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
}

/**
 * Credits to reserve before a call: every input token priced as a cache write (the dearest input) plus the full output
 * cap (thinking counts as output). An upper bound, so settling only ever gives credits back.
 */
export function reserveCredits(inputTokens: number, maxOutputTokens: number, rates: TokenRates) {
  const microCredits = inputTokens * Math.max(rates.input, rates.cacheWrite) + maxOutputTokens * rates.output;
  return Math.max(1, Math.ceil(microCredits / PER));
}

/**
 * Generous input-token guess without calling a tokenizer: UTF-8 bytes ÷ 2 (English is ~4 bytes per token; a Korean
 * syllable is 3 bytes). If it ever undershoots, the charge is still capped at the reservation.
 */
export function estimateInputTokens(text: string) {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return Math.ceil(bytes / 2);
}

/** A workspace's monthly AI credit cap (PLANDIT-24). null removes it. */
export const aiLimitUpdateSchema = z.object({
  monthlyCreditLimit: z.number().int().min(1).max(10_000_000).nullable(),
});
