import { redis } from "../redis";

/**
 * Fixed-window counter in Redis: INCR + EXPIRE in one MULTI, shared by every api process.
 * ponytail: a burst at a window edge can reach 2×limit; switch to a sliding window if that ever matters.
 */
export async function hitRateLimit(bucket: string, limit: number, windowSeconds = 60) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const key = `ratelimit:${bucket}:${Math.floor(nowSeconds / windowSeconds)}`;
  const results = await redis.multi().incr(key).expire(key, windowSeconds).exec();
  const count = Number(results?.[0]?.[1] ?? 0);

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetSeconds: windowSeconds - (nowSeconds % windowSeconds),
  };
}
