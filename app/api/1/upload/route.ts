import { authenticate, enforceKeyLimit, extractKey } from "@/lib/apikeys";
import { config } from "@/lib/config";
import { fetchRemoteImage } from "@/lib/fetch-remote";
import { ApiError, apiOk, clientIp, handleError, limitHeaders, preflight } from "@/lib/http";
import { parseExpiration } from "@/lib/images";
import { ingestBytes } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 90;

export const OPTIONS = preflight;

/**
 * POST /1/upload — ImgBB-compatible.
 *   key         API key (also ?key=, X-API-Key header, or Bearer token)
 *   image       binary file, base64 string (optionally a data: URL), or http(s) URL
 *   name        optional file name
 *   expiration  optional, seconds (60–15552000)
 * Accepts multipart/form-data or application/x-www-form-urlencoded.
 */
export async function POST(req: Request) {
  try {
    const declared = Number(req.headers.get("content-length") || 0);
    // base64 inflates by about a third, so allow headroom before parsing the body.
    if (declared > config.maxUploadBytes * 1.4 + 64 * 1024) {
      throw new ApiError("file_too_large", `Images must be ${config.maxUploadBytes / 1024 / 1024} MB or smaller`);
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError("invalid_request", "Send multipart/form-data or x-www-form-urlencoded with an image field");
    }

    const key = await authenticate(extractKey(req, form.get("key")));
    const rl = await enforceKeyLimit(key);

    const url = new URL(req.url);
    const expirationSeconds = parseExpiration(form.get("expiration") ?? url.searchParams.get("expiration"));
    const nameField = form.get("name") ?? url.searchParams.get("name");
    const image = form.get("image");
    if (!image) throw new ApiError("invalid_request", "The image field is required");

    let bytes: Buffer;
    let name: string | null = typeof nameField === "string" && nameField ? nameField : null;

    if (typeof image !== "string") {
      bytes = Buffer.from(await image.arrayBuffer());
      name ??= image.name || null;
    } else if (/^https?:\/\//i.test(image.trim())) {
      const remote = await fetchRemoteImage(image.trim(), config.maxUploadBytes);
      bytes = remote.bytes;
      name ??= remote.name;
    } else {
      const b64 = image.replace(/^data:[^;,]+;base64,/, "").replace(/\s/g, "");
      if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) throw new ApiError("invalid_image", "image is not a file, URL or base64 string");
      bytes = Buffer.from(b64, "base64");
    }

    const result = await ingestBytes({
      bytes,
      name,
      expirationSeconds,
      uploaderIp: clientIp(req),
      userId: key.user_id,
      apiKeyId: key.id,
    });

    const res = apiOk(result.data, result.done ? 200 : 202);
    for (const [k, v] of Object.entries(limitHeaders(rl))) res.headers.set(k, v);
    return res;
  } catch (err) {
    return handleError(err);
  }
}
