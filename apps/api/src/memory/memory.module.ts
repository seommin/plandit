import { Module } from "@nestjs/common";

import { AiModule } from "../ai/ai.module";
import { MemoryController } from "./memory.controller";
import { MemoryQueue } from "./memory.queue";
import { MemoryService } from "./memory.service";

@Module({
  imports: [AiModule],
  controllers: [MemoryController],
  providers: [MemoryService, MemoryQueue],
  exports: [MemoryService],
})
export class MemoryModule {}
