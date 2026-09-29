import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

export type RequestContext = { traceId: string; ip?: string; userAgent?: string };

/** Per-request data that deep services (audit, logs) need without threading it through every call. */
export const requestContext = new AsyncLocalStorage<RequestContext>();

const TRACE_ID = /^[\w-]{1,128}$/;

type Req = { id?: string; ip?: string; headers: Record<string, string | string[] | undefined> };
type Res = { setHeader(name: string, value: string): void };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Runs before everything else: accepts the caller's X-Trace-Id (or makes one), echoes it back, and opens the
 * context. The web server forwards the end user's IP / user agent (x-forwarded-for / x-client-user-agent).
 */
export function traceMiddleware(req: Req, res: Res, next: () => void) {
  const incoming = first(req.headers["x-trace-id"]);
  const traceId = incoming && TRACE_ID.test(incoming) ? incoming : randomUUID();
  req.id = traceId;
  res.setHeader("x-trace-id", traceId);

  requestContext.run(
    {
      traceId,
      ip: first(req.headers["x-forwarded-for"])?.split(",")[0].trim() || req.ip,
      userAgent: first(req.headers["x-client-user-agent"]) ?? first(req.headers["user-agent"]),
    },
    next,
  );
}
