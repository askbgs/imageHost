import { uploaderFor } from "./auth";
import { config } from "./config";
import { query, queryOne } from "./db";
import { IMAGE_ID_RE, tokenMatches } from "./ids";
import { getImage } from "./images";
import { ApiError, clientIp, limitHeaders } from "./http";
import { planFor, webRateKey } from "./plans";
import { assertNotFull } from "./quota";
import { rateLimit } from "./ratelimit";

/**
 * Gate for uploads from the website: same-origin, signed in (unless guests are allowed),
 * and within the hourly limit for that user's plan (or that IP, for guests).
 */
export async function webUploadGate(
  req: Request,
  opts: { replaces?: { id: string; token: string } } = {},
) {
  const user = await uploaderFor(req);
  const ip = clientIp(req);
  // A direct upload that the browser couldn't send to storage, now retried through the site:
  // it was already counted when it was presigned, so drop the unused placeholder and don't count it again.
  if (
    opts.replaces &&
    (await dropUnusedPresign(opts.replaces, user?.id ?? null))
  )
    return { user, ip };
  if (!user) {
    const rl = await rateLimit(
      `rl:guest:${ip ?? "unknown"}`,
      config.limits.guestUploadsPerHour,
    );
    if (!rl.ok)
      throw new ApiError(
        "rate_limited",
        `You've reached the hourly upload limit. ${tryAgain(rl.retryAfter)}`,
        limitHeaders(rl),
      );
    return { user, ip };
  }

  const account = await queryOne<{ plan: string; role: string }>(
    `SELECT plan, role FROM users WHERE id = $1`,
    [user.id],
  );
  const plan = planFor(account ?? {});
  await assertNotFull(user.id);
  const rl = await rateLimit(webRateKey(user.id), plan.webUploadsPerHour);
  if (!rl.ok) {
    const upgrade =
      plan.id === "business" || account?.role === "admin"
        ? ""
        : " Need more? See Pricing for higher limits.";
    throw new ApiError(
      "rate_limited",
      `The ${plan.label} plan allows ${plan.webUploadsPerHour.toLocaleString("en")} website uploads per hour, and you've reached it. ${tryAgain(rl.retryAfter)}${upgrade}`,
      limitHeaders(rl),
    );
  }
  return { user, ip };
}

async function dropUnusedPresign(
  { id, token }: { id: string; token: string },
  userId: string | null,
) {
  if (!IMAGE_ID_RE.test(id) || !token) return false;
  const img = await getImage(id);
  if (
    !img ||
    img.status !== "pending" ||
    img.user_id !== userId ||
    !tokenMatches(token, img.delete_token)
  )
    return false;
  const gone = await query(
    `DELETE FROM images WHERE id = $1 AND status = 'pending' RETURNING id`,
    [id],
  );
  return gone.length > 0;
}

function tryAgain(retryAfterSeconds: number) {
  const min = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `You can upload again in ${min} minute${min === 1 ? "" : "s"}.`;
}
