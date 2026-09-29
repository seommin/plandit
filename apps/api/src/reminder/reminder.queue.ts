import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

import { requestContext } from "../common/request-context";
import { QUEUES, redisConnection } from "../queue/redis-connection";

/** traceId: the request that (re)scheduled the reminder, carried into the worker's logs and audit rows. */
export type FireJob = { reminderId: string; fireAt: string; traceId?: string };
export type SendJob = { deliveryId: string; traceId?: string };

/**
 * Producer side of the reminder queue (the api process schedules, the worker process consumes).
 * Job ids carry the fire time, so rescheduling an event adds a *new* job and never collides with the old one;
 * the old job notices the time no longer matches when it runs and does nothing.
 */
@Injectable()
export class ReminderQueue implements OnModuleDestroy {
  readonly queue = new Queue(QUEUES.reminders, { connection: redisConnection() });

  async scheduleFire(reminderId: string, fireAt: Date) {
    const delay = fireAt.getTime() - Date.now();
    if (delay < 0) return false; // too late to remind; never send reminders after the fact
    const traceId = requestContext.getStore()?.traceId;
    await this.queue.add("fire", { reminderId, fireAt: fireAt.toISOString(), traceId } satisfies FireJob, {
      jobId: `fire_${reminderId}_${fireAt.getTime()}`,
      delay,
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    });
    return true;
  }

  async enqueueSends(deliveryIds: string[], traceId?: string) {
    await this.queue.addBulk(
      deliveryIds.map((deliveryId) => ({
        name: "send",
        data: { deliveryId, traceId } satisfies SendJob,
        opts: {
          jobId: `send_${deliveryId}`,
          attempts: Number(process.env.RELAY_SEND_ATTEMPTS ?? 6),
          // 429 / 5xx from the carrier: 1s, 2s, 4s, 8s, 16s …
          // jitter spreads retries so a burst of 429s does not come back as one synchronized burst
          backoff: { type: "exponential", delay: Number(process.env.RELAY_BACKOFF_MS ?? 1_000), jitter: 0.5 },
          removeOnComplete: 1_000,
          removeOnFail: 1_000,
        },
      })),
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
