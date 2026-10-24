import type { Worker } from "bullmq";
import { pool } from "../lib/db";
import { migrate } from "../lib/migrate";
import { startWorker } from "../lib/worker-runtime";

let worker: Worker | null = null;

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
  worker = await startWorker("worker");
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
