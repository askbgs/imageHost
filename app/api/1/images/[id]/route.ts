import { authenticate, extractKey } from "@/lib/apikeys";
import { ApiError, apiOk, handleError, preflight } from "@/lib/http";
import { IMAGE_ID_RE, tokenMatches } from "@/lib/ids";
import { getImage, getVariants, isLive, removeImage } from "@/lib/images";
import { imageData } from "@/lib/links";

export const runtime = "nodejs";
export const OPTIONS = preflight;

type Ctx = { params: Promise<{ id: string }> };

/** GET /1/images/{id} — metadata and links. The owner's key also sees the delete URL. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const key = await authenticate(extractKey(req));
    const { id } = await ctx.params;
    const img = IMAGE_ID_RE.test(id) ? await getImage(id) : null;
    if (!img || img.status === "removed") throw new ApiError("not_found", "Image not found");
    const isOwner = img.user_id === key.user_id;
    if (!isOwner && !isLive(img)) throw new ApiError("not_found", "Image not found");
    const done = img.status === "active" || img.status === "flagged";
    return apiOk(imageData(img, done ? await getVariants(id) : [], isOwner), done ? 200 : 202);
  } catch (err) {
    return handleError(err);
  }
}

/** DELETE /1/images/{id} — with the owner's API key, or ?delete_token=… for guest uploads. */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const img = IMAGE_ID_RE.test(id) ? await getImage(id) : null;
    if (!img || img.status === "removed") throw new ApiError("not_found", "Image not found");

    const token = new URL(req.url).searchParams.get("delete_token");
    let allowed = false;
    if (token) {
      allowed = tokenMatches(token, img.delete_token);
    } else {
      const key = await authenticate(extractKey(req));
      allowed = img.user_id !== null && img.user_id === key.user_id;
    }
    if (!allowed) throw new ApiError("forbidden", "You cannot delete this image");

    await removeImage(img);
    return apiOk({ id, deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
