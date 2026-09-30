import { Module } from "@nestjs/common";

import { AiModule } from "../ai/ai.module";
import { TripPlanController } from "./trip-plan.controller";
import { TripPlanQueue } from "./trip-plan.queue";
import { TripPlanService } from "./trip-plan.service";

@Module({
  imports: [AiModule],
  controllers: [TripPlanController],
  providers: [TripPlanService, TripPlanQueue],
  exports: [TripPlanService],
})
export class TripModule {}
