import { ApiError, apiOk, handleError } from "@/lib/http";
import { IMAGE_ID_RE, tokenMatches } from "@/lib/ids";
import { failureToError, getImage, getVariants } from "@/lib/images";
import { imageData } from "@/lib/links";
import { rescueStuck } from "@/lib/queue";

export const runtime = "nodejs";

/** Poll an upload that was still processing when /complete returned. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const token = new URL(req.url).searchParams.get("token") ?? "";
    let img = IMAGE_ID_RE.test(id) ? await getImage(id) : null;
    if (!img || !tokenMatches(token, img.delete_token)) throw new ApiError("not_found", "Unknown upload");
    if ((img.status === "pending" || img.status === "processing") && (await rescueStuck(id, img.created_at))) {
      img = (await getImage(id))!;
    }
    if (img.status === "failed") throw failureToError(img.fail_reason);
    const done = img.status === "active" || img.status === "flagged";
    return apiOk(imageData(img, done ? await getVariants(id) : []), done ? 200 : 202);
  } catch (err) {
    return handleError(err);
  }
}
