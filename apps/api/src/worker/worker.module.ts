import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { loggerModule } from "../common/logger";
import { PaymentModule } from "../payment/payment.module";
import { ReminderModule } from "../reminder/reminder.module";
import { PaymentReconcileProcessor } from "./payment-reconcile.processor";
import { ReminderProcessor } from "./reminder.processor";

/** Background jobs. Same services as the HTTP app, different entrypoint (src/worker.ts). */
@Module({
  imports: [loggerModule, AuditModule, PaymentModule, ReminderModule],
  providers: [PaymentReconcileProcessor, ReminderProcessor],
})
export class WorkerModule {}
