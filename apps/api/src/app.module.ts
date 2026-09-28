import { randomUUID } from "crypto";

import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";

import { AuthController } from "./auth/auth.controller";
import { CalendarController } from "./calendar/calendar.controller";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { EventsController } from "./events/events.controller";
import { HealthController } from "./health/health.controller";
import { InternalApiGuard } from "./internal-api.guard";
import { PushController } from "./push/push.controller";
import { SharesController } from "./shares/shares.controller";
import { RolesGuard } from "./workspace/roles";
import { WorkspaceController } from "./workspace/workspace.controller";
import { WorkspaceService } from "./workspace/workspace.service";

const TRACE_ID = /^[\w-]{1,128}$/;

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
        genReqId(request, response) {
          const incoming = request.headers["x-trace-id"];
          const traceId = typeof incoming === "string" && TRACE_ID.test(incoming) ? incoming : randomUUID();
          response.setHeader("x-trace-id", traceId);
          return traceId;
        },
        redact: ['req.headers["x-api-secret"]', "req.headers.cookie", "req.headers.authorization"],
        transport:
          process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test"
            ? undefined : { target: "pino-pretty", options: { singleLine: true } },
      },
    }),
  ],
  controllers: [
    AuthController,
    CalendarController,
    EventsController,
    HealthController,
    PushController,
    SharesController,
    WorkspaceController,
  ],
  providers: [
    WorkspaceService,
    // Order matters: internal-secret check first, then workspace role check.
    { provide: APP_GUARD, useClass: InternalApiGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
