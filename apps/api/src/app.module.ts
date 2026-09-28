import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { AuthController } from "./auth/auth.controller";
import { CalendarController } from "./calendar/calendar.controller";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { loggerModule } from "./common/logger";
import { CreditModule } from "./credit/credit.module";
import { EventsController } from "./events/events.controller";
import { HealthController } from "./health/health.controller";
import { InternalApiGuard } from "./internal-api.guard";
import { PaymentModule } from "./payment/payment.module";
import { PushController } from "./push/push.controller";
import { SharesController } from "./shares/shares.controller";
import { RolesGuard } from "./workspace/roles";
import { WorkspaceModule } from "./workspace/workspace.module";

@Module({
  imports: [loggerModule, WorkspaceModule, CreditModule, PaymentModule],
  controllers: [
    AuthController,
    CalendarController,
    EventsController,
    HealthController,
    PushController,
    SharesController,
  ],
  providers: [
    // Order matters: internal-secret check first, then workspace role check.
    { provide: APP_GUARD, useClass: InternalApiGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
