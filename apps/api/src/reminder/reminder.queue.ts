import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

import { QUEUES, redisConnection } from "../queue/redis-connection";

export type FireJob = { reminderId: string; fireAt: string };
export type SendJob = { deliveryId: string };

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
    await this.queue.add("fire", { reminderId, fireAt: fireAt.toISOString() } satisfies FireJob, {
      jobId: `fire_${reminderId}_${fireAt.getTime()}`,
      delay,
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    });
    return true;
  }

  async enqueueSends(deliveryIds: string[]) {
    await this.queue.addBulk(
      deliveryIds.map((deliveryId) => ({
        name: "send",
        data: { deliveryId } satisfies SendJob,
        opts: {
          jobId: `send_${deliveryId}`,
          attempts: Number(process.env.RELAY_SEND_ATTEMPTS ?? 6),
          // 429 / 5xx from the carrier: 1s, 2s, 4s, 8s, 16s …
          backoff: { type: "exponential", delay: Number(process.env.RELAY_BACKOFF_MS ?? 1_000) },
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
