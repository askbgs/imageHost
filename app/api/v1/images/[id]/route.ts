import { authenticate, extractKey } from "@/lib/apikeys";
import { queryOne } from "@/lib/db";
import { ApiError, apiOk, handleError, preflight } from "@/lib/http";
import { IMAGE_ID_RE } from "@/lib/ids";
import { getVariants, removeImage } from "@/lib/images";
import { imageData, type ImageRow } from "@/lib/links";
import { rateLimit, rateUsage } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const OPTIONS = preflight;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Both endpoints only ever see the images of the account that owns the API key.
 *
 * - No key, or a revoked one: 401.
 * - Someone else's image, a deleted one, or an ID that doesn't exist: the same 404 with the same message,
 *   so an ID tells a caller nothing about whether an image exists or whose it is.
 * - Lookups that miss count against MISS_LIMIT per hour per account, so IDs can't be guessed in bulk.
 */
const NOT_FOUND = "No image with this ID in your account";
const MISS_LIMIT = 60;
const MISS_WINDOW = 3600;

async function ownImage(req: Request, ctx: Ctx): Promise<ImageRow> {
  const key = await authenticate(extractKey(req));
  const missKey = `rl:api:miss:${key.user_id}`;

  const misses = await rateUsage(missKey, MISS_WINDOW);
  if (misses.used >= MISS_LIMIT) {
    const mins = Math.max(1, Math.ceil(misses.resetIn / 60));
    throw new ApiError(
      "rate_limited",
      `Too many lookups of images that aren't in your account. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      { "Retry-After": String(Math.max(1, Math.ceil(misses.resetIn))) },
    );
  }

  const { id } = await ctx.params;
  // One query that matches the ID and the owner together: other accounts' images are never even loaded.
  const img = IMAGE_ID_RE.test(id)
    ? await queryOne<ImageRow>(
        `SELECT * FROM images
          WHERE id = $1 AND user_id = $2
            AND (status IN ('pending', 'processing')
                 OR (status IN ('active', 'flagged') AND (expires_at IS NULL OR expires_at > now())))`,
        [id, key.user_id],
      )
    : null;

  if (!img) {
    await rateLimit(missKey, MISS_LIMIT, MISS_WINDOW);
    throw new ApiError("not_found", NOT_FOUND);
  }
  return img;
}

const noStore = (res: Response) => {
  res.headers.set("Cache-Control", "no-store");
  return res;
};

/** GET /v1/images/{id}: metadata and links for one of your images. 202 while it's still processing. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const img = await ownImage(req, ctx);
    const done = img.status === "active" || img.status === "flagged";
    return noStore(
      apiOk(
        imageData(img, done ? await getVariants(img.id) : []),
        done ? 200 : 202,
      ),
    );
  } catch (err) {
    return noStore(handleError(err));
  }
}

/** DELETE /v1/images/{id}: deletes one of your images and its links. */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const img = await ownImage(req, ctx);
    await removeImage(img);
    return noStore(apiOk({ id: img.id, deleted: true }));
  } catch (err) {
    return noStore(handleError(err));
  }
}
