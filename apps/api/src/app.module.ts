import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AuthController } from "./auth/auth.controller";
import { CalendarController } from "./calendar/calendar.controller";
import { EventsController } from "./events/events.controller";
import { InternalApiGuard } from "./internal-api.guard";
import { SharesController } from "./shares/shares.controller";

@Module({
  controllers: [
    AuthController,
    CalendarController,
    EventsController,
    SharesController,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: InternalApiGuard,
    },
  ],
})
export class AppModule {}
