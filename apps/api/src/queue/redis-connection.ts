/** BullMQ connection options. BullMQ opens its own connections (blocking commands), separate from `redis.ts`. */
export const redisConnection = () => ({
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
  maxRetriesPerRequest: null,
});

export const QUEUES = {
  paymentReconcile: "payment-reconcile",
} as const;
