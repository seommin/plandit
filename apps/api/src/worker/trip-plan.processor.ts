import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Worker } from "bullmq";

import { requestContext } from "../common/request-context";
import { jobRuns } from "../metrics/metrics";
import { QUEUES, redisConnection } from "../queue/redis-connection";
import type { GenerateJob } from "../trip/trip-plan.queue";
import { TripPlanService } from "../trip/trip-plan.service";

/** Consumes "generate" jobs: one model call per trip plan, inside the trace id of the request that created it. */
@Injectable()
export class TripPlanProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TripPlanProcessor.name);
  private worker?: Worker;

  constructor(private readonly plans: TripPlanService) {}

  onApplicationBootstrap() {
    this.worker = new Worker(
      QUEUES.tripPlans,
      (job) => {
        const { tripPlanId, traceId } = job.data as GenerateJob;
        return requestContext.run({ traceId: traceId ?? `job-${job.id}` }, () => this.plans.generate(tripPlanId));
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
