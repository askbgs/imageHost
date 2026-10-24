import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Metadata, OutputInfo, Sharp } from "sharp";
import { config } from "./config";
import { query } from "./db";
import { OUTPUT, sniffImage, type ImageKind } from "./filetype";
import { getImage } from "./images";
import type { ProcessResult } from "./queue";
import { isBlockedHash, nsfwScore } from "./moderation";
import { purgeUrls } from "./cdn";
import { links } from "./links";
import { deleteObjects, getObjectBuffer, objectCacheControl, putObject } from "./s3";

const THUMB = 180; // square crop
const MEDIUM = 640; // longest-edge cap for the display size

function encoder(img: Sharp, kind: (typeof OUTPUT)[ImageKind]["kind"]) {
  switch (kind) {
    case "jpeg":
      return img.jpeg({ quality: 88, mozjpeg: true });
    case "png":
      return img.png({ compressionLevel: 9 });
    case "gif":
      return img.gif();
    case "webp":
      return img.webp({ quality: 85 });
    case "avif":
      return img.avif({ quality: 60 });
  }
}

async function fail(imageId: string, reason: string, uploadKey: string): Promise<ProcessResult> {
  await query(`UPDATE images SET status = 'failed', fail_reason = $2 WHERE id = $1`, [imageId, reason]);
  await deleteObjects([uploadKey]).catch(() => {});
  return { status: "failed", reason };
}

/**
 * Re-encode an upload: this strips EXIF/GPS and any payload hidden in the file, applies
 * orientation, and writes the original plus thumb and medium variants to storage.
 */
export async function processImage(imageId: string): Promise<ProcessResult> {
  const img = await getImage(imageId);
  if (!img) return { status: "failed", reason: "missing" };
  if (img.status === "active" || img.status === "flagged") return { status: img.status };
  if (img.status === "removed") return { status: "failed", reason: "removed" };

  await query(`UPDATE images SET status = 'processing' WHERE id = $1`, [imageId]);

  let raw: Buffer;
  try {
    raw = await getObjectBuffer(img.upload_key, config.maxUploadBytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("too large")) return fail(imageId, "file_too_large", img.upload_key);
    throw err; // storage hiccup: let BullMQ retry
  }

  const kind = sniffImage(raw);
  if (!kind) return fail(imageId, "unsupported_type", img.upload_key);

  const sha256 = createHash("sha256").update(raw).digest("hex");
  if (await isBlockedHash(sha256)) return fail(imageId, "blocked_content", img.upload_key);

  const out = OUTPUT[kind];
  const animated = kind === "gif" || kind === "webp";

  let meta: Metadata;
  try {
    meta = await sharp(raw, { limitInputPixels: config.maxPixels, animated }).metadata();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    return fail(imageId, /pixel limit/i.test(msg) ? "too_many_pixels" : "invalid_image", img.upload_key);
  }
  const isAnimated = (meta.pages ?? 1) > 1;
  const base = () => {
    const s = sharp(raw, { limitInputPixels: config.maxPixels, animated: isAnimated });
    return isAnimated ? s : s.rotate(); // apply EXIF orientation before metadata is dropped
  };

  let original: { data: Buffer; info: OutputInfo };
  let thumb: { data: Buffer; info: OutputInfo };
  let medium: { data: Buffer; info: OutputInfo };
  try {
    original = await encoder(base(), out.kind).toBuffer({ resolveWithObject: true });
    thumb = await encoder(base().resize(THUMB, THUMB, { fit: "cover", position: "attention" }), out.kind).toBuffer({
      resolveWithObject: true,
    });
    medium = await encoder(base().resize(MEDIUM, MEDIUM, { fit: "inside", withoutEnlargement: true }), out.kind).toBuffer({
      resolveWithObject: true,
    });
  } catch {
    return fail(imageId, "invalid_image", img.upload_key);
  }

  const width = original.info.width;
  const height = isAnimated ? (original.info.pageHeight ?? original.info.height) : original.info.height;
  const slug = `${img.slug.replace(/\.[^.]+$/, "")}.${out.ext}`;
  // Keys mirror the public link paths ({id}/{file}, {id}/t/{file}, {id}/m/{file}), so a
  // public bucket domain (R2 custom domain) can serve them without going through the app.
  const keys = imageKeys(imageId, slug);
  const cache = objectCacheControl(img.expires_at);

  await Promise.all([
    putObject(keys.original, original.data, out.mime, cache),
    putObject(keys.thumb, thumb.data, out.mime, cache),
    putObject(keys.medium, medium.data, out.mime, cache),
  ]);

  // Score a still frame of the medium size: smaller and enough for a classifier.
  const score = await nsfwScore(await sharp(medium.data).jpeg().toBuffer(), "image/jpeg");
  const status = score !== null && score >= config.moderationThreshold ? "flagged" : "active";

  await query(`DELETE FROM image_variants WHERE image_id = $1`, [imageId]);
  await query(
    `INSERT INTO image_variants (image_id, variant, storage_key, mime_type, width, height, size_bytes)
     VALUES ($1, 'thumb', $2, $4, $5, $6, $7), ($1, 'medium', $3, $4, $8, $9, $10)`,
    [
      imageId,
      keys.thumb,
      keys.medium,
      out.mime,
      thumb.info.width,
      isAnimated ? (thumb.info.pageHeight ?? thumb.info.height) : thumb.info.height,
      thumb.data.length,
      medium.info.width,
      isAnimated ? (medium.info.pageHeight ?? medium.info.height) : medium.info.height,
      medium.data.length,
    ],
  );
  await query(
    `UPDATE images SET status = $2, slug = $3, storage_key = $4, mime_type = $5, size_bytes = $6,
            width = $7, height = $8, sha256 = $9, fail_reason = NULL
      WHERE id = $1`,
    [imageId, status, slug, keys.original, out.mime, original.data.length, width, height, sha256],
  );
  await deleteObjects([img.upload_key]).catch(() => {});

  return { status };
}

export function imageKeys(id: string, slug: string) {
  return { original: `${id}/${slug}`, thumb: `${id}/t/${slug}`, medium: `${id}/m/${slug}` };
}

/** Remove expired images and uploads that were never completed. */
export async function cleanup(): Promise<{ expired: number; stale: number }> {
  const expired = await query<{ id: string; slug: string; delete_token: string; storage_key: string; upload_key: string }>(
    `SELECT id, slug, delete_token, storage_key, upload_key FROM images
      WHERE expires_at IS NOT NULL AND expires_at <= now() AND status <> 'removed' LIMIT 500`,
  );
  const stale = await query<{ id: string; slug: string; delete_token: string; storage_key: string; upload_key: string }>(
    `SELECT id, slug, delete_token, storage_key, upload_key FROM images
      WHERE (status = 'pending' AND created_at < now() - interval '1 hour')
         OR (status = 'failed' AND created_at < now() - interval '1 day')
      LIMIT 500`,
  );
  for (const row of [...expired, ...stale]) {
    const variants = await query<{ storage_key: string }>(
      `SELECT storage_key FROM image_variants WHERE image_id = $1`,
      [row.id],
    );
    await deleteObjects([row.storage_key, row.upload_key, ...variants.map((v) => v.storage_key)]).catch(() => {});
    await query(`DELETE FROM images WHERE id = $1`, [row.id]);
  }
  await purgeUrls(expired.flatMap((r) => { const l = links(r); return [l.direct, l.thumb, l.medium]; }));
  return { expired: expired.length, stale: stale.length };
}
