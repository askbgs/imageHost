"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createKey } from "@/lib/apikeys";
import { SESSION_COOKIE, currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { IMAGE_ID_RE } from "@/lib/ids";
import { getImage, removeImage } from "@/lib/images";
import { cancelAllNow } from "@/lib/paddle";
import { planFor } from "@/lib/plans";
import type { ImageRow } from "@/lib/links";

export type KeyState = { error?: string; key?: string; name?: string };

/** Delete one of the signed-in user's images. */
export async function deleteMyImage(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in again to delete images." };
  const img = IMAGE_ID_RE.test(id) ? await getImage(id) : null;
  if (!img || img.user_id !== user.id || img.status === "removed")
    return { ok: false, error: "Image not found." };
  await removeImage(img);
  revalidatePath("/account");
  return { ok: true };
}

/** Delete several of the signed-in user's images at once (up to 100). */
export async function deleteMyImages(
  ids: string[],
): Promise<{ deleted: string[]; error?: string }> {
  const user = await currentUser();
  if (!user) return { deleted: [], error: "Sign in again to delete images." };
  const wanted = [...new Set(ids)]
    .filter((id) => IMAGE_ID_RE.test(id))
    .slice(0, 100);
  if (wanted.length === 0) return { deleted: [] };
  // Only the caller's own images; anything else in the list is ignored.
  const rows = await query<ImageRow>(
    `SELECT * FROM images WHERE id = ANY($1) AND user_id = $2 AND status <> 'removed'`,
    [wanted, user.id],
  );
  const deleted: string[] = [];
  for (const img of rows) {
    try {
      await removeImage(img);
      deleted.push(img.id);
    } catch (err) {
      console.error(`[delete] ${img.id}:`, err);
    }
  }
  revalidatePath("/account");
  return deleted.length < rows.length
    ? { deleted, error: "Some images couldn't be deleted. Try again." }
    : { deleted };
}

export async function createApiKey(
  _prev: KeyState,
  form: FormData,
): Promise<KeyState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in again to create keys." };
  const name = String(form.get("name") || "")
    .trim()
    .slice(0, 60);
  if (!name)
    return { error: "Give the key a name, such as the app that will use it." };

  const plan = planFor(
    (await queryOne<{ plan: string; role: string }>(
      `SELECT plan, role FROM users WHERE id = $1`,
      [user.id],
    )) ?? {},
  );
  const count = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL`,
    [user.id],
  );
  if (Number(count?.n ?? 0) >= plan.maxApiKeys) {
    return {
      error:
        plan.maxApiKeys === 1
          ? `The ${plan.label} plan includes 1 API key. Revoke your current key to create a new one.`
          : `The ${plan.label} plan includes up to ${plan.maxApiKeys} API keys. Revoke one to create another.`,
    };
  }
  const raw = await createKey(user.id, name, plan.apiUploadsPerHour);
  revalidatePath("/account/keys");
  return { key: raw, name };
}

export async function revokeApiKey(form: FormData) {
  const user = await currentUser();
  if (!user) return;
  const id = String(form.get("id") || "");
  await query(
    `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [id, user.id],
  );
  revalidatePath("/account/keys");
}

export type DeleteState = { error?: string };

/** Permanently delete the signed-in account, its images (from storage too), keys and sessions. */
export async function deleteAccount(
  _prev: DeleteState,
  form: FormData,
): Promise<DeleteState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in again to delete your account." };
  const typed = String(form.get("confirm") || "")
    .trim()
    .toLowerCase();
  if (typed !== user.email.toLowerCase())
    return { error: "Type your email address exactly to confirm." };
  if (user.role === "admin") {
    const admins = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM users WHERE role = 'admin' AND status = 'active'`,
    );
    if (Number(admins?.n ?? 0) <= 1)
      return {
        error: "You're the only admin. Make someone else an admin first.",
      };
  }

  // Stop billing first, so a deleted account is never charged again.
  try {
    await cancelAllNow(user.id);
  } catch (err) {
    console.error("[delete-account] cancelling subscription:", err);
    return {
      error:
        "We couldn't cancel your subscription, so your account wasn't deleted. Try again in a minute.",
    };
  }

  const images = await query<ImageRow>(
    `SELECT * FROM images WHERE user_id = $1 AND status <> 'removed'`,
    [user.id],
  );
  for (const img of images) {
    await removeImage(img).catch((err) =>
      console.error(`[delete-account] image ${img.id}:`, err),
    );
  }
  // Moderation history keeps removed images, detached from the person.
  await query(
    `UPDATE images SET user_id = NULL, uploader_ip = NULL WHERE user_id = $1`,
    [user.id],
  );
  await query(`DELETE FROM users WHERE id = $1`, [user.id]); // sessions, keys, albums and connections cascade
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/?deleted=1");
}
