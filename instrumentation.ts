// Runs once when the Next.js server starts, before it accepts requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SKIP_MIGRATIONS === "true") return;
  const { pool } = await import("./lib/db");
  const { migrate } = await import("./lib/migrate");

  // The database may still be starting (for example right after a deploy): retry for ~1 minute.
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate(pool);
      await checkStorage();
      if (process.env.RUN_WORKER === "true") {
        const { startWorker } = await import("./lib/worker-runtime");
        await startWorker("web-worker");
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message || err.name : String(err);
      // Connection errors can arrive as an AggregateError with an empty message (one per
      // address tried), so look at the error codes too.
      const e = err as { code?: string; errors?: { code?: string }[] };
      const codes = [e.code, ...(e.errors ?? []).map((x) => x.code)].filter(Boolean) as string[];
      const connection =
        codes.some((c) => ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "57P03"].includes(c)) ||
        /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|terminating|starting up|Connection terminated/i.test(msg);
      if (!connection || attempt >= 12) {
        console.error(`[migrate] could not prepare the database: ${msg}`);
        throw err;
      }
      console.warn(`[migrate] database not reachable yet (${msg}); retrying in 5s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/** Log storage problems at startup, where they're easy to spot in the deploy logs. */
async function checkStorage() {
  try {
    const { config } = await import("./lib/config");
    const { storageStatus } = await import("./lib/s3");
    const origin = new URL(config.siteUrl).origin;
    const st = await storageStatus(origin);
    if (st.bucket !== "ok") console.error(`[storage] ${st.bucket}`);
    if (config.uploadMode === "direct" && st.cors === "missing") {
      console.warn(
        `[storage] The bucket's CORS rule doesn't allow uploads from ${origin}` +
          (st.corsOrigins.length ? ` (it allows: ${st.corsOrigins.join(", ")})` : " (no CORS rule set)") +
          ". Browser uploads will go through the site instead. Run node dist/setup-bucket.js or see R2.md step 5.",
      );
    }
  } catch (err) {
    console.warn(`[storage] check failed: ${err instanceof Error ? err.message : err}`);
  }
}
