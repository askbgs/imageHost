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
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const connection = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|terminating|starting up|Connection terminated/i.test(msg);
      if (!connection || attempt >= 12) {
        console.error(`[migrate] could not prepare the database: ${msg}`);
        throw err;
      }
      console.warn(`[migrate] database not reachable yet (${msg}); retrying in 5s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
