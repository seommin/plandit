import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Queue, Worker } from "bullmq";

import { requestContext } from "../common/request-context";
import { MemoryService } from "../memory/memory.service";
import { jobRuns } from "../metrics/metrics";
import { QUEUES, redisConnection } from "../queue/redis-connection";

/**
 * Embedding sync (PLANDIT-22): a scheduler tick every EMBEDDING_SYNC_EVERY_MS catches events written by any path
 * (app, trip plans, the assistant, /v1, MCP); uploads also ask for a run at once. concurrency 1: one batch at a time,
 * so the CPU-bound local model never runs twice in one process.
 */
@Injectable()
export class MemoryProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MemoryProcessor.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly memory: MemoryService) {}

  async onApplicationBootstrap() {
    const connection = redisConnection();
    this.queue = new Queue(QUEUES.memory, { connection });
    await this.queue.upsertJobScheduler(
      "embedding-sync-tick",
      { every: Number(process.env.EMBEDDING_SYNC_EVERY_MS ?? 60_000) },
      { name: "sync", opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );
    this.worker = new Worker(QUEUES.memory, (job) => requestContext.run({ traceId: `job-${job.id}` }, () => this.memory.sync()), {
      connection,
      concurrency: 1,
    });
    this.worker.on("completed", (job) => jobRuns.inc({ queue: QUEUES.memory, name: job.name, outcome: "completed" }));
    this.worker.on("failed", (job, error) => {
      jobRuns.inc({ queue: QUEUES.memory, name: job?.name ?? "unknown", outcome: "failed" });
      this.logger.error({ jobId: job?.id, err: error }, "Embedding sync failed");
    });
    this.logger.log(`Worker listening on queue "${QUEUES.memory}"`);
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
