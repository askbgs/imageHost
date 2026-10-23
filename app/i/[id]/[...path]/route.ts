import { query } from "@/lib/db";
import { IMAGE_ID_RE } from "@/lib/ids";
import { getImage, isLive } from "@/lib/images";
import { config } from "@/lib/config";
import { getObjectStream, presignGet } from "@/lib/s3";

export const runtime = "nodejs";

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60", "Content-Type": "text/plain" } });

/**
 * Serves image bytes:  /i/{id}/{file}  (original)  ·  /i/{id}/t/{file}  (thumb)  ·  /i/{id}/m/{file}  (medium)
 * Put a CDN in front of this path; responses are immutable per id.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await ctx.params;
  if (!IMAGE_ID_RE.test(id) || path.length < 1 || path.length > 2) return notFound();

  const img = await getImage(id);
  if (!img || !isLive(img)) return notFound();

  let key = img.storage_key;
  let mime = img.mime_type ?? "application/octet-stream";
  if (path.length === 2) {
    const variant = path[0] === "t" ? "thumb" : path[0] === "m" ? "medium" : null;
    if (!variant) return notFound();
    const row = (await query<{ storage_key: string; mime_type: string }>(
      `SELECT storage_key, mime_type FROM image_variants WHERE image_id = $1 AND variant = $2`,
      [id, variant],
    ))[0];
    if (!row) return notFound();
    key = row.storage_key;
    mime = row.mime_type;
  }

  // Expiring images must not be cached past their deletion time.
  const maxAge = img.expires_at
    ? Math.max(0, Math.floor((new Date(img.expires_at).getTime() - Date.now()) / 1000))
    : 31536000;

  if (config.imageDelivery === "redirect") {
    // Bytes come straight from the bucket. The redirect is cached for at most an hour and
    // the signed URL lives for a day, so a cached redirect never points at an expired URL.
    const redirectTtl = Math.min(3600, maxAge);
    const url = await presignGet(key, { contentType: mime, expiresIn: 86400, cacheSeconds: Math.min(maxAge, 86400) });
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        "Cache-Control": `public, max-age=${redirectTtl}`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const etag = `"${id}-${path.length === 2 ? path[0] : "o"}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": `public, max-age=${maxAge}` } });
  }

  try {
    const obj = await getObjectStream(key);
    const body = obj.Body?.transformToWebStream();
    if (!body) return notFound();
    return new Response(body, {
      headers: {
        "Content-Type": mime,
        ...(obj.ContentLength ? { "Content-Length": String(obj.ContentLength) } : {}),
        "Cache-Control": img.expires_at ? `public, max-age=${maxAge}` : "public, max-age=31536000, immutable",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Content-Disposition": "inline",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return notFound();
  }
}
