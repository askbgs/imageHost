"use server";

import { revalidatePath } from "next/cache";
import {
  accountPlan,
  addImagesToAlbum,
  assertVisibilityAllowed,
  DESCRIPTION_MAX,
  getAlbum,
  isVisibility,
  TITLE_MAX,
  type Visibility,
} from "@/lib/albums";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { ApiError } from "@/lib/http";
import { IMAGE_ID_RE, newAlbumId } from "@/lib/ids";

export type AlbumResult = { ok?: string; error?: string; id?: string };

const MAX_BATCH = 500;

function clean(input: {
  title?: unknown;
  description?: unknown;
  visibility?: unknown;
}) {
  const title = String(input.title ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const description = String(input.description ?? "").trim();
  if (!title) throw new ApiError("invalid_request", "Give the album a name.");
  if (title.length > TITLE_MAX)
    throw new ApiError(
      "invalid_request",
      `Keep the name under ${TITLE_MAX} characters.`,
    );
  if (description.length > DESCRIPTION_MAX)
    throw new ApiError(
      "invalid_request",
      `Keep the description under ${DESCRIPTION_MAX} characters.`,
    );
  const visibility: Visibility = isVisibility(input.visibility)
    ? input.visibility
    : "unlisted";
  return { title, description: description || null, visibility };
}

const ids = (list: unknown) =>
  (Array.isArray(list) ? list : [])
    .filter((x): x is string => typeof x === "string" && IMAGE_ID_RE.test(x))
    .slice(0, MAX_BATCH);

async function run(
  fn: (userId: string) => Promise<AlbumResult>,
): Promise<AlbumResult> {
  const user = await currentUser();
  if (!user) return { error: "Sign in again to manage your albums." };
  try {
    return await fn(user.id);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    console.error("[albums]", err);
    return { error: "Something went wrong. Please try again." };
  }
}

function refresh(albumId?: string) {
  revalidatePath("/account/albums");
  revalidatePath("/account");
  if (albumId) {
    revalidatePath(`/account/albums/${albumId}`);
    revalidatePath(`/a/${albumId}`);
  }
}

/** Creates an album, optionally with images already in it (from My images). */
export async function createAlbum(input: {
  title: string;
  description?: string;
  visibility?: string;
  imageIds?: string[];
}): Promise<AlbumResult> {
  return run(async (userId) => {
    const a = clean(input);
    assertVisibilityAllowed(await accountPlan(userId), a.visibility);
    const id = newAlbumId();
    await query(
      `INSERT INTO albums (id, user_id, title, description, visibility) VALUES ($1, $2, $3, $4, $5)`,
      [id, userId, a.title, a.description, a.visibility],
    );
    const added = await addImagesToAlbum(id, userId, ids(input.imageIds));
    refresh(id);
    return {
      id,
      ok: added
        ? `Album “${a.title}” created with ${added} image${added === 1 ? "" : "s"}`
        : `Album “${a.title}” created`,
    };
  });
}

export async function updateAlbum(
  albumId: string,
  input: { title: string; description?: string; visibility: string },
): Promise<AlbumResult> {
  return run(async (userId) => {
    const album = await getAlbum(albumId);
    if (!album || album.user_id !== userId)
      return { error: "Album not found." };
    const a = clean(input);
    // Keeping an album private is always allowed (e.g. after moving to Free); making one private needs the plan.
    if (a.visibility !== album.visibility)
      assertVisibilityAllowed(await accountPlan(userId), a.visibility);
    await query(
      `UPDATE albums SET title = $2, description = $3, visibility = $4, updated_at = now() WHERE id = $1`,
      [albumId, a.title, a.description, a.visibility],
    );
    refresh(albumId);
    return { ok: "Album saved" };
  });
}

/** Deletes the album only. Its images stay in My images. */
export async function deleteAlbum(albumId: string): Promise<AlbumResult> {
  return run(async (userId) => {
    const gone = await query(
      `DELETE FROM albums WHERE id = $1 AND user_id = $2 RETURNING id`,
      [albumId, userId],
    );
    if (gone.length === 0) return { error: "Album not found." };
    refresh(albumId);
    return { ok: "Album deleted. Its images are still in My images." };
  });
}

export async function addToAlbum(
  albumId: string,
  imageIds: string[],
): Promise<AlbumResult> {
  return run(async (userId) => {
    const album = await getAlbum(albumId);
    if (!album || album.user_id !== userId)
      return { error: "Album not found." };
    const list = ids(imageIds);
    const added = await addImagesToAlbum(albumId, userId, list);
    refresh(albumId);
    const already = list.length - added;
    return {
      id: albumId,
      ok:
        added === 0
          ? `Already in “${album.title}”`
          : `Added ${added} image${added === 1 ? "" : "s"} to “${album.title}”${already ? ` (${already} already there)` : ""}`,
    };
  });
}

export async function removeFromAlbum(
  albumId: string,
  imageIds: string[],
): Promise<AlbumResult> {
  return run(async (userId) => {
    const album = await getAlbum(albumId);
    if (!album || album.user_id !== userId)
      return { error: "Album not found." };
    const gone = await query(
      `DELETE FROM album_images WHERE album_id = $1 AND image_id = ANY($2) RETURNING image_id`,
      [albumId, ids(imageIds)],
    );
    await query(`UPDATE albums SET updated_at = now() WHERE id = $1`, [
      albumId,
    ]);
    refresh(albumId);
    return {
      ok: `Removed ${gone.length} image${gone.length === 1 ? "" : "s"} from the album`,
    };
  });
}

export async function setAlbumCover(
  albumId: string,
  imageId: string,
): Promise<AlbumResult> {
  return run(async (userId) => {
    const ok = await queryOne(
      `UPDATE albums a SET cover_image_id = $3, updated_at = now()
        WHERE a.id = $1 AND a.user_id = $2
          AND EXISTS (SELECT 1 FROM album_images ai WHERE ai.album_id = a.id AND ai.image_id = $3)
        RETURNING a.id`,
      [albumId, userId, imageId],
    );
    if (!ok) return { error: "That image isn't in this album." };
    refresh(albumId);
    return { ok: "Cover updated" };
  });
}

/** The account's albums, for pickers (upload page, My images). */
export async function myAlbumOptions(): Promise<
  { id: string; title: string; visibility: Visibility }[]
> {
  const user = await currentUser();
  if (!user) return [];
  return query(
    `SELECT id, title, visibility FROM albums WHERE user_id = $1 ORDER BY updated_at DESC`,
    [user.id],
  );
}
