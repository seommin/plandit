import { Module } from "@nestjs/common";

import { CreditModule } from "../credit/credit.module";
import { MESSAGE_PROVIDER } from "./message-provider";
import { MockRelayAdapter } from "./mock-relay.adapter";
import { ReminderDispatchService } from "./reminder-dispatch.service";
import { RelayWebhookService } from "./relay-webhook.service";
import { RelayWebhookController, ReminderController } from "./reminder.controller";
import { ReminderQueue } from "./reminder.queue";
import { ReminderService } from "./reminder.service";

@Module({
  imports: [CreditModule],
  controllers: [ReminderController, RelayWebhookController],
  providers: [
    ReminderQueue,
    ReminderService,
    ReminderDispatchService,
    RelayWebhookService,
    {
      provide: MESSAGE_PROVIDER,
      useFactory: () => {
        const provider = process.env.MESSAGE_PROVIDER ?? "mock";
        if (provider === "mock") return new MockRelayAdapter();
        throw new Error(`Unknown MESSAGE_PROVIDER: ${provider}`);
      },
    },
  ],
  exports: [ReminderService, ReminderDispatchService],
})
export class ReminderModule {}
