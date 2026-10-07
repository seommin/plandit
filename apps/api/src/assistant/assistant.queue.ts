import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

import { requestContext } from "../common/request-context";
import { QUEUES, redisConnection } from "../queue/redis-connection";

export type RunJob = { threadId: string; traceId?: string };

/** Producer side of the assistant loop (the api enqueues, the worker advances the conversation). */
@Injectable()
export class AssistantQueue implements OnModuleDestroy {
  readonly queue = new Queue(QUEUES.assistant, { connection: redisConnection() });

  /** One job per trigger (a message, a decision): a retried request does not queue a second run. */
  async enqueueRun(threadId: string, trigger: string) {
    const traceId = requestContext.getStore()?.traceId;
    await this.queue.add("run", { threadId, traceId } satisfies RunJob, {
      jobId: `run_${threadId}_${trigger}`,
      // A retry resumes from the stored steps: a reserved call is executed at most once, a stored step is not redone.
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
