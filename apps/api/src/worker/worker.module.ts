import { Module } from "@nestjs/common";

import { AiModule } from "../ai/ai.module";
import { AuditModule } from "../audit/audit.module";
import { loggerModule } from "../common/logger";
import { PaymentModule } from "../payment/payment.module";
import { ReminderModule } from "../reminder/reminder.module";
import { TripModule } from "../trip/trip.module";
import { AiUsageReconcileProcessor } from "./ai-usage-reconcile.processor";
import { PaymentReconcileProcessor } from "./payment-reconcile.processor";
import { ReminderProcessor } from "./reminder.processor";
import { TripPlanProcessor } from "./trip-plan.processor";

/** Background jobs. Same services as the HTTP app, different entrypoint (src/worker.ts). */
@Module({
  imports: [loggerModule, AuditModule, PaymentModule, ReminderModule, AiModule, TripModule],
  providers: [PaymentReconcileProcessor, ReminderProcessor, AiUsageReconcileProcessor, TripPlanProcessor],
})
export class WorkerModule {}
