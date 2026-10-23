import IORedis from "ioredis";
import { config } from "./config";

const g = globalThis as unknown as { __redis?: IORedis };

// maxRetriesPerRequest: null is required by BullMQ for blocking connections.
// family: 0 resolves both IPv4 and IPv6, which Railway's private network (IPv6) needs.
const options = { maxRetriesPerRequest: null, lazyConnect: true, family: 0 } as const;

export const redis: IORedis = g.__redis ?? new IORedis(config.redisUrl, options);
if (process.env.NODE_ENV !== "production") g.__redis = redis;

export function newRedisConnection() {
  return new IORedis(config.redisUrl, options);
}
