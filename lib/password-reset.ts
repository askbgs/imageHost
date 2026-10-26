/**
 * Password reset by email link.
 *
 * - The link carries a random 256-bit token; only its SHA-256 is stored.
 * - A link works once and expires after RESET_LINK_MINUTES (default 60). Asking for a new link
 *   cancels older ones.
 * - Using it sets the new password, signs the account out everywhere, and emails a
 *   "your password was changed" notice.
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";
import { query, queryOne } from "./db";
import { sendMail } from "./mail";

export const RESET_MINUTES = Math.min(
  24 * 60,
  Math.max(10, Number(process.env.RESET_LINK_MINUTES || 60)),
);

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

export async function createResetLink(
  userId: string,
  ip: string | null,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  // Only the newest link works.
  await query(
    `UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  await query(
    `INSERT INTO password_resets (token_hash, user_id, ip, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [hash(token), userId, ip, RESET_MINUTES],
  );
  return `${config.siteUrl}/reset-password/${token}`;
}

export type ResetTarget = {
  user_id: string;
  email: string;
  display_name: string | null;
};

/** The account a link belongs to, if the link is valid, unused and not expired. */
export async function findReset(token: string): Promise<ResetTarget | null> {
  if (!TOKEN_RE.test(token)) return null;
  return queryOne<ResetTarget>(
    `SELECT r.user_id, u.email, u.display_name
       FROM password_resets r JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now() AND u.status = 'active'`,
    [hash(token)],
  );
}

/** Marks the link used. Returns false if it was already used (two tabs, double submit). */
export async function consumeReset(
  token: string,
  userId: string,
): Promise<boolean> {
  const row = await queryOne(
    `UPDATE password_resets SET used_at = now()
      WHERE token_hash = $1 AND user_id = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING token_hash`,
    [hash(token), userId],
  );
  if (!row) return false;
  await query(
    `UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  return true;
}

// ---------------------------------------------------------------- emails

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function layout(
  title: string,
  paragraphs: string[],
  button?: { label: string; url: string },
) {
  const p = (t: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#2b3036">${t}</p>`;
  return `<!doctype html><html><body style="margin:0;background:#eef1f4;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#14181d">${esc(config.siteName)}</p>
<h1 style="margin:0 0 16px;font-size:22px;color:#14181d">${esc(title)}</h1>
${paragraphs.map(p).join("\n")}
${
  button
    ? `<p style="margin:8px 0 24px"><a href="${esc(button.url)}" style="display:inline-block;background:#1d4f9c;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(button.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#6b737c">Or copy this link into your browser:<br><span style="word-break:break-all">${esc(button.url)}</span></p>`
    : ""
}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#8a929b">${esc(config.siteName)} · <a href="${esc(config.siteUrl)}" style="color:#8a929b">${esc(config.siteUrl.replace(/^https?:\/\//, ""))}</a></p>
</td></tr></table></body></html>`;
}

/** The reset email. Accounts that only use GitHub/Google/Facebook are told they can sign in with it, or set a password. */
export async function sendResetEmail(
  to: string,
  link: string,
  providers: string[],
) {
  const social = providers.length
    ? `You can also sign in with ${providers.join(" or ")}, which doesn't need a password.`
    : null;
  const lines = [
    `We got a request to reset the password for ${to}. Choose a new password with the button below.`,
    `The link works once and expires in ${RESET_MINUTES} minutes.`,
    ...(social ? [social] : []),
    "If you didn't ask for this, you can ignore this email: your password stays the same.",
  ];
  return sendMail({
    to,
    subject: `Reset your ${config.siteName} password`,
    text: [
      `Reset your ${config.siteName} password`,
      "",
      lines[0],
      "",
      link,
      "",
      ...lines.slice(1),
    ].join("\n"),
    html: layout("Reset your password", lines.map(esc), {
      label: "Choose a new password",
      url: link,
    }),
  });
}

export async function sendPasswordChangedEmail(to: string) {
  const lines = [
    `The password for your ${config.siteName} account (${to}) was just changed, and you were signed out on other devices.`,
    `If this was you, there's nothing else to do.`,
    `If it wasn't, reset your password straight away at ${config.siteUrl}/forgot-password and tell us at ${config.contactEmail}.`,
  ];
  return sendMail({
    to,
    subject: `Your ${config.siteName} password was changed`,
    text: lines.join("\n\n"),
    html: layout("Your password was changed", lines.map(esc)),
  });
}
