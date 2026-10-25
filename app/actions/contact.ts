"use server";

import { headers } from "next/headers";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { CONTACT_TOPICS, isTopic } from "@/lib/contact";
import { query, queryOne } from "@/lib/db";
import { clientIp } from "@/lib/http";
import { sendMail } from "@/lib/mail";
import { rateLimit } from "@/lib/ratelimit";

export type ContactState = {
  ok?: boolean;
  error?: string;
  fields?: Record<string, string>;
};

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
const MIN_SECONDS = 3; // humans take longer than this to fill in the form

/** Contact form: saves the message, then emails it to CONTACT_EMAIL with Reply-To set to the sender. */
export async function sendContactMessage(
  _prev: ContactState,
  form: FormData,
): Promise<ContactState> {
  const fields = {
    name: String(form.get("name") ?? "")
      .trim()
      .replace(/\s+/g, " "),
    email: String(form.get("email") ?? "").trim(),
    topic: String(form.get("topic") ?? "general"),
    message: String(form.get("message") ?? "")
      .replace(/\r\n/g, "\n")
      .trim(),
  };
  const back = (error: string): ContactState => ({ error, fields });

  // Spam traps: a hidden field people never see, and a form sent faster than anyone could type it.
  // Both get a normal "thanks", so bots learn nothing.
  const started = Number(form.get("started") || 0);
  if (
    String(form.get("website") ?? "") !== "" ||
    !started ||
    Date.now() - started < MIN_SECONDS * 1000
  ) {
    return { ok: true };
  }

  if (!fields.name || fields.name.length > 100)
    return back("Enter your name (up to 100 characters).");
  if (!EMAIL_RE.test(fields.email) || fields.email.length > 200)
    return back("Enter an email address we can reply to.");
  if (!isTopic(fields.topic)) return back("Choose what your message is about.");
  if (fields.message.length < 10)
    return back("Write a little more about how we can help.");
  if (fields.message.length > 5000)
    return back("Keep the message under 5,000 characters.");

  const ip = clientIp(await headers());
  const limit = await rateLimit(`rl:contact:${ip ?? "unknown"}`, 5, 3600);
  if (!limit.ok)
    return back(
      "You've sent several messages in the last hour. Please try again later.",
    );

  const user = await currentUser();
  const row = await queryOne<{ id: string }>(
    `INSERT INTO contact_messages (user_id, name, email, topic, message, ip)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      user?.id ?? null,
      fields.name,
      fields.email,
      fields.topic,
      fields.message,
      ip,
    ],
  );

  const topic = CONTACT_TOPICS[fields.topic];
  const account = user ? `${user.email} (signed in)` : "not signed in";
  const sent = await sendMail({
    to: config.contactEmail,
    replyTo: `${fields.name.replace(/[<>"]/g, "")} <${fields.email}>`,
    subject: `[${config.siteName}] ${topic}: ${fields.name}`.slice(0, 200),
    text: [
      `From: ${fields.name} <${fields.email}>`,
      `Topic: ${topic}`,
      `Account: ${account}`,
      `Message #${row?.id}`,
      "",
      fields.message,
      "",
      "—",
      `Reply to this email to answer ${fields.name}. Also listed in ${config.siteUrl}/admin?view=messages`,
    ].join("\n"),
  });
  await query(
    `UPDATE contact_messages SET emailed_at = $2, email_error = $3 WHERE id = $1`,
    [row?.id, sent.ok ? new Date() : null, sent.ok ? null : sent.error],
  );
  if (!sent.ok)
    console.warn(
      `[contact] message ${row?.id} saved but not emailed: ${sent.error}`,
    );

  // The message is saved either way, so the sender always gets a thank-you.
  return { ok: true };
}
