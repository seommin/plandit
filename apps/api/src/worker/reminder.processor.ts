import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { type Job, Queue, Worker } from "bullmq";

import { requestContext } from "../common/request-context";
import { jobRuns } from "../metrics/metrics";
import { QUEUES, redisConnection } from "../queue/redis-connection";
import { ReminderDispatchService } from "../reminder/reminder-dispatch.service";
import type { FireJob, SendJob } from "../reminder/reminder.queue";

/**
 * Consumes the reminder queues: "fire" (fan-out at the reminder time), "send" (one delivery, retried with
 * exponential backoff on 429/5xx; paid ones on their own rate-limited queue), and a "reconcile-sent" tick for
 * results the carrier never reported.
 */
@Injectable()
export class ReminderProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReminderProcessor.name);
  private queue?: Queue;
  private workers: Worker[] = [];

  constructor(private readonly dispatch: ReminderDispatchService) {}

  async onApplicationBootstrap() {
    const connection = redisConnection();
    this.queue = new Queue(QUEUES.reminders, { connection });
    await this.queue.upsertJobScheduler(
      "reminder-reconcile-tick",
      { every: Number(process.env.RELAY_RECONCILE_EVERY_MS ?? 60_000) },
      { name: "reconcile-sent", opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );

    // Jobs run inside the trace id of the request that scheduled them (or job-<id>), for logs and audit rows.
    const handle = (job: Job) =>
      requestContext.run({ traceId: (job.data as { traceId?: string }).traceId ?? `job-${job.id}` }, () => this.process(job));
    const concurrency = Number(process.env.REMINDER_SEND_CONCURRENCY ?? 10);
    this.workers = [
      new Worker(QUEUES.reminders, handle, { connection, concurrency }),
      // Paid sends go out at the carrier's per-second limit. The limiter's count lives in Redis, so it holds across
      // every worker process: a 1,000-person fan-out waits its turn instead of burning its retries on 429s (PLANDIT-30).
      new Worker(QUEUES.reminderSends, handle, {
        connection,
        concurrency,
        limiter: { max: Number(process.env.RELAY_SEND_RPS ?? 20), duration: 1_000 },
      }),
    ];
    for (const worker of this.workers) {
      worker.on("completed", (job) => jobRuns.inc({ queue: worker.name, name: job.name, outcome: "completed" }));
      worker.on("failed", (job, error) => {
        jobRuns.inc({ queue: worker.name, name: job?.name ?? "unknown", outcome: "failed" });
        this.logger.warn({ job: job?.name, jobId: job?.id, attempt: job?.attemptsMade, err: error.message }, "Reminder job failed");
      });
    }
  }

  private process(job: Job) {
    switch (job.name) {
      case "fire": {
        const { reminderId, fireAt, traceId } = job.data as FireJob;
        return this.dispatch.fire(reminderId, fireAt, traceId);
      }
      case "send": {
        const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        return this.dispatch.send((job.data as SendJob).deliveryId, finalAttempt);
      }
      case "reconcile-sent":
        return this.dispatch.reconcileSent();
      default:
        throw new Error(`Unknown reminder job: ${job.name}`);
    }
  }

  async onApplicationShutdown() {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.queue?.close();
  }
}
