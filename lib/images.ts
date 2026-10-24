import { config } from "./config";
import { pool, query, queryOne } from "./db";
import { ApiError } from "./http";
import { newDeleteToken, newImageId, newUploadSuffix } from "./ids";
import type { ImageRow, VariantRow } from "./links";
import { purgeUrls } from "./cdn";
import { links } from "./links";
import { addImagesToAlbum, assertAlbumOwner } from "./albums";
import { assertStorageAvailable } from "./quota";
import { deleteObjects } from "./s3";
import { safeStem } from "./filetype";

export function parseExpiration(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    value === "0" ||
    value === 0
  )
    return null;
  const n = Number(value);
  if (
    !Number.isInteger(n) ||
    n < config.minExpirationSeconds ||
    n > config.maxExpirationSeconds
  ) {
    throw new ApiError(
      "invalid_expiration",
      `expiration must be between ${config.minExpirationSeconds} and ${config.maxExpirationSeconds} seconds`,
    );
  }
  return n;
}

export async function createPendingImage(opts: {
  name: string | null;
  expirationSeconds: number | null;
  uploaderIp: string | null;
  userId?: string | null;
  apiKeyId?: string | null;
  /** Size of the file being uploaded (received, or declared for a direct upload). Counts against the quota. */
  bytes: number;
  /** Put the image in this album (must belong to the uploader). */
  albumId?: string | null;
}): Promise<ImageRow> {
  // Retry on the (very unlikely) id collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newImageId();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Accounts have a storage allowance; refuse the upload before anything is stored.
      if (opts.albumId)
        await assertAlbumOwner(client, opts.albumId, opts.userId);
      if (opts.userId)
        await assertStorageAvailable(client, opts.userId, opts.bytes);
      const { rows } = await client.query<ImageRow>(
        `INSERT INTO images (id, user_id, api_key_id, original_name, title, slug, storage_key, upload_key,
                             delete_token, expires_at, uploader_ip, status, source, upload_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8,
                 CASE WHEN $9::int IS NULL THEN NULL ELSE now() + make_interval(secs => $9::int) END,
                 $10, 'pending', $11, $12)
         RETURNING *`,
        [
          id,
          opts.userId ?? null,
          opts.apiKeyId ?? null,
          opts.name?.slice(0, 255) ?? null,
          opts.name
            ? opts.name.replace(/\.[A-Za-z0-9]{1,5}$/, "").slice(0, 120)
            : null,
          safeStem(opts.name),
          // Unguessable: with a public bucket, raw (unprocessed) uploads must not be reachable.
          `uploads/${id}-${newUploadSuffix()}`,
          newDeleteToken(),
          opts.expirationSeconds,
          opts.uploaderIp,
          // Uploads made with an API key are tagged "api"; everything from the website is "web".
          opts.apiKeyId ? "api" : "web",
          opts.bytes,
        ],
      );
      if (opts.albumId && opts.userId)
        await addImagesToAlbum(opts.albumId, opts.userId, [id], client);
      await client.query("COMMIT");
      return rows[0]!;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if ((err as { code?: string }).code === "23505" && attempt < 2) continue;
      throw err;
    } finally {
      client.release();
    }
  }
  throw new Error("could not allocate an image id");
}

export async function getImage(id: string): Promise<ImageRow | null> {
  return queryOne<ImageRow>(`SELECT * FROM images WHERE id = $1`, [id]);
}

export async function getVariants(id: string): Promise<VariantRow[]> {
  return query<VariantRow>(`SELECT * FROM image_variants WHERE image_id = $1`, [
    id,
  ]);
}

/** Images that can be shown publicly right now. */
export function isLive(img: ImageRow): boolean {
  if (img.status !== "active" && img.status !== "flagged") return false;
  if (img.expires_at && new Date(img.expires_at).getTime() <= Date.now())
    return false;
  return true;
}

/**
 * Delete an image's stored files. With keepRecord the row stays (status = removed) so
 * moderation history survives; otherwise the row is deleted.
 */
export async function removeImage(
  img: ImageRow,
  opts: { keepRecord?: boolean; blockReason?: string } = {},
) {
  const variants = await getVariants(img.id);
  await deleteObjects([
    img.storage_key,
    img.upload_key,
    ...variants.map((v) => v.storage_key),
  ]);
  const l = links(img);
  await purgeUrls([l.direct, l.thumb, l.medium]);
  if (opts.blockReason && img.sha256) {
    await query(
      `INSERT INTO blocked_hashes (sha256, reason) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [img.sha256, opts.blockReason],
    );
  }
  if (opts.keepRecord) {
    await query(`DELETE FROM image_variants WHERE image_id = $1`, [img.id]);
    await query(`UPDATE images SET status = 'removed' WHERE id = $1`, [img.id]);
  } else {
    await query(`DELETE FROM images WHERE id = $1`, [img.id]);
  }
}

/** Map a failed processing result to the API error a client should see. */
export function failureToError(reason: string | null | undefined): ApiError {
  switch (reason) {
    case "blocked_content":
      return new ApiError("blocked_content", "This image cannot be uploaded");
    case "unsupported_type":
      return new ApiError(
        "unsupported_type",
        "Unsupported image type (JPG, PNG, GIF, WebP, AVIF, BMP, TIFF)",
      );
    case "file_too_large":
      return new ApiError(
        "file_too_large",
        `Images must be ${config.maxUploadBytes / 1024 / 1024} MB or smaller`,
      );
    case "too_many_pixels":
      return new ApiError("invalid_image", "Image dimensions are too large");
    default:
      return new ApiError(
        "invalid_image",
        "The file could not be read as an image",
      );
  }
}
