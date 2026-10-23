import { uploaderFor } from "./auth";
import { config } from "./config";
import { ApiError, clientIp, limitHeaders } from "./http";
import { rateLimit } from "./ratelimit";

/**
 * Gate for uploads from the website: same-origin, signed in (unless guests are allowed),
 * and within the hourly limit for that user (or that IP, for guests).
 */
export async function webUploadGate(req: Request) {
  const user = await uploaderFor(req);
  const ip = clientIp(req);
  const rl = user
    ? await rateLimit(`rl:user:${user.id}`, config.limits.userUploadsPerHour)
    : await rateLimit(`rl:guest:${ip ?? "unknown"}`, config.limits.guestUploadsPerHour);
  if (!rl.ok) throw new ApiError("rate_limited", "You've reached the hourly upload limit. Try again later.", limitHeaders(rl));
  return { user, ip };
}
