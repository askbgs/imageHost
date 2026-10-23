import { config } from "@/lib/config";
import { ApiError, apiOk, handleError } from "@/lib/http";
import { IMAGE_ID_RE, tokenMatches } from "@/lib/ids";
import { getImage } from "@/lib/images";
import { finalize } from "@/lib/ingest";
import { headObject } from "@/lib/s3";

export const runtime = "nodejs";
export const maxDuration = 90;

/** Step 2 of a browser upload: the bytes are in storage; process them and return links. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    if (!IMAGE_ID_RE.test(id)) throw new ApiError("not_found", "Unknown upload");

    const img = await getImage(id);
    if (!img || !body.token || !tokenMatches(body.token, img.delete_token)) {
      throw new ApiError("not_found", "Unknown upload");
    }
    if (img.status !== "pending" && img.status !== "processing") {
      throw new ApiError("invalid_request", `Upload is already ${img.status}`);
    }

    const head = await headObject(img.upload_key);
    if (!head) throw new ApiError("invalid_request", "The file has not been uploaded yet");
    if ((head.ContentLength ?? 0) > config.maxUploadBytes) {
      throw new ApiError("file_too_large", `Images must be ${config.maxUploadBytes / 1024 / 1024} MB or smaller`);
    }

    const result = await finalize(id);
    return apiOk(result.data, result.done ? 200 : 202);
  } catch (err) {
    return handleError(err);
  }
}
