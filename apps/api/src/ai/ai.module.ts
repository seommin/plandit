import { Module } from "@nestjs/common";

import { CreditModule } from "../credit/credit.module";
import { AiUsageService } from "./ai-usage.service";
import { AiController } from "./ai.controller";
import { AnthropicAdapter } from "./anthropic.adapter";
import { EMBEDDING_CLIENT, embeddingClientFromEnv } from "./embedding";
import { LLM_CLIENT, type LlmClient } from "./llm-client";
import { MockLlmAdapter } from "./mock-llm.adapter";

/** LLM_PROVIDER picks the model behind LlmClient. `mock` (default) needs no API key and never touches the network. */
export function llmClientFromEnv(): LlmClient {
  const provider = process.env.LLM_PROVIDER ?? "mock";
  if (provider === "mock") return new MockLlmAdapter();
  if (provider === "anthropic") return AnthropicAdapter.fromEnv();
  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}

@Module({
  imports: [CreditModule],
  controllers: [AiController],
  providers: [AiUsageService, { provide: LLM_CLIENT, useFactory: llmClientFromEnv }, { provide: EMBEDDING_CLIENT, useFactory: embeddingClientFromEnv }],
  exports: [AiUsageService, LLM_CLIENT, EMBEDDING_CLIENT],
})
export class AiModule {}
