import { pool } from "@/lib/db";
import { schemaStatus } from "@/lib/migrate";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result: { ok: boolean; database: string; redis: string; schema?: { applied: number; latest: number } } = {
    ok: false,
    database: "unknown",
    redis: "unknown",
  };
  try {
    await pool.query("SELECT 1");
    result.database = "ok";
    const s = await schemaStatus(pool);
    result.schema = s;
    if (s.applied < s.latest) result.database = "tables missing or out of date";
  } catch (err) {
    result.database = `unreachable: ${err instanceof Error ? err.message : err}`;
  }
  try {
    await redis.ping();
    result.redis = "ok";
  } catch {
    result.redis = "unreachable";
  }
  result.ok = result.database === "ok" && result.redis === "ok";
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
