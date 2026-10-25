/**
 * Outgoing email through Resend's HTTPS API (https://resend.com).
 * HTTPS rather than SMTP because Railway blocks outbound SMTP on its Free, Trial and Hobby plans.
 */
import { config } from "./config";

export type Mail = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** Replies go here (e.g. the person who filled in the contact form). */
  replyTo?: string;
};

export const mailEnabled = () => Boolean(config.mail.resendKey);

/** Sends one email. Never throws: returns the error so callers can record it. */
export async function sendMail(
  mail: Mail,
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  if (!mailEnabled())
    return { ok: false, error: "email isn't set up (RESEND_API_KEY)" };
  try {
    const res = await fetch(config.mail.resendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.mail.resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.mail.from,
        to: Array.isArray(mail.to) ? mail.to : [mail.to],
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };
    if (!res.ok)
      return {
        ok: false,
        error: `Resend HTTP ${res.status}: ${body.message || body.name || "error"}`,
      };
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
