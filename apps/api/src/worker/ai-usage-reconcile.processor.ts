import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Queue, Worker } from "bullmq";

import { AiUsageService } from "../ai/ai-usage.service";
import { requestContext } from "../common/request-context";
import { jobRuns } from "../metrics/metrics";
import { QUEUES, redisConnection } from "../queue/redis-connection";

/**
 * Refunds AI usages stuck in RESERVED/CALLING past AI_USAGE_STALE_MS (process died mid-call, or the call never came
 * back). One job scheduler for all worker processes, concurrency 1 — same shape as PaymentReconcileProcessor.
 */
@Injectable()
export class AiUsageReconcileProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AiUsageReconcileProcessor.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly usages: AiUsageService) {}

  async onApplicationBootstrap() {
    const connection = redisConnection();
    this.queue = new Queue(QUEUES.aiUsageReconcile, { connection });
    await this.queue.upsertJobScheduler(
      "ai-usage-reconcile-tick",
      { every: Number(process.env.AI_USAGE_RECONCILE_EVERY_MS ?? 60_000) },
      { name: "reconcile", opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );

    this.worker = new Worker(
      QUEUES.aiUsageReconcile,
      (job) => requestContext.run({ traceId: `job-${job.id}` }, () => this.usages.reconcileStale()),
      { connection, concurrency: 1 },
    );
    this.worker.on("completed", (job) => jobRuns.inc({ queue: QUEUES.aiUsageReconcile, name: job.name, outcome: "completed" }));
    this.worker.on("failed", (job, error) => {
      jobRuns.inc({ queue: QUEUES.aiUsageReconcile, name: job?.name ?? "unknown", outcome: "failed" });
      this.logger.error({ jobId: job?.id, err: error }, "AI usage reconcile job failed");
    });
    this.logger.log(`Worker listening on queue "${QUEUES.aiUsageReconcile}"`);
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
