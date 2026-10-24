import { Worker } from "bullmq";
import { cleanup, processImage } from "./process";
import { QUEUE_NAME, imageQueue, type ProcessJob } from "./queue";
import { newRedisConnection } from "./redis";

/** Start processing image jobs in this process. Used by the worker service, or by the web app with RUN_WORKER=true. */
export async function startWorker(label = "worker") {
  const concurrency = Number(process.env.WORKER_CONCURRENCY || "2");
  const worker = new Worker<ProcessJob>(
    QUEUE_NAME,
    async (job) => {
      if (job.name === "cleanup") {
        const r = await cleanup();
        if (r.expired || r.stale) console.log(`[cleanup] removed ${r.expired} expired, ${r.stale} stale`);
        return r;
      }
      const result = await processImage(job.data.imageId);
      console.log(`[process] ${job.data.imageId} → ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
      return result;
    },
    { connection: newRedisConnection(), concurrency },
  );
  worker.on("failed", (job, err) => console.error(`[${label}] job ${job?.id} failed:`, err.message));
  worker.on("error", (err) => console.error(`[${label}] ${err.message}`));

  // Run cleanup every 10 minutes (BullMQ de-duplicates the repeatable job across restarts).
  await imageQueue().upsertJobScheduler("cleanup-every-10m", { every: 10 * 60 * 1000 }, { name: "cleanup", data: {} as ProcessJob });
  console.log(`[${label}] processing images from queue "${QUEUE_NAME}" with concurrency ${concurrency}`);
  return worker;
}
