/**
 * Storage quota per account. Each plan has a storage allowance (lib/plans.ts, storageBytes).
 *
 * An image counts with everything it keeps in storage: the original plus its thumbnail and medium sizes.
 * While an upload is still being processed it holds the space of the file that was sent, so several
 * uploads at once can't slip past the limit. Deleted, expired and failed images don't count.
 * Guests (uploads without an account) aren't covered: they're limited per IP and per hour instead.
 */
import type { PoolClient } from "pg";
import { queryOne } from "./db";
import { ApiError } from "./http";
import { planFor, type Plan } from "./plans";

const USAGE_SQL = `
  SELECT COALESCE(sum(CASE WHEN status IN ('active', 'flagged') THEN COALESCE(stored_bytes, size_bytes, 0)
                           ELSE COALESCE(upload_bytes, 0) END), 0)::bigint AS used,
         count(*) FILTER (WHERE status IN ('active', 'flagged'))::int AS images
    FROM images
   WHERE user_id = $1
     AND (status IN ('active', 'flagged')
          -- an upload that never finished stops holding space after a day (the cleanup removes it)
          OR (status IN ('pending', 'processing') AND created_at > now() - interval '1 day'))`;

export type StorageUsage = {
  used: number;
  limit: number;
  images: number;
  plan: Plan;
};

export async function storageUsage(userId: string): Promise<StorageUsage> {
  const [usage, account] = await Promise.all([
    queryOne<{ used: string; images: number }>(USAGE_SQL, [userId]),
    queryOne<{ plan: string; role: string }>(
      `SELECT plan, role FROM users WHERE id = $1`,
      [userId],
    ),
  ]);
  const plan = planFor(account ?? {});
  return {
    used: Number(usage?.used ?? 0),
    limit: plan.storageBytes,
    images: usage?.images ?? 0,
    plan,
  };
}

/** "1 GB", "512 MB", "1.4 GB": plan sizes and usage, in binary units like the plan limits. */
export function formatStorage(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  const digits = i >= 3 && n < 10 && Math.round(n) !== n ? 1 : 0;
  return `${n.toFixed(digits).replace(/\.0$/, "")} ${units[i]}`;
}

/**
 * Inside a transaction, before a new upload is recorded: checks that `incoming` more bytes fit in the
 * account's storage. Uploads for the same account wait for each other here, so the check can't race.
 */
export async function assertStorageAvailable(
  client: PoolClient,
  userId: string,
  incoming: number,
) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('quota:' || $1))`, [
    userId,
  ]);
  const [{ rows: usage }, { rows: account }] = [
    await client.query<{ used: string }>(USAGE_SQL, [userId]),
    await client.query<{ plan: string; role: string }>(
      `SELECT plan, role FROM users WHERE id = $1`,
      [userId],
    ),
  ];
  const plan = planFor(account[0] ?? {});
  const used = Number(usage[0]?.used ?? 0);
  const limit = plan.storageBytes;
  if (used + incoming <= limit) return;

  const upgrade =
    plan.id === "business" || account[0]?.role === "admin"
      ? ""
      : " or upgrade your plan for more space";
  const message =
    used >= limit
      ? `Your storage is full: you're using ${formatStorage(used)} of the ${formatStorage(limit)} on the ${plan.label} plan. Delete images you no longer need${upgrade}.`
      : `This image is ${formatStorage(incoming)}, but only ${formatStorage(limit - used)} of your ${formatStorage(limit)} storage is left. Delete images you no longer need${upgrade}.`;
  throw new ApiError("storage_full", message);
}

/**
 * Quick check before an upload is counted against the hourly limits: a full account is refused
 * straight away, so failed attempts don't use up its uploads for the hour. (The exact check, with the
 * file's size, still happens when the upload is recorded.)
 */
export async function assertNotFull(userId: string) {
  const usage = await storageUsage(userId);
  if (usage.used < usage.limit) return;
  const upgrade =
    usage.plan.id === "business" || usage.plan.label.includes("admin")
      ? ""
      : " or upgrade your plan for more space";
  throw new ApiError(
    "storage_full",
    `Your storage is full: you're using ${formatStorage(usage.used)} of the ${formatStorage(usage.limit)} on the ${usage.plan.label} plan. Delete images you no longer need${upgrade}.`,
  );
}
