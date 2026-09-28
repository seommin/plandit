import { Module } from "@nestjs/common";

import { loggerModule } from "../common/logger";
import { PaymentModule } from "../payment/payment.module";
import { PaymentReconcileProcessor } from "./payment-reconcile.processor";

/** Background jobs. Same services as the HTTP app, different entrypoint (src/worker.ts). */
@Module({
  imports: [loggerModule, PaymentModule],
  providers: [PaymentReconcileProcessor],
})
export class WorkerModule {}
