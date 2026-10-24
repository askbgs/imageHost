import { config } from "@/lib/config";
import { pool } from "@/lib/db";
import { schemaStatus } from "@/lib/migrate";
import { workerCount } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { storageStatus } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const origin = new URL(config.siteUrl).origin;
  const result: Record<string, unknown> & { ok: boolean } = { ok: false, database: "unknown", redis: "unknown" };
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
  if (result.redis === "ok") {
    const n = await workerCount();
    result.image_workers =
      n === null
        ? "unknown (Redis doesn't list clients)"
        : n > 0
          ? `${n} connected`
          : "none connected: the web app is processing images itself. Start the worker service (node dist/worker.js) or set RUN_WORKER=true";
  }
  const st = await storageStatus(origin).catch(() => ({ bucket: "unreachable", cors: "unknown" as const, corsOrigins: [] }));
  result.storage = st.bucket;
  if (config.uploadMode === "direct") {
    result.browser_uploads =
      st.cors === "ok"
        ? "direct to storage"
        : st.cors === "missing"
          ? `through the site: the bucket's CORS rule doesn't allow PUT from ${origin}${st.corsOrigins.length ? ` (it allows ${st.corsOrigins.join(", ")})` : ""}`
          : "direct to storage, falling back to the site if blocked (CORS rule couldn't be read with these keys)";
  } else {
    result.browser_uploads = "through the site (UPLOAD_MODE=server)";
  }
  // Storage problems break uploads, so they count against health; CORS doesn't (uploads fall back).
  result.ok = result.database === "ok" && result.redis === "ok" && result.storage === "ok";
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
