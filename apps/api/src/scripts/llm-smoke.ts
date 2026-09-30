import { z } from "zod";

import { AI_MODEL_RATES, ceilingRates, creditsForAttempts } from "@plandit/shared/ai";

import { llmClientFromEnv } from "../ai/ai.module";
import { LlmError, toLlmJsonSchema } from "../ai/llm-client";

/**
 * One short structured-output request through the configured LlmClient, printing what it would cost. Nothing is
 * written and no credits move. With LLM_PROVIDER=anthropic this makes one real, billed API call.
 */
const replySchema = z.object({ greeting: z.string().min(1), language: z.enum(["ko", "en"]) });

async function main() {
  const llm = llmClientFromEnv();
  const ceiling = ceilingRates(llm.servingModels);
  const result = await llm.complete({
    system: "You check that an integration works. Reply in Korean.",
    messages: [{ role: "user", content: "짧게 인사해 주세요." }],
    maxOutputTokens: 1_024,
    effort: "low",
    jsonSchema: toLlmJsonSchema(replySchema),
  });

  const parsed = replySchema.safeParse(JSON.parse(result.text));
  console.log({
    provider: llm.provider,
    servingModels: llm.servingModels,
    model: result.model,
    stopReason: result.stopReason,
    reply: parsed.success ? parsed.data : { invalid: result.text },
    attempts: result.attempts,
    credits: creditsForAttempts(result.attempts, (model) => AI_MODEL_RATES[model] ?? ceiling),
  });
  if (!parsed.success || result.stopReason !== "end") process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof LlmError ? `${error.code}: ${error.message}` : error);
  process.exitCode = 1;
});
