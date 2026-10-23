import { config } from "@/lib/config";
import { fetchRemoteImage } from "@/lib/fetch-remote";
import { ApiError, apiOk, handleError } from "@/lib/http";
import { parseExpiration } from "@/lib/images";
import { ingestBytes } from "@/lib/ingest";
import { webUploadGate } from "@/lib/webupload";

export const runtime = "nodejs";
export const maxDuration = 90;

/** Web uploader: import an image from a public URL (guest, rate-limited per IP). */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { url?: string; expiration?: number } | null;
    if (!body?.url) throw new ApiError("invalid_request", "url is required");
    const expirationSeconds = parseExpiration(body.expiration);

    const { user, ip } = await webUploadGate(req);

    const remote = await fetchRemoteImage(body.url, config.maxUploadBytes);
    const result = await ingestBytes({
      bytes: remote.bytes,
      name: remote.name,
      expirationSeconds,
      uploaderIp: ip,
      userId: user?.id,
    });
    return apiOk(result.data, result.done ? 200 : 202);
  } catch (err) {
    return handleError(err);
  }
}
