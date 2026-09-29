import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { type Job, Queue, Worker } from "bullmq";

import { QUEUES, redisConnection } from "../queue/redis-connection";
import { ReminderDispatchService } from "../reminder/reminder-dispatch.service";
import type { FireJob, SendJob } from "../reminder/reminder.queue";

/**
 * Consumes the reminder queue: "fire" (fan-out at the reminder time), "send" (one delivery, retried with
 * exponential backoff on 429/5xx), and a "reconcile-sent" tick for results the carrier never reported.
 */
@Injectable()
export class ReminderProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReminderProcessor.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly dispatch: ReminderDispatchService) {}

  async onApplicationBootstrap() {
    const connection = redisConnection();
    this.queue = new Queue(QUEUES.reminders, { connection });
    await this.queue.upsertJobScheduler(
      "reminder-reconcile-tick",
      { every: Number(process.env.RELAY_RECONCILE_EVERY_MS ?? 60_000) },
      { name: "reconcile-sent", opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );

    this.worker = new Worker(QUEUES.reminders, (job) => this.process(job), {
      connection,
      concurrency: Number(process.env.REMINDER_SEND_CONCURRENCY ?? 10),
    });
    this.worker.on("failed", (job, error) =>
      this.logger.warn({ job: job?.name, jobId: job?.id, attempt: job?.attemptsMade, err: error.message }, "Reminder job failed"),
    );
  }

  private process(job: Job) {
    switch (job.name) {
      case "fire": {
        const { reminderId, fireAt } = job.data as FireJob;
        return this.dispatch.fire(reminderId, fireAt);
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
    await this.worker?.close();
    await this.queue?.close();
  }
}
