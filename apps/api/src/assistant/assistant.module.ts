import { Module } from "@nestjs/common";

import { AiModule } from "../ai/ai.module";
import { AssistantController } from "./assistant.controller";
import { AssistantQueue } from "./assistant.queue";
import { AssistantService } from "./assistant.service";

@Module({
  imports: [AiModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantQueue],
  exports: [AssistantService],
})
export class AssistantModule {}
