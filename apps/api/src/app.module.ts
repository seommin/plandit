import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { AiModule } from "./ai/ai.module";
import { AssistantModule } from "./assistant/assistant.module";
import { ApiKeyModule } from "./apikey/api-key.module";
import { AuditModule } from "./audit/audit.module";
import { AuthController } from "./auth/auth.controller";
import { CalendarController } from "./calendar/calendar.controller";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { loggerModule } from "./common/logger";
import { CreditModule } from "./credit/credit.module";
import { EventsController } from "./events/events.controller";
import { HealthController } from "./health/health.controller";
import { InternalApiGuard } from "./internal-api.guard";
import { MetricsModule } from "./metrics/metrics.module";
import { OpsController } from "./ops/ops.controller";
import { PaymentModule } from "./payment/payment.module";
import { ProfileController, ProfileService } from "./profile/profile.controller";
import { PushController } from "./push/push.controller";
import { ReminderModule } from "./reminder/reminder.module";
import { SharesController } from "./shares/shares.controller";
import { TripModule } from "./trip/trip.module";
import { RolesGuard } from "./workspace/roles";
import { WorkspaceModule } from "./workspace/workspace.module";

@Module({
  imports: [loggerModule, AuditModule, WorkspaceModule, CreditModule, PaymentModule, ReminderModule, ApiKeyModule, AiModule, TripModule, AssistantModule, MetricsModule],
  controllers: [
    AuthController,
    CalendarController,
    EventsController,
    HealthController,
    OpsController,
    ProfileController,
    PushController,
    SharesController,
  ],
  providers: [
    ProfileService,
    // Order matters: internal-secret check first, then workspace role check.
    { provide: APP_GUARD, useClass: InternalApiGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
