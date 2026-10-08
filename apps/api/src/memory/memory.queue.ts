import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

import { QUEUES, redisConnection } from "../queue/redis-connection";

/** Producer side of embedding sync: an upload asks for a run now instead of waiting for the next tick. */
@Injectable()
export class MemoryQueue implements OnModuleDestroy {
  readonly queue = new Queue(QUEUES.memory, { connection: redisConnection() });

  async enqueueSync(trigger: string) {
    await this.queue.add("sync", {}, { jobId: `sync_${trigger}`, attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 500, removeOnFail: 500 });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
