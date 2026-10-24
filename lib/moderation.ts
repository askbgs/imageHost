/**
 * Automatic screening of uploads.
 *
 * Every upload is checked while it's processed, before anything is stored or shown:
 *   1. exact hash      the file matches one an admin removed and blocked          → blocked
 *   2. look-alike      it's a resized / re-saved copy of a blocked image (dHash)   → blocked
 *   3. content         a classifier scores the image (and its file name):
 *        adult (sexual)        → MODERATION_ADULT: flag (default), block or allow
 *        graphic violence      → MODERATION_GORE:  flag (default), block or allow
 *        self-harm             → flag
 *        abusive file name     → flag (hate, threats, harassment in the name)
 *      A flagged image goes live marked "sensitive": blurred, not indexed, listed in /admin for review.
 *   4. repeat offenders  MODERATION_PAUSE_AFTER blocked uploads in 24 h pause the account's uploads
 *      (or the IP's, for guests) until an admin resumes them.
 *
 * Providers: OpenAI's moderation endpoint (free; set OPENAI_API_KEY), or your own webhook.
 *
 * NOT covered: matching against known child sexual abuse material. Classifiers like this one don't do
 * that reliably; it needs hash matching against NCMEC/IWF lists. Turn on Cloudflare's free CSAM
 * Scanning Tool for the image domain (see MODERATION.md) and follow its reporting obligations.
 */
import sharp from "sharp";
import type { PoolClient } from "pg";
import { config } from "./config";
import { query, queryOne } from "./db";
import { ApiError } from "./http";

const m = config.moderation;

export type Label =
  | "adult"
  | "graphic_violence"
  | "self_harm"
  | "abusive_name"
  | "blocked_file"
  | "lookalike"
  | "unscreened";
export type Verdict = {
  action: "allow" | "flag" | "block";
  labels: Label[];
  scores: Record<string, number>;
  provider: string | null;
  error?: string;
};

export const LABEL_TEXT: Record<string, string> = {
  adult: "Adult content",
  graphic_violence: "Graphic violence",
  self_harm: "Self-harm",
  abusive_name: "Abusive file name",
  blocked_file: "Blocked file",
  lookalike: "Look-alike of a blocked image",
  unscreened: "Not screened (service unavailable)",
};

export function screeningStatus() {
  const provider =
    m.provider === "openai" && m.openaiKey
      ? "openai"
      : m.provider === "webhook" && m.webhookUrl
        ? "webhook"
        : null;
  return {
    enabled: provider !== null,
    provider,
    adult: m.adult,
    gore: m.gore,
    threshold: m.threshold,
  };
}

// ---------------------------------------------------------------- hashes

/** Exact-hash block list. "Remove and block" in /admin adds to it. */
export async function isBlockedHash(sha256: string): Promise<boolean> {
  const row = await queryOne(`SELECT 1 FROM blocked_hashes WHERE sha256 = $1`, [
    sha256,
  ]);
  return row !== null;
}

/**
 * 64-bit difference hash: shrink to 9×8 greys and compare neighbours. Survives resizing, re-encoding
 * and small edits, so re-uploads of a removed image are caught even when the file bytes differ.
 * Returned as a signed 64-bit integer string, for a Postgres BIGINT.
 */
export async function perceptualHash(image: Buffer): Promise<string> {
  const px = await sharp(image, { animated: false })
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      h = (h << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return BigInt.asIntN(64, h).toString();
}

/** True when the image is within MODERATION_LOOKALIKE_BITS of a blocked image. */
export async function isBlockedLookalike(phash: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM blocked_hashes
      WHERE phash IS NOT NULL AND bit_count((phash # $1::bigint)::bit(64)) <= $2
      LIMIT 1`,
    [phash, m.lookalikeBits],
  );
  return row !== null;
}

// ---------------------------------------------------------------- content screening

type Scores = Record<string, number>;

async function openai(input: unknown[]): Promise<Scores> {
  const res = await fetch(m.openaiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${m.openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: m.openaiModel, input }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`OpenAI moderation HTTP ${res.status}`);
  const body = (await res.json()) as {
    results?: { category_scores?: Scores }[];
  };
  const scores = body.results?.[0]?.category_scores;
  if (!scores) throw new Error("OpenAI moderation: no scores in the response");
  return scores;
}

/** Image scores and file-name scores, with OpenAI's category names. */
async function screenWithOpenAI(
  jpeg: Buffer,
  name: string | null,
): Promise<{ image: Scores; text: Scores }> {
  const image = openai([
    {
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` },
    },
  ]);
  // The name is checked on its own, so a name like "sexy.jpg" can't flag a harmless picture as adult.
  const text =
    name && name.trim().length > 2
      ? openai([{ type: "text", text: name.slice(0, 500) }])
      : Promise.resolve({});
  const [i, t] = await Promise.all([image, text]);
  return { image: i, text: t };
}

/**
 * Your own endpoint: POST the JPEG bytes (X-File-Name header carries the name) and answer with
 * { "adult": 0..1, "graphic_violence": 0..1, "self_harm": 0..1 } and optionally { "block": true }.
 * The older { "nsfw": 0..1 } answer still works and counts as adult.
 */
async function screenWithWebhook(
  jpeg: Buffer,
  name: string | null,
): Promise<{ image: Scores; text: Scores; block: boolean }> {
  const res = await fetch(m.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      ...(name ? { "X-File-Name": encodeURIComponent(name) } : {}),
    },
    body: new Uint8Array(jpeg),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`moderation webhook HTTP ${res.status}`);
  const b = (await res.json()) as Record<string, unknown>;
  const n = (k: string) => (typeof b[k] === "number" ? (b[k] as number) : 0);
  return {
    image: {
      sexual: Math.max(n("adult"), n("nsfw")),
      "violence/graphic": n("graphic_violence"),
      "self-harm": n("self_harm"),
    },
    text: {},
    block: b.block === true,
  };
}

/**
 * Screens one image. `jpeg` is a still JPEG of the medium size (smaller and enough for a classifier),
 * `name` its title or file name. Never throws: on a service error the verdict follows MODERATION_ON_ERROR.
 */
export async function screenImage(
  jpeg: Buffer,
  name: string | null,
): Promise<Verdict> {
  const { provider } = screeningStatus();
  if (!provider)
    return { action: "allow", labels: [], scores: {}, provider: null };

  let image: Scores;
  let text: Scores;
  let hardBlock = false;
  try {
    if (provider === "openai")
      ({ image, text } = await screenWithOpenAI(jpeg, name));
    else
      ({ image, text, block: hardBlock } = await screenWithWebhook(jpeg, name));
  } catch (err) {
    const error = (err as Error).message;
    console.warn(
      `[moderation] screening failed (${error}); ${m.onError === "flag" ? "holding as sensitive" : "allowing"}`,
    );
    return m.onError === "flag"
      ? { action: "flag", labels: ["unscreened"], scores: {}, provider, error }
      : { action: "allow", labels: [], scores: {}, provider, error };
  }

  const t = m.threshold;
  const s = (o: Scores, ...keys: string[]) =>
    Math.max(0, ...keys.map((k) => o[k] ?? 0));
  const scores: Scores = {
    adult: s(image, "sexual"),
    graphic_violence: s(image, "violence/graphic"),
    self_harm: s(
      image,
      "self-harm",
      "self-harm/intent",
      "self-harm/instructions",
    ),
    name_abuse: s(
      text,
      "hate",
      "hate/threatening",
      "harassment/threatening",
      "violence",
      "illicit/violent",
    ),
    name_minors: s(text, "sexual/minors"),
  };

  const labels: Label[] = [];
  let action: Verdict["action"] = hardBlock ? "block" : "allow";
  const apply = (
    label: Label,
    hit: boolean,
    policy: "flag" | "block" | "allow",
  ) => {
    if (!hit || policy === "allow") return;
    labels.push(label);
    if (policy === "block") action = "block";
    else if (action !== "block") action = "flag";
  };
  apply("adult", scores.adult! >= t, m.adult);
  apply("graphic_violence", scores.graphic_violence! >= t, m.gore);
  apply("self_harm", scores.self_harm! >= t, "flag");
  apply("abusive_name", scores.name_abuse! >= t, "flag");
  // A sexual image whose name points to minors is never published.
  if (scores.name_minors! >= 0.5 && scores.adult! >= 0.5) {
    action = "block";
    if (!labels.includes("adult")) labels.push("adult");
  } else if (scores.name_minors! >= t) apply("abusive_name", true, "flag");

  return { action, labels: [...new Set(labels)], scores, provider };
}

// ---------------------------------------------------------------- repeat offenders

/**
 * Refuses uploads from an account whose uploads are paused, or from an IP with too many blocked
 * uploads in the last 24 hours (guests). Runs inside the upload's transaction.
 */
export async function assertUploadsAllowed(
  client: PoolClient,
  userId: string | null | undefined,
  ip: string | null,
) {
  const contact = config.contactEmail;
  if (userId) {
    const { rows } = await client.query(
      `SELECT uploads_paused_at FROM users WHERE id = $1`,
      [userId],
    );
    if (rows[0]?.uploads_paused_at) {
      throw new ApiError(
        "uploads_paused",
        `Uploads from your account are paused while we review images that our safety check blocked. If you think this is a mistake, email ${contact}.`,
      );
    }
    return;
  }
  if (!ip || m.pauseAfter === 0) return;
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM images
      WHERE user_id IS NULL AND uploader_ip = $1 AND fail_reason LIKE 'blocked%'
        AND created_at > now() - interval '24 hours'`,
    [ip],
  );
  if ((rows[0]?.n ?? 0) >= m.pauseAfter) {
    throw new ApiError(
      "uploads_paused",
      "Uploads from your network are paused for a day after repeated blocked uploads.",
    );
  }
}

/** After a blocked upload: pause the account once it reaches MODERATION_PAUSE_AFTER blocks in 24 hours. */
export async function noteBlockedUpload(userId: string | null) {
  if (!userId || m.pauseAfter === 0) return;
  const paused = await queryOne<{ id: string }>(
    `UPDATE users u SET uploads_paused_at = now()
      WHERE u.id = $1 AND u.uploads_paused_at IS NULL AND u.role <> 'admin'
        AND (SELECT count(*) FROM images i
              WHERE i.user_id = u.id AND i.fail_reason LIKE 'blocked%'
                AND i.created_at > GREATEST(now() - interval '24 hours', COALESCE(u.uploads_resumed_at, '-infinity'))) >= $2
      RETURNING u.id`,
    [userId, m.pauseAfter],
  );
  if (paused)
    console.warn(
      `[moderation] paused uploads for account ${userId} after ${m.pauseAfter} blocked uploads`,
    );
}

/** For the admin "Resume uploads" action. */
export async function resumeUploads(userId: string) {
  await query(
    `UPDATE users SET uploads_paused_at = NULL, uploads_resumed_at = now() WHERE id = $1`,
    [userId],
  );
}
