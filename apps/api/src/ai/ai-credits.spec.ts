import {
  AI_MODEL_RATES,
  type AttemptUsage,
  ceilingRates,
  creditsForAttempts,
  estimateInputTokens,
  reserveCredits,
} from "@plandit/shared/ai";

const attempt = (model: string, usage: Partial<AttemptUsage> = {}): AttemptUsage => ({
  model,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  ...usage,
});
const rates = (model: string) => AI_MODEL_RATES[model];

describe("AI credit conversion", () => {
  it("prices each kind of token at its model's rate and rounds the call up", () => {
    // Opus 5.5: 1,840 × 560 + 7,120 × 2,800 = 20,966,400 micro-credits → 20.97 → 21
    expect(creditsForAttempts([attempt("claude-opus-5-5", { inputTokens: 1_840, outputTokens: 7_120 })], rates)).toBe(21);
    // cache read 28, cache write 700 per 1M: 1M read + 1M write = 728 credits
    expect(
      creditsForAttempts([attempt("claude-opus-5-5", { cacheReadInputTokens: 1_000_000, cacheWriteInputTokens: 1_000_000 })], rates),
    ).toBe(728);
  });

  it("charges at least 1 credit for any tokens, and 0 for none", () => {
    expect(creditsForAttempts([attempt("claude-opus-5-5", { inputTokens: 1 })], rates)).toBe(1);
    expect(creditsForAttempts([attempt("claude-opus-5-5")], rates)).toBe(0);
    expect(creditsForAttempts([], rates)).toBe(0);
  });

  it("sums a declined attempt and its fallback, each at its own model's price, rounding once", () => {
    const declined = attempt("claude-opus-5-5", { inputTokens: 500_000 }); // 280 credits
    const fallback = attempt("claude-opus-5", { inputTokens: 500_000, outputTokens: 100_001 }); // 350 + 350.0035
    expect(creditsForAttempts([declined, fallback], rates)).toBe(981);
  });

  it("reserves at the dearest serving model, pricing input as a cache write and the whole output cap", () => {
    const ceiling = ceilingRates(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]);
    expect(ceiling).toEqual({ input: 700, output: 3_500, cacheRead: 70, cacheWrite: 875 });
    // 2,000 × 875 + 16,000 × 3,500 = 57,750,000 → 58
    expect(reserveCredits(2_000, 16_000, ceiling)).toBe(58);
    expect(reserveCredits(0, 1, ceiling)).toBe(1);
  });

  it("covers the worst actual charge: a reservation is never below what the same tokens cost on any serving model", () => {
    const models = ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"];
    const reserved = reserveCredits(3_000, 8_000, ceilingRates(models));
    for (const model of models) {
      const worst = attempt(model, { cacheWriteInputTokens: 3_000, outputTokens: 8_000 });
      expect(creditsForAttempts([worst], rates)).toBeLessThanOrEqual(reserved);
    }
  });

  it("refuses to price a model without rates", () => {
    expect(() => ceilingRates(["claude-opus-5-5", "unknown-model"])).toThrow(/unknown-model/);
  });

  it("estimates input tokens generously from UTF-8 bytes", () => {
    expect(estimateInputTokens("abcd")).toBe(2); // 4 bytes
    expect(estimateInputTokens("여행")).toBe(3); // 6 bytes
    expect(estimateInputTokens("é😀")).toBe(3); // 2 + 4 bytes
    expect(estimateInputTokens("")).toBe(0);
  });
});
