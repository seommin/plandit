import { collectDefaultMetrics, Counter, Gauge, Histogram, register } from "prom-client";

/**
 * Prometheus metrics (default registry, one per process). The api serves them at /metrics; the worker at
 * WORKER_METRICS_PORT. Counters live here so any service can bump them; DB/queue gauges are in MetricsService.
 */
collectDefaultMetrics({ prefix: "plandit_" });

const counter = <L extends string>(name: string, help: string, labelNames: readonly L[]) =>
  (register.getSingleMetric(name) as Counter<L> | undefined) ?? new Counter({ name, help, labelNames });

export const httpRequests = counter("plandit_http_requests_total", "HTTP requests by route and status", ["method", "route", "status"]);
export const httpDuration =
  (register.getSingleMetric("plandit_http_request_duration_seconds") as Histogram<"method" | "route" | "status"> | undefined) ??
  new Histogram({
    name: "plandit_http_request_duration_seconds",
    help: "HTTP request latency",
    labelNames: ["method", "route", "status"],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  });

/** source: pg | relay. result: APPLIED, DUPLICATE_EVENT, ALREADY_APPLIED, AMOUNT_MISMATCH, CONFLICT_STATE, invalid_signature … */
export const webhookEvents = counter("plandit_webhook_events_total", "Incoming PG/carrier webhooks by result", ["source", "result"]);

/** outcome: applied | replayed | insufficient */
export const ledgerAppends = counter("plandit_ledger_appends_total", "Credit ledger append attempts", ["type", "outcome"]);

export const reminderDeliveries = counter("plandit_reminder_deliveries_total", "Reminder deliveries reaching a final state", ["channel", "status"]);

/** outcome: completed | failed (a failed attempt may still be retried) */
export const jobRuns = counter("plandit_jobs_total", "Background job attempts", ["queue", "name", "outcome"]);

/** outcome: SUCCEEDED or the failure code (LLM_TIMEOUT, LLM_REFUSED, INVALID_OUTPUT …) */
export const aiCalls = counter("plandit_ai_calls_total", "Metered LLM calls by result", ["provider", "outcome"]);
/** kind: input | output | cache_read | cache_write — every attempt, including refunded calls */
export const aiTokens = counter("plandit_ai_tokens_total", "LLM tokens used", ["model", "kind"]);
export const aiCallDuration =
  (register.getSingleMetric("plandit_ai_call_duration_seconds") as Histogram<"provider"> | undefined) ??
  new Histogram({
    name: "plandit_ai_call_duration_seconds",
    help: "LLM call latency (SDK retries included)",
    labelNames: ["provider"],
    buckets: [1, 5, 15, 30, 60, 120, 300, 600],
  });

/** Set by the worker's daily ledger check (PLANDIT-12): problems found in the last run. Alert on > 0. */
export const ledgerCheckIssues =
  (register.getSingleMetric("plandit_ledger_check_issues") as Gauge<"kind"> | undefined) ??
  new Gauge({ name: "plandit_ledger_check_issues", help: "Ledger/balance mismatches found by the last daily check", labelNames: ["kind"] });

export { register };
