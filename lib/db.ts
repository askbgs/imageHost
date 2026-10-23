import { Pool, type QueryResultRow } from "pg";
import { config } from "./config";

// One pool per process; survives Next.js dev hot reloads.
const g = globalThis as unknown as { __pgPool?: Pool };

export const pool: Pool =
  g.__pgPool ?? new Pool({ connectionString: config.databaseUrl, max: 10 });
if (process.env.NODE_ENV !== "production") g.__pgPool = pool;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
