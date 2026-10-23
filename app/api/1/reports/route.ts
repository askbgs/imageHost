import { config } from "@/lib/config";
import { REPORT_REASONS } from "@/lib/constants";
import { query } from "@/lib/db";
import { ApiError, apiOk, clientIp, handleError, limitHeaders, preflight } from "@/lib/http";
import { IMAGE_ID_RE } from "@/lib/ids";
import { getImage } from "@/lib/images";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const OPTIONS = preflight;

/** POST /1/reports { image_id, reason, details } — no key needed; rate-limited per IP. */
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const rl = await rateLimit(`rl:report:${ip ?? "unknown"}`, config.limits.reportsPerHour);
    if (!rl.ok) throw new ApiError("rate_limited", "Too many reports, try again later", limitHeaders(rl));

    const ct = req.headers.get("content-type") || "";
    const body: Record<string, unknown> = ct.includes("application/json")
      ? ((await req.json().catch(() => ({}))) as Record<string, unknown>)
      : Object.fromEntries((await req.formData().catch(() => new FormData())).entries());

    const imageId = String(body.image_id ?? body.id ?? "");
    const reason = String(body.reason ?? "");
    const details = body.details ? String(body.details).slice(0, 2000) : null;

    if (!IMAGE_ID_RE.test(imageId)) throw new ApiError("invalid_request", "image_id is required");
    if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
      throw new ApiError("invalid_request", `reason must be one of ${REPORT_REASONS.join(", ")}`);
    }
    const img = await getImage(imageId);
    if (!img || img.status === "removed") throw new ApiError("not_found", "Image not found");

    await query(`INSERT INTO reports (image_id, reason, details, reporter_ip) VALUES ($1, $2, $3, $4)`, [
      imageId,
      reason,
      details,
      ip,
    ]);
    return apiOk({ received: true }, 201);
  } catch (err) {
    return handleError(err);
  }
}
