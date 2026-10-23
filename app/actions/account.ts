"use server";

import { revalidatePath } from "next/cache";
import { createKey } from "@/lib/apikeys";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query, queryOne } from "@/lib/db";
import { IMAGE_ID_RE } from "@/lib/ids";
import { getImage, removeImage } from "@/lib/images";

export type KeyState = { error?: string; key?: string; name?: string };

/** Delete one of the signed-in user's images. */
export async function deleteMyImage(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in again to delete images." };
  const img = IMAGE_ID_RE.test(id) ? await getImage(id) : null;
  if (!img || img.user_id !== user.id || img.status === "removed") return { ok: false, error: "Image not found." };
  await removeImage(img);
  revalidatePath("/account");
  return { ok: true };
}

export async function createApiKey(_prev: KeyState, form: FormData): Promise<KeyState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in again to create keys." };
  const name = String(form.get("name") || "").trim().slice(0, 60);
  if (!name) return { error: "Give the key a name, such as the app that will use it." };

  const count = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL`,
    [user.id],
  );
  if (Number(count?.n ?? 0) >= config.limits.maxApiKeysPerUser) {
    return { error: `You can have up to ${config.limits.maxApiKeysPerUser} active keys. Revoke one first.` };
  }
  const raw = await createKey(user.id, name, config.limits.userUploadsPerHour);
  revalidatePath("/account/keys");
  return { key: raw, name };
}

export async function revokeApiKey(form: FormData) {
  const user = await currentUser();
  if (!user) return;
  const id = String(form.get("id") || "");
  await query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [id, user.id]);
  revalidatePath("/account/keys");
}
