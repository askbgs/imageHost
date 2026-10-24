import { randomUUID } from "node:crypto";
import { redis } from "./redis";

export type RateResult = { ok: boolean; remaining: number; retryAfter: number; limit: number };

/**
 * Sliding-window rate limit on a Redis sorted set.
 * key: e.g. "rl:guest:1.2.3.4"; limit: max events per window.
 */
export async function rateLimit(key: string, limit: number, windowSeconds = 3600): Promise<RateResult> {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const member = `${now}-${randomUUID()}`;

  const results = await redis
    .multi()
    .zremrangebyscore(key, 0, windowStart)
    .zadd(key, now, member)
    .zcard(key)
    .zrange(key, 0, 0, "WITHSCORES")
    .expire(key, windowSeconds)
    .exec();

  const count = Number(results?.[2]?.[1] ?? 0);
  if (count <= limit) {
    return { ok: true, remaining: limit - count, retryAfter: 0, limit };
  }
  // Over the limit: drop the event we just added so blocked attempts don't extend the ban.
  await redis.zrem(key, member);
  const oldest = (results?.[3]?.[1] as string[] | undefined)?.[1];
  const retryAfter = oldest ? Math.max(1, Math.ceil((Number(oldest) + windowSeconds * 1000 - now) / 1000)) : windowSeconds;
  return { ok: false, remaining: 0, retryAfter, limit };
}

/** How many events the sliding window currently holds, and seconds until the oldest drops out. */
export async function rateUsage(key: string, windowSeconds = 3600): Promise<{ used: number; resetIn: number }> {
  const now = Date.now();
  await redis.zremrangebyscore(key, 0, now - windowSeconds * 1000);
  const [used, oldest] = await Promise.all([redis.zcard(key), redis.zrange(key, 0, 0, "WITHSCORES")]);
  const resetIn = oldest[1] ? Math.max(0, Math.ceil((Number(oldest[1]) + windowSeconds * 1000 - now) / 1000)) : 0;
  return { used, resetIn };
}
