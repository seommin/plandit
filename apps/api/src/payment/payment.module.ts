import { Module } from "@nestjs/common";

import { CreditModule } from "../credit/credit.module";
import { MockPgAdapter } from "./mock-pg.adapter";
import { PAYMENT_GATEWAY } from "./payment-gateway";
import { PaymentReconcileService } from "./payment-reconcile.service";
import { PaymentWebhookService } from "./payment-webhook.service";
import { PaymentController, PaymentWebhookController } from "./payment.controller";
import { PaymentService } from "./payment.service";

@Module({
  imports: [CreditModule],
  controllers: [PaymentController, PaymentWebhookController],
  providers: [
    PaymentService,
    PaymentWebhookService,
    PaymentReconcileService,
    {
      provide: PAYMENT_GATEWAY,
      useFactory: () => {
        const provider = process.env.PAYMENT_PROVIDER ?? "mock";
        if (provider === "mock") return new MockPgAdapter();
        throw new Error(`Unknown PAYMENT_PROVIDER: ${provider}`);
      },
    },
  ],
  exports: [PaymentReconcileService],
})
export class PaymentModule {}
