import { collectDefaultMetrics, Counter, Histogram, register } from "prom-client";

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

export { register };
