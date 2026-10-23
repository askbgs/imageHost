import { config } from "./config";
import { MIME, sniffImage } from "./filetype";
import { ApiError } from "./http";
import { createPendingImage, failureToError, getImage, getVariants } from "./images";
import { imgbbData } from "./links";
import { processAndWait } from "./queue";
import { putObject } from "./s3";

/** Run processing for a stored upload and build the response body. */
export async function finalize(imageId: string) {
  const result = await processAndWait(imageId);
  const img = await getImage(imageId);
  if (!img) throw new ApiError("server_error", "Image disappeared during processing");
  if (result === null) {
    // Still running: return what we have; the client can poll GET /1/images/{id}.
    return { done: false as const, data: imgbbData(img, []) };
  }
  if (result.status === "failed") throw failureToError(result.reason ?? img.fail_reason);
  return { done: true as const, data: imgbbData(img, await getVariants(imageId)) };
}

/** Server-side ingest used by the API: bytes are already in memory. */
export async function ingestBytes(opts: {
  bytes: Buffer;
  name: string | null;
  expirationSeconds: number | null;
  uploaderIp: string | null;
  userId?: string | null;
  apiKeyId?: string | null;
}) {
  if (opts.bytes.length === 0) throw new ApiError("invalid_image", "Empty file");
  if (opts.bytes.length > config.maxUploadBytes) {
    throw new ApiError("file_too_large", `Images must be ${config.maxUploadBytes / 1024 / 1024} MB or smaller`);
  }
  // Cheap early check so obviously wrong files fail before touching storage.
  const kind = sniffImage(opts.bytes);
  if (!kind) throw new ApiError("unsupported_type", "Unsupported image type (JPG, PNG, GIF, WebP, AVIF, BMP, TIFF)");

  const img = await createPendingImage(opts);
  await putObject(img.upload_key, opts.bytes, MIME[kind]);
  return finalize(img.id);
}
