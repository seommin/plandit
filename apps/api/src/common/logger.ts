import { randomUUID } from "crypto";

import { LoggerModule } from "nestjs-pino";

import { requestContext } from "./request-context";

const pretty = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

/** Shared by the HTTP app and the worker so both write the same structured logs. */
export const loggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
    // traceMiddleware (request-context.ts) already chose the id and echoed it in X-Trace-Id.
    genReqId: (request) => (request as { id?: string }).id ?? randomUUID(),
    // Every log line — api request or worker job — carries the trace id of what caused it.
    mixin: () => {
      const traceId = requestContext.getStore()?.traceId;
      return traceId ? { traceId } : {};
    },
    redact: ['req.headers["x-api-secret"]', "req.headers.cookie", "req.headers.authorization"],
    transport: pretty ? { target: "pino-pretty", options: { singleLine: true } } : undefined,
  },
});
