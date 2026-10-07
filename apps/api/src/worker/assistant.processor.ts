import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Worker } from "bullmq";

import type { RunJob } from "../assistant/assistant.queue";
import { AssistantService } from "../assistant/assistant.service";
import { requestContext } from "../common/request-context";
import { jobRuns } from "../metrics/metrics";
import { QUEUES, redisConnection } from "../queue/redis-connection";

/** Consumes "run" jobs: advances one assistant conversation, inside the trace id of the request that triggered it. */
@Injectable()
export class AssistantProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AssistantProcessor.name);
  private worker?: Worker;

  constructor(private readonly assistant: AssistantService) {}

  onApplicationBootstrap() {
    this.worker = new Worker(
      QUEUES.assistant,
      (job) => {
        const { threadId, traceId } = job.data as RunJob;
        return requestContext.run({ traceId: traceId ?? `job-${job.id}` }, () => this.assistant.run(threadId));
      },
      { connection: redisConnection(), concurrency: Number(process.env.ASSISTANT_CONCURRENCY ?? 4) },
    );
    this.worker.on("completed", (job) => jobRuns.inc({ queue: QUEUES.assistant, name: job.name, outcome: "completed" }));
    this.worker.on("failed", (job, error) => {
      jobRuns.inc({ queue: QUEUES.assistant, name: job?.name ?? "unknown", outcome: "failed" });
      this.logger.error({ jobId: job?.id, attempt: job?.attemptsMade, err: error }, "Assistant job failed");
      // Out of retries: end the turn so the person can write again instead of waiting on a conversation stuck RUNNING.
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        this.assistant.abort((job.data as RunJob).threadId).catch((err) => this.logger.error({ err }, "Assistant abort failed"));
      }
    });
    this.logger.log(`Worker listening on queue "${QUEUES.assistant}"`);
  }

  async onApplicationShutdown() {
    await this.worker?.close();
  }
}
