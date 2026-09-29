import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Queue, Worker } from "bullmq";

import { requestContext } from "../common/request-context";
import { jobRuns } from "../metrics/metrics";
import { PaymentReconcileService } from "../payment/payment-reconcile.service";
import { QUEUES, redisConnection } from "../queue/redis-connection";

/**
 * One job scheduler ("every RECONCILE_EVERY_MS") shared by all worker processes: BullMQ creates a single job per
 * interval, so running several workers never reconciles the same tick twice. concurrency 1 keeps ticks sequential.
 */
@Injectable()
export class PaymentReconcileProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentReconcileProcessor.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly reconcile: PaymentReconcileService) {}

  async onApplicationBootstrap() {
    const connection = redisConnection();
    this.queue = new Queue(QUEUES.paymentReconcile, { connection });
    await this.queue.upsertJobScheduler(
      "payment-reconcile-tick",
      { every: Number(process.env.RECONCILE_EVERY_MS ?? 60_000) },
      { name: "reconcile", opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );

    this.worker = new Worker(
      QUEUES.paymentReconcile,
      (job) => requestContext.run({ traceId: `job-${job.id}` }, () => this.reconcile.run()),
      { connection, concurrency: 1 },
    );
    this.worker.on("completed", (job) => jobRuns.inc({ queue: QUEUES.paymentReconcile, name: job.name, outcome: "completed" }));
    this.worker.on("failed", (job, error) => {
      jobRuns.inc({ queue: QUEUES.paymentReconcile, name: job?.name ?? "unknown", outcome: "failed" });
      this.logger.error({ jobId: job?.id, err: error }, "Reconcile job failed");
    });
    this.logger.log(`Worker listening on queue "${QUEUES.paymentReconcile}"`);
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
