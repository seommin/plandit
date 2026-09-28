import { randomUUID } from "crypto";

import { LoggerModule } from "nestjs-pino";

const TRACE_ID = /^[\w-]{1,128}$/;
const pretty = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

/** Shared by the HTTP app and the worker so both write the same structured logs. */
export const loggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
    genReqId(request, response) {
      const incoming = request.headers["x-trace-id"];
      const traceId = typeof incoming === "string" && TRACE_ID.test(incoming) ? incoming : randomUUID();
      response.setHeader("x-trace-id", traceId);
      return traceId;
    },
    redact: ['req.headers["x-api-secret"]', "req.headers.cookie", "req.headers.authorization"],
    transport: pretty ? { target: "pino-pretty", options: { singleLine: true } } : undefined,
  },
});
