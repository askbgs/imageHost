import { createHash } from "node:crypto";
import { query, queryOne } from "./db";
import { ApiError, limitHeaders } from "./http";
import { newApiKey } from "./ids";
import { rateLimit } from "./ratelimit";

export type ApiKey = { id: string; user_id: string; rate_limit: number; user_status: string };

export const hashKey = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** Find the API key in the query string, X-API-Key header, Bearer token, or a form field. */
export function extractKey(req: Request, formKey?: FormDataEntryValue | null): string | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("key");
  if (fromQuery) return fromQuery;
  const header = req.headers.get("x-api-key");
  if (header) return header;
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  if (typeof formKey === "string" && formKey) return formKey;
  return null;
}

export async function authenticate(raw: string | null): Promise<ApiKey> {
  if (!raw) throw new ApiError("invalid_key", "An API key is required");
  const key = await queryOne<ApiKey>(
    `SELECT k.id, k.user_id, k.rate_limit, u.status AS user_status
       FROM api_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [hashKey(raw)],
  );
  if (!key || key.user_status !== "active") throw new ApiError("invalid_key", "Invalid or revoked API key");
  // Best effort; never block a request on this write.
  query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [key.id]).catch(() => {});
  return key;
}

/** Throws rate_limited when the key is over its hourly upload limit. */
export async function enforceKeyLimit(key: ApiKey) {
  const r = await rateLimit(`rl:key:${key.id}`, key.rate_limit);
  if (!r.ok) throw new ApiError("rate_limited", "Upload limit reached for this API key", limitHeaders(r));
  return r;
}

export async function createKey(userId: string, name: string, rateLimitPerHour = 100) {
  const raw = newApiKey();
  await query(
    `INSERT INTO api_keys (user_id, key_hash, key_prefix, name, rate_limit) VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashKey(raw), raw.slice(0, 8), name, rateLimitPerHour],
  );
  return raw;
}
