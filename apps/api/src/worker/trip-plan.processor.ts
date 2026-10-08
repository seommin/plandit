import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Worker } from "bullmq";

import { requestContext } from "../common/request-context";
import { jobRuns } from "../metrics/metrics";
import { QUEUES, redisConnection } from "../queue/redis-connection";
import type { GenerateJob, ReviseJob } from "../trip/trip-plan.queue";
import { TripPlanService } from "../trip/trip-plan.service";

/** Consumes "generate" (one model call per trip plan) and "revise" (one per "고쳐 줘" request) jobs, inside the trace id of the request. */
@Injectable()
export class TripPlanProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TripPlanProcessor.name);
  private worker?: Worker;

  constructor(private readonly plans: TripPlanService) {}

  onApplicationBootstrap() {
    this.worker = new Worker(
      QUEUES.tripPlans,
      (job) => {
        const traceId = (job.data as { traceId?: string }).traceId ?? `job-${job.id}`;
        return requestContext.run({ traceId }, () =>
          job.name === "revise" ? this.plans.revise((job.data as ReviseJob).revisionId) : this.plans.generate((job.data as GenerateJob).tripPlanId),
        );
      },
      // Model calls take tens of seconds; a few at a time per process keeps the provider's rate limits in reach.
      { connection: redisConnection(), concurrency: Number(process.env.TRIP_PLAN_CONCURRENCY ?? 2) },
    );
    this.worker.on("completed", (job) => jobRuns.inc({ queue: QUEUES.tripPlans, name: job.name, outcome: "completed" }));
    this.worker.on("failed", (job, error) => {
      jobRuns.inc({ queue: QUEUES.tripPlans, name: job?.name ?? "unknown", outcome: "failed" });
      this.logger.error({ jobId: job?.id, attempt: job?.attemptsMade, err: error }, "Trip plan job failed");
    });
    this.logger.log(`Worker listening on queue "${QUEUES.tripPlans}"`);
  }

  async onApplicationShutdown() {
    await this.worker?.close();
  }
}
