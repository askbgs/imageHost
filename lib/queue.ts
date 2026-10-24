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

/** Number of worker processes connected to the queue, or null if Redis won't say. */
export async function workerCount(): Promise<number | null> {
  try {
    return await imageQueue().getWorkersCount();
  } catch {
    return null; // some Redis hosts disable CLIENT LIST
  }
}

// If no worker has started a job after this long, the web app processes the image itself.
const PICKUP_GRACE_MS = Number(process.env.WORKER_PICKUP_TIMEOUT_MS || 8000);

let warned = false;
function warnNoWorker(reason: string) {
  if (warned) return;
  warned = true;
  console.warn(
    `[queue] ${reason}. Processing images in the web app instead. ` +
      "Check that the worker service is running (start command: node dist/worker.js) with the same REDIS_URL, " +
      "or set RUN_WORKER=true on the web service to process images there.",
  );
}

async function processInline(imageId: string): Promise<ProcessResult> {
  const { processImage } = await import("./process");
  try {
    return await processImage(imageId);
  } catch (err) {
    console.error(`[process] ${imageId} failed in the web app:`, err);
    return { status: "failed", reason: "processing_error" };
  }
}

/**
 * Enqueue processing and wait for it. Returns null if it did not finish within timeoutMs
 * (the image keeps processing; the caller can poll).
 *
 * When no worker picks the job up (worker service missing, crashed or on another Redis),
 * the job is taken back off the queue and processed here, so uploads never hang.
 */
export async function processAndWait(imageId: string, timeoutMs = 60_000): Promise<ProcessResult | null> {
  const events = queueEvents();
  await events.waitUntilReady();
  const queue = imageQueue();
  const job = await queue.add("process", { imageId } satisfies ProcessJob, { jobId: `process-${imageId}` });

  // Take the job back and run it here, unless a worker has already locked it.
  const takeOver = async (reason: string) => {
    try {
      const state = await job.getState();
      if (state !== "waiting" && state !== "prioritized" && state !== "delayed") return false;
      await job.remove();
    } catch {
      return false; // a worker grabbed it in the meantime
    }
    warnNoWorker(reason);
    return true;
  };

  if ((await workerCount()) === 0 && (await takeOver("No image worker is connected"))) {
    return processInline(imageId);
  }
  warned = false;

  const finished = job.waitUntilFinished(events, timeoutMs).then(
    (r) => ({ kind: "done" as const, result: r as ProcessResult }),
    (err) => ({ kind: "error" as const, msg: err instanceof Error ? err.message : String(err) }),
  );
  const grace = new Promise<{ kind: "grace" }>((r) => setTimeout(() => r({ kind: "grace" }), PICKUP_GRACE_MS));

  let outcome = await Promise.race([finished, grace]);
  if (outcome.kind === "grace") {
    if (await takeOver(`No worker picked up the image within ${PICKUP_GRACE_MS / 1000}s`)) {
      return processInline(imageId);
    }
    outcome = await finished; // a worker is on it: keep waiting
  }
  if (outcome.kind === "done") return outcome.result;
  if (/timed out/i.test(outcome.msg)) return null;
  return { status: "failed", reason: "processing_error" };
}

/**
 * For an image still waiting in the queue (for example uploaded while no worker was running):
 * if nobody has picked its job up for a while, process it here. Returns true if it did.
 */
export async function rescueStuck(imageId: string, createdAt: Date): Promise<boolean> {
  if (Date.now() - new Date(createdAt).getTime() < PICKUP_GRACE_MS) return false;
  const job = await imageQueue().getJob(`process-${imageId}`);
  if (!job) return false;
  try {
    const state = await job.getState();
    if (state !== "waiting" && state !== "prioritized" && state !== "delayed") return false;
    await job.remove();
  } catch {
    return false;
  }
  warnNoWorker("An image was left waiting in the queue");
  await processInline(imageId);
  return true;
}
