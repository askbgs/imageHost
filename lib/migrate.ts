import type { Pool } from "pg";
import { MIGRATIONS } from "./migrations";

// Any constant works; it only has to be the same in every process that migrates.
const LOCK_ID = 7_340_201;

/**
 * Bring the database schema up to date. Safe to call from several processes at once
 * (web app, worker, pre-deploy command): an advisory lock makes them take turns, and
 * migrations already recorded are skipped.
 */
export async function migrate(pool: Pool, log: (msg: string) => void = console.log) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         INT PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const done = new Set(
      (await client.query<{ id: number }>("SELECT id FROM schema_migrations")).rows.map((r) => r.id),
    );
    const pending = MIGRATIONS.filter((m) => !done.has(m.id)).sort((a, b) => a.id - b.id);
    for (const m of pending) {
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (id, name) VALUES ($1, $2)", [m.id, m.name]);
        await client.query("COMMIT");
        log(`[migrate] applied ${m.id}: ${m.name}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${m.id} (${m.name}) failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (pending.length === 0) log("[migrate] schema is up to date");
    return { applied: pending.length, total: MIGRATIONS.length };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
  }
}

/** Latest migration id in code, and the latest one applied to the database. */
export async function schemaStatus(pool: Pool) {
  const latest = Math.max(...MIGRATIONS.map((m) => m.id));
  try {
    const r = await pool.query<{ max: number | null }>("SELECT max(id) AS max FROM schema_migrations");
    return { latest, applied: r.rows[0]?.max ?? 0 };
  } catch {
    return { latest, applied: 0 };
  }
}
