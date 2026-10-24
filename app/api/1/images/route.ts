import { authenticate, extractKey } from "@/lib/apikeys";
import { query } from "@/lib/db";
import { apiOk, handleError, preflight } from "@/lib/http";
import { imageData, type ImageRow, type VariantRow } from "@/lib/links";

export const runtime = "nodejs";
export const OPTIONS = preflight;

/** GET /1/images?page=1&per_page=50 — images uploaded by the key's owner, newest first. */
export async function GET(req: Request) {
  try {
    const key = await authenticate(extractKey(req));
    const url = new URL(req.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const perPage = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("per_page") || "50", 10) || 50));

    const rows = await query<ImageRow & { total: string }>(
      `SELECT *, count(*) OVER () AS total FROM images
        WHERE user_id = $1 AND status IN ('active', 'flagged')
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [key.user_id, perPage, (page - 1) * perPage],
    );
    const variants = rows.length
      ? await query<VariantRow>(`SELECT * FROM image_variants WHERE image_id = ANY($1)`, [rows.map((r) => r.id)])
      : [];
    const total = Number(rows[0]?.total ?? 0);

    return apiOk({
      page,
      per_page: perPage,
      total,
      images: rows.map((r) => imageData(r, variants.filter((v) => v.image_id === r.id))),
    });
  } catch (err) {
    return handleError(err);
  }
}
