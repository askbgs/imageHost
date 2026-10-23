import { config } from "@/lib/config";
import { ACCEPTED_MIME } from "@/lib/filetype";
import { ApiError, apiOk, clientIp, handleError, limitHeaders } from "@/lib/http";
import { createPendingImage, parseExpiration } from "@/lib/images";
import { rateLimit } from "@/lib/ratelimit";
import { presignPut } from "@/lib/s3";

export const runtime = "nodejs";

type Body = { name?: string; size?: number; type?: string; expiration?: number | string };

/** Step 1 of a browser upload: reserve an id and get a presigned PUT URL for the bytes. */
export async function POST(req: Request) {
  try {
    if (config.uploadMode !== "direct") throw new ApiError("not_found", "Not available");
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) throw new ApiError("invalid_request", "JSON body required");

    const size = Number(body.size);
    if (!Number.isInteger(size) || size <= 0) throw new ApiError("invalid_request", "size is required");
    if (size > config.maxUploadBytes) {
      throw new ApiError("file_too_large", `Images must be ${config.maxUploadBytes / 1024 / 1024} MB or smaller`);
    }
    const type = String(body.type || "").toLowerCase();
    if (!ACCEPTED_MIME.has(type)) {
      throw new ApiError("unsupported_type", "Unsupported image type (JPG, PNG, GIF, WebP, AVIF, BMP, TIFF)");
    }
    const expirationSeconds = parseExpiration(body.expiration);

    const ip = clientIp(req);
    const rl = await rateLimit(`rl:guest:${ip ?? "unknown"}`, config.limits.guestUploadsPerHour);
    if (!rl.ok) throw new ApiError("rate_limited", "Too many uploads, try again later", limitHeaders(rl));

    const img = await createPendingImage({ name: body.name ?? null, expirationSeconds, uploaderIp: ip });
    const uploadUrl = await presignPut(img.upload_key, type, size);

    // The delete token doubles as proof of ownership for the complete call.
    return apiOk({ id: img.id, token: img.delete_token, upload_url: uploadUrl, headers: { "Content-Type": type } });
  } catch (err) {
    return handleError(err);
  }
}
