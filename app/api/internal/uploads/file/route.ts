import { config } from "@/lib/config";
import { ApiError, apiOk, handleError } from "@/lib/http";
import { parseExpiration } from "@/lib/images";
import { ingestBytes } from "@/lib/ingest";
import { webUploadGate } from "@/lib/webupload";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * Web uploader when UPLOAD_MODE=server: the browser POSTs the file here and the app stores it.
 * Used where browsers cannot PUT to storage directly (no bucket CORS).
 */
export async function POST(req: Request) {
  try {
    if (config.uploadMode !== "server") throw new ApiError("not_found", "Not available");
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > config.maxUploadBytes + 64 * 1024) {
      throw new ApiError("file_too_large", `Images must be ${config.maxUploadBytes / 1024 / 1024} MB or smaller`);
    }

    const { user, ip } = await webUploadGate(req);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError("invalid_request", "Send the image as multipart/form-data");
    }
    const file = form.get("image");
    if (!file || typeof file === "string") throw new ApiError("invalid_request", "The image field is required");

    const result = await ingestBytes({
      bytes: Buffer.from(await file.arrayBuffer()),
      name: file.name || null,
      expirationSeconds: parseExpiration(form.get("expiration")),
      uploaderIp: ip,
      userId: user?.id,
    });
    return apiOk(result.data, result.done ? 200 : 202);
  } catch (err) {
    return handleError(err);
  }
}
