/**
 * Albums: named groups of an account's images, shared with one link (/a/{id}).
 *
 * Visibility:
 *   public    anyone with the link; listed on the owner's profile (/u/{username}) and indexable
 *   unlisted  anyone with the link; not listed anywhere, not indexed
 *   private   only the owner (Pro and Business). Hides the album page, not the images: each image
 *             keeps its own links, like any other upload.
 *
 * An image can be in several albums. Deleting an album never deletes its images.
 */
import type { PoolClient } from "pg";
import { config } from "./config";
import { query, queryOne } from "./db";
import { ApiError } from "./http";
import { ALBUM_ID_RE } from "./ids";
import { links, type ImageRow } from "./links";
import { planFor, type Plan } from "./plans";

export type Visibility = "public" | "unlisted" | "private";
export const VISIBILITIES: Visibility[] = ["public", "unlisted", "private"];
export const isVisibility = (v: unknown): v is Visibility =>
  VISIBILITIES.includes(v as Visibility);

export const VISIBILITY_INFO: Record<
  Visibility,
  { label: string; hint: string }
> = {
  public: {
    label: "Public",
    hint: "Anyone with the link can view it. Shown on your profile.",
  },
  unlisted: {
    label: "Unlisted",
    hint: "Only people you share the link with can view it.",
  },
  private: { label: "Private", hint: "Only you can open the album page." },
};

export const TITLE_MAX = 100;

/** The album field of an upload request: an album ID, or nothing. */
export const albumParam = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
export const DESCRIPTION_MAX = 500;

export type AlbumRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  visibility: Visibility;
  cover_image_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type AlbumSummary = AlbumRow & {
  image_count: number;
  cover: string | null;
};

export const albumUrl = (id: string) => `${config.siteUrl}/a/${id}`;

/** Images that can be shown: not deleted, not failed, not expired. */
const LIVE = `i.status IN ('active', 'flagged') AND (i.expires_at IS NULL OR i.expires_at > now())`;

export async function getAlbum(id: string): Promise<AlbumRow | null> {
  if (!ALBUM_ID_RE.test(id)) return null;
  return queryOne<AlbumRow>(`SELECT * FROM albums WHERE id = $1`, [id]);
}

/** Who may open an album page. */
export function canView(album: AlbumRow, viewerId: string | null | undefined) {
  return album.visibility !== "private" || album.user_id === viewerId;
}

/**
 * An account's albums with image counts and a cover: the chosen cover if it's still live,
 * else the most recently added image.
 */
export async function listAlbums(
  userId: string,
  opts: { visibility?: Visibility } = {},
): Promise<AlbumSummary[]> {
  const rows = await query<
    AlbumRow & { image_count: number; cover_row: ImageRow | null }
  >(
    `SELECT a.*,
            (SELECT count(*)::int FROM album_images ai JOIN images i ON i.id = ai.image_id
              WHERE ai.album_id = a.id AND ${LIVE}) AS image_count,
            (SELECT row_to_json(i) FROM album_images ai JOIN images i ON i.id = ai.image_id
              WHERE ai.album_id = a.id AND ${LIVE} AND i.status = 'active'
              ORDER BY (i.id = a.cover_image_id) DESC, ai.position DESC LIMIT 1) AS cover_row
       FROM albums a
      WHERE a.user_id = $1 AND ($2::text IS NULL OR a.visibility = $2)
      ORDER BY a.updated_at DESC`,
    [userId, opts.visibility ?? null],
  );
  return rows.map(({ cover_row, ...a }) => ({
    ...a,
    cover: cover_row ? links(cover_row).medium : null,
  }));
}

/** The images in an album, newest additions first. */
export async function albumImages(
  albumId: string,
  opts: { limit?: number; offset?: number } = {},
) {
  return query<ImageRow & { total: string }>(
    `SELECT i.*, count(*) OVER () AS total
       FROM album_images ai JOIN images i ON i.id = ai.image_id
      WHERE ai.album_id = $1 AND ${LIVE}
      ORDER BY ai.position DESC, ai.added_at DESC
      LIMIT $2 OFFSET $3`,
    [albumId, opts.limit ?? 60, opts.offset ?? 0],
  );
}

export async function accountPlan(userId: string): Promise<Plan> {
  const account = await queryOne<{ plan: string; role: string }>(
    `SELECT plan, role FROM users WHERE id = $1`,
    [userId],
  );
  return planFor(account ?? {});
}

/** Private albums are a paid feature. Throws a friendly error on plans without it. */
export function assertVisibilityAllowed(plan: Plan, visibility: Visibility) {
  if (visibility === "private" && !plan.privateAlbums) {
    throw new ApiError(
      "forbidden",
      "Private albums are part of Pro and Business. Choose Public or Unlisted, or upgrade to make albums private.",
    );
  }
}

/**
 * Adds images to an album. Only the album owner's own live images are added; others are skipped.
 * New images go to the top. Returns how many were added (already-present ones don't count).
 */
export async function addImagesToAlbum(
  albumId: string,
  userId: string,
  imageIds: string[],
  client?: PoolClient,
): Promise<number> {
  if (imageIds.length === 0) return 0;
  const run = client ? client.query.bind(client) : null;
  const sql = `
    WITH base AS (SELECT COALESCE(max(position), 0) AS p FROM album_images WHERE album_id = $1),
         picked AS (
           SELECT i.id, row_number() OVER (ORDER BY i.created_at) AS n
             FROM images i
            WHERE i.id = ANY($3) AND i.user_id = $2 AND i.status IN ('pending', 'processing', 'active', 'flagged')
         )
    INSERT INTO album_images (album_id, image_id, position)
    SELECT $1, picked.id, base.p + picked.n FROM picked, base
       WHERE EXISTS (SELECT 1 FROM albums WHERE id = $1 AND user_id = $2)
    ON CONFLICT DO NOTHING
    RETURNING image_id`;
  const params = [albumId, userId, imageIds];
  const rows = run ? (await run(sql, params)).rows : await query(sql, params);
  if (rows.length) {
    const touch = `UPDATE albums SET updated_at = now() WHERE id = $1`;
    if (run) await run(touch, [albumId]);
    else await query(touch, [albumId]);
  }
  return rows.length;
}

/**
 * For uploads into an album: checks, inside the upload's transaction, that the album exists and
 * belongs to the uploader. Throws if not, so nothing is stored.
 */
export async function assertAlbumOwner(
  client: PoolClient,
  albumId: string,
  userId: string | null | undefined,
) {
  if (!userId)
    throw new ApiError("unauthorized", "Sign in to upload into an album");
  if (!ALBUM_ID_RE.test(albumId))
    throw new ApiError("invalid_request", "album must be an album ID");
  const { rows } = await client.query(
    `SELECT 1 FROM albums WHERE id = $1 AND user_id = $2`,
    [albumId, userId],
  );
  if (rows.length === 0)
    throw new ApiError(
      "not_found",
      "Album not found. Check the album ID in its link (/a/…)",
    );
}
