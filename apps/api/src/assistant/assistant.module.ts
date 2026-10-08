import { Module } from "@nestjs/common";

import { AiModule } from "../ai/ai.module";
import { MemoryModule } from "../memory/memory.module";
import { AssistantController } from "./assistant.controller";
import { AssistantQueue } from "./assistant.queue";
import { AssistantService } from "./assistant.service";

@Module({
  imports: [AiModule, MemoryModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantQueue],
  exports: [AssistantService],
})
export class AssistantModule {}
