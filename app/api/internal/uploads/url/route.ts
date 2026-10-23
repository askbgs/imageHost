import { config } from "@/lib/config";
import { fetchRemoteImage } from "@/lib/fetch-remote";
import { ApiError, apiOk, clientIp, handleError, limitHeaders } from "@/lib/http";
import { parseExpiration } from "@/lib/images";
import { ingestBytes } from "@/lib/ingest";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 90;

/** Web uploader: import an image from a public URL (guest, rate-limited per IP). */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { url?: string; expiration?: number } | null;
    if (!body?.url) throw new ApiError("invalid_request", "url is required");
    const expirationSeconds = parseExpiration(body.expiration);

    const ip = clientIp(req);
    const rl = await rateLimit(`rl:guest:${ip ?? "unknown"}`, config.limits.guestUploadsPerHour);
    if (!rl.ok) throw new ApiError("rate_limited", "Too many uploads, try again later", limitHeaders(rl));

    const remote = await fetchRemoteImage(body.url, config.maxUploadBytes);
    const result = await ingestBytes({ bytes: remote.bytes, name: remote.name, expirationSeconds, uploaderIp: ip });
    return apiOk(result.data, result.done ? 200 : 202);
  } catch (err) {
    return handleError(err);
  }
}
