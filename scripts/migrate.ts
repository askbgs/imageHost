// Create or upgrade the database tables. The app and worker also do this on startup,
// so running it by hand (or as a pre-deploy command) is optional.
// Usage: node dist/migrate.js
import { pool } from "../lib/db";
import { migrate } from "../lib/migrate";

migrate(pool)
  .then(async (r) => {
    console.log(`Done: ${r.applied} applied, ${r.total} migrations in total.`);
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
