import { config } from "./config";
import { queryOne } from "./db";

/**
 * Exact-hash block list. Hashes of removed images are added automatically by the admin
 * "Remove and block" action, so the same file cannot be re-uploaded.
 *
 * This is NOT a substitute for perceptual CSAM matching. Before public launch, enable a
 * dedicated service such as Cloudflare's CSAM Scanning Tool on the image domain, or
 * Microsoft PhotoDNA (by application), and follow its reporting obligations.
 */
export async function isBlockedHash(sha256: string): Promise<boolean> {
  const row = await queryOne(`SELECT 1 FROM blocked_hashes WHERE sha256 = $1`, [sha256]);
  return row !== null;
}

/**
 * Optional NSFW scoring through an HTTP endpoint you control (for example a small
 * self-hosted classifier, or an n8n workflow that calls one).
 *
 * Contract: POST the image bytes (Content-Type: image/*); respond with JSON { "nsfw": 0..1 }.
 * Returns null when no endpoint is configured or the call fails; the image then goes live
 * unflagged, and reports remain the backstop.
 */
export async function nsfwScore(image: Buffer, mime: string): Promise<number | null> {
  if (!config.moderationWebhookUrl) return null;
  try {
    const res = await fetch(config.moderationWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": mime },
      body: new Uint8Array(image),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { nsfw?: unknown };
    return typeof body.nsfw === "number" ? body.nsfw : null;
  } catch {
    return null;
  }
}
