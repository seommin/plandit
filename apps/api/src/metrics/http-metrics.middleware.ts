import { httpDuration, httpRequests } from "./metrics";

type Req = { method: string; baseUrl?: string; route?: { path?: string } };
type Res = { statusCode: number; on(event: "finish", listener: () => void): void };

/** Labels by route *pattern* (/workspaces/:workspaceId/credits), never the raw URL, to keep cardinality bounded. */
export function httpMetricsMiddleware(req: Req, res: Res, next: () => void) {
  const stop = httpDuration.startTimer();
  res.on("finish", () => {
    const route = req.route?.path ? `${req.baseUrl ?? ""}${req.route.path}` : "unmatched";
    if (route === "/metrics") return;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequests.inc(labels);
    stop(labels);
  });
  next();
}
