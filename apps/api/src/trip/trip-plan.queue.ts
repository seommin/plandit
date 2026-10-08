import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

import { requestContext } from "../common/request-context";
import { QUEUES, redisConnection } from "../queue/redis-connection";

export type GenerateJob = { tripPlanId: string; traceId?: string };
export type ReviseJob = { revisionId: string; traceId?: string };

/**
 * Producer side of trip generation (the api enqueues, the worker calls the model). One job id per plan, so a
 * replayed create request or a retry never queues a second generation.
 */
@Injectable()
export class TripPlanQueue implements OnModuleDestroy {
  readonly queue = new Queue(QUEUES.tripPlans, { connection: redisConnection() });

  async enqueueGenerate(tripPlanId: string) {
    const traceId = requestContext.getStore()?.traceId;
    await this.queue.add("generate", { tripPlanId, traceId } satisfies GenerateJob, {
      jobId: `generate_${tripPlanId}`,
      // Only failures before the model is called are retried here (the LLM call itself is retried by the SDK, and
      // a usage already CALLING is skipped); anything left GENERATING is closed by the stale AI usage sweep.
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    });
  }

  /** A "고쳐 줘" request (PLANDIT-27): one job per revision, retried like generate. */
  async enqueueRevise(revisionId: string) {
    const traceId = requestContext.getStore()?.traceId;
    await this.queue.add("revise", { revisionId, traceId } satisfies ReviseJob, {
      jobId: `revise_${revisionId}`,
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
