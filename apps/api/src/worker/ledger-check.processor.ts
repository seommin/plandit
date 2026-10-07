import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Queue, Worker } from "bullmq";

import { requestContext } from "../common/request-context";
import { LedgerCheckService } from "../credit/ledger-check.service";
import { jobRuns, ledgerCheckIssues } from "../metrics/metrics";
import { QUEUES, redisConnection } from "../queue/redis-connection";

/**
 * Daily ledger check (same check as `pnpm check:ledger`). One job scheduler shared by all workers, so it runs once
 * per day however many workers are up. Only reports: a mismatch is a bug or a manual edit, and fixing it is a human
 * decision (docs/runbook.md "E").
 */
@Injectable()
export class LedgerCheckProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LedgerCheckProcessor.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly check: LedgerCheckService) {}

  async onApplicationBootstrap() {
    const connection = redisConnection();
    this.queue = new Queue(QUEUES.ledgerCheck, { connection });
    // 05:00 Korean time by default: quiet hours, and after the demo reset at 04:00.
    await this.queue.upsertJobScheduler(
      "ledger-check-daily",
      { pattern: process.env.LEDGER_CHECK_CRON ?? "0 5 * * *", tz: process.env.LEDGER_CHECK_TZ ?? "Asia/Seoul" },
      { name: "check", opts: { removeOnComplete: 30, removeOnFail: 30 } },
    );

    this.worker = new Worker(QUEUES.ledgerCheck, (job) => requestContext.run({ traceId: `job-${job.id}` }, () => this.runOnce()), {
      connection,
      concurrency: 1,
    });
    this.worker.on("completed", (job) => jobRuns.inc({ queue: QUEUES.ledgerCheck, name: job.name, outcome: "completed" }));
    this.worker.on("failed", (job, error) => {
      jobRuns.inc({ queue: QUEUES.ledgerCheck, name: job?.name ?? "unknown", outcome: "failed" });
      this.logger.error({ jobId: job?.id, err: error }, "Ledger check job failed");
    });
  }

  async runOnce() {
    const result = await this.check.run();
    for (const kind of ["CACHE_MISMATCH", "BALANCE_AFTER_BREAK", "NEGATIVE_BALANCE"] as const) {
      ledgerCheckIssues.set({ kind }, result.issues.filter((issue) => issue.kind === kind).length);
    }
    if (result.issues.length) {
      this.logger.warn(
        { accounts: result.accounts, entries: result.entries, count: result.issues.length, truncated: result.truncated, issues: result.issues.slice(0, 20) },
        "Ledger check found mismatches — see runbook E",
      );
    } else {
      this.logger.log({ accounts: result.accounts, entries: result.entries }, "Ledger check passed");
    }
    return { accounts: result.accounts, entries: result.entries, issues: result.issues.length };
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
