import { Queue, QueueEvents } from "bullmq";
import { newRedisConnection } from "./redis";

export const QUEUE_NAME = "images";

export type ProcessJob = { imageId: string };
export type ProcessResult = { status: "active" | "flagged" | "failed"; reason?: string };

const g = globalThis as unknown as { __queue?: Queue; __queueEvents?: QueueEvents };

export function imageQueue(): Queue {
  if (!g.__queue) {
    g.__queue = new Queue(QUEUE_NAME, {
      connection: newRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 },
      },
    });
  }
  return g.__queue;
}

function queueEvents(): QueueEvents {
  if (!g.__queueEvents) g.__queueEvents = new QueueEvents(QUEUE_NAME, { connection: newRedisConnection() });
  return g.__queueEvents;
}

/**
 * Enqueue processing and wait for it. Returns null if it did not finish within timeoutMs
 * (the image keeps processing; the caller can poll).
 */
export async function processAndWait(imageId: string, timeoutMs = 60_000): Promise<ProcessResult | null> {
  const events = queueEvents();
  await events.waitUntilReady();
  const job = await imageQueue().add("process", { imageId } satisfies ProcessJob, { jobId: `process-${imageId}` });
  try {
    return (await job.waitUntilFinished(events, timeoutMs)) as ProcessResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timed out/i.test(msg)) return null;
    return { status: "failed", reason: "processing_error" };
  }
}
