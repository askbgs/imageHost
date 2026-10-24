import { Worker } from "bullmq";
import { pool } from "../lib/db";
import { migrate } from "../lib/migrate";
import { cleanup, processImage } from "../lib/process";
import { QUEUE_NAME, imageQueue, type ProcessJob } from "../lib/queue";
import { newRedisConnection } from "../lib/redis";

const concurrency = Number(process.env.WORKER_CONCURRENCY || "2");
let worker: Worker<ProcessJob> | null = null;

async function migrateWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate(pool);
      return;
    } catch (err) {
      if (attempt >= 12) throw err;
      console.warn(`[migrate] ${err instanceof Error ? err.message : err}; retrying in 5s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function main() {
  // Tables must exist before the first job runs.
  await migrateWithRetry();

  worker = new Worker<ProcessJob>(
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
  worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err.message);
  });

  // Run cleanup every 10 minutes (BullMQ de-duplicates the repeatable job across restarts).
  await imageQueue().upsertJobScheduler("cleanup-every-10m", { every: 10 * 60 * 1000 }, { name: "cleanup", data: {} as ProcessJob });
  console.log(`[worker] listening on queue "${QUEUE_NAME}" with concurrency ${concurrency}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function shutdown() {
  console.log("[worker] shutting down");
  await worker?.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
