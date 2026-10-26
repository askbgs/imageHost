"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSession,
  currentUser,
  destroyAllSessions,
  destroySession,
  isAdminEmail,
} from "@/lib/auth";
import { config } from "@/lib/config";
import { query, queryOne } from "@/lib/db";
import { clientIp } from "@/lib/http";
import {
  dummyVerify,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "@/lib/password";
import { mailEnabled } from "@/lib/mail";
import { providerLabel } from "@/lib/oauth";
import {
  consumeReset,
  createResetLink,
  findReset,
  RESET_MINUTES,
  sendPasswordChangedEmail,
  sendResetEmail,
} from "@/lib/password-reset";
import { rateLimit } from "@/lib/ratelimit";

export type FormState = {
  error?: string;
  ok?: string;
  fields?: Record<string, string>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only allow redirects back into this site. */
function safeNext(value: FormDataEntryValue | null) {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

async function ip() {
  return clientIp(await headers()) ?? "unknown";
}

export async function signUp(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const name = String(form.get("name") || "")
    .trim()
    .slice(0, 60);
  const password = String(form.get("password") || "");
  const fields = { email, name };

  if (!config.allowSignup) return { error: "New sign-ups are closed.", fields };
  if (!EMAIL_RE.test(email) || email.length > 254)
    return { error: "Enter a valid email address.", fields };
  const problem = passwordProblem(password);
  if (problem) return { error: problem, fields };

  const rl = await rateLimit(`rl:signup:${await ip()}`, 10);
  if (!rl.ok)
    return {
      error: "Too many sign-ups from this network. Try again later.",
      fields,
    };

  const existing = await queryOne(`SELECT 1 FROM users WHERE email = $1`, [
    email,
  ]);
  if (existing)
    return {
      error: "An account with this email already exists. Sign in instead.",
      fields,
    };

  const base =
    email
      .split("@")[0]!
      .replace(/[^\w.-]/g, "")
      .slice(0, 24) || "user";
  const user = await queryOne<{ id: string }>(
    `INSERT INTO users (email, username, display_name, password_hash, role, last_login_at)
     VALUES ($1, $2 || '-' || substr(md5(random()::text), 1, 5), $3, $4, $5, now())
     RETURNING id`,
    [
      email,
      base,
      name || null,
      await hashPassword(password),
      isAdminEmail(email) ? "admin" : "user",
    ],
  );
  await createSession(user!.id);
  redirect(safeNext(form.get("next")));
}

export async function signIn(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") || "");
  const fields = { email };
  const generic = "That email and password don't match.";

  const [byIp, byEmail] = await Promise.all([
    rateLimit(`rl:login:ip:${await ip()}`, 20, 900),
    rateLimit(`rl:login:email:${email}`, 10, 900),
  ]);
  if (!byIp.ok || !byEmail.ok) {
    return {
      error: `Too many attempts. Try again in ${Math.ceil(Math.max(byIp.retryAfter, byEmail.retryAfter) / 60)} minutes.`,
      fields,
    };
  }

  const user = await queryOne<{
    id: string;
    password_hash: string | null;
    status: string;
  }>(`SELECT id, password_hash, status FROM users WHERE email = $1`, [email]);
  if (!user) {
    await dummyVerify(password);
    return { error: generic, fields };
  }
  if (!(await verifyPassword(password, user.password_hash)))
    return { error: generic, fields };
  if (user.status !== "active")
    return { error: "This account is suspended.", fields };

  await query(
    `UPDATE users SET last_login_at = now(), role = CASE WHEN $2 THEN 'admin' ELSE role END WHERE id = $1`,
    [user.id, isAdminEmail(email)],
  );
  await createSession(user.id);
  redirect(safeNext(form.get("next")));
}

export async function signOut() {
  await destroySession();
  redirect("/");
}

export async function changePassword(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const current = String(form.get("current") || "");
  const next = String(form.get("password") || "");

  const row = await queryOne<{ password_hash: string | null }>(
    `SELECT password_hash FROM users WHERE id = $1`,
    [user.id],
  );
  const hadPassword = !!row?.password_hash;
  // Accounts created with GitHub, Google or Facebook have no password yet and can set one.
  if (hadPassword && !(await verifyPassword(current, row!.password_hash)))
    return { error: "Your current password is wrong." };
  const problem = passwordProblem(next);
  if (problem) return { error: problem };

  await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
    user.id,
    await hashPassword(next),
  ]);
  if (!hadPassword)
    return {
      ok: "Password set. You can now also sign in with your email and password.",
    };
  // Sign out other devices, keep this one.
  await destroyAllSessions(user.id);
  await createSession(user.id);
  notifyPasswordChanged(user.email);
  return { ok: "Password changed. Other devices were signed out." };
}

export async function updateProfile(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const name = String(form.get("name") || "")
    .trim()
    .slice(0, 60);
  await query(`UPDATE users SET display_name = $2 WHERE id = $1`, [
    user.id,
    name || null,
  ]);
  return { ok: "Saved." };
}

export async function signOutEverywhere() {
  const user = await currentUser();
  if (user) await destroyAllSessions(user.id);
  await destroySession();
  redirect("/login");
}

export async function disconnectProvider(form: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const provider = String(form.get("provider") || "");
  const methods = await queryOne<{ has_password: boolean; providers: string }>(
    `SELECT password_hash IS NOT NULL AS has_password,
            (SELECT count(*) FROM oauth_accounts WHERE user_id = $1) AS providers
       FROM users WHERE id = $1`,
    [user.id],
  );
  // Never remove the last way to sign in.
  if (!methods || (!methods.has_password && Number(methods.providers) <= 1)) {
    redirect("/account/settings?error=last_method");
  }
  await query(
    `DELETE FROM oauth_accounts WHERE user_id = $1 AND provider = $2`,
    [user.id, provider],
  );
  redirect(`/account/settings?disconnected=${encodeURIComponent(provider)}`);
}

// ---------------------------------------------------------------- password reset

function notifyPasswordChanged(email: string) {
  void sendPasswordChangedEmail(email).then((r) => {
    if (!r.ok)
      console.warn(
        `[password] couldn't send the "password changed" email: ${r.error}`,
      );
  });
}

/**
 * "Forgot password?" Always answers the same way, whether or not the address has an account, so the
 * form can't be used to find out who has one. The lookup and email for a real account run after the
 * reply, so response times don't give it away either.
 */
export async function requestPasswordReset(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const fields = { email };
  if (!EMAIL_RE.test(email) || email.length > 254)
    return { error: "Enter the email address you signed up with.", fields };
  if (!mailEnabled()) {
    return {
      error: `Password reset by email isn't available right now. Contact us at ${config.contactEmail}.`,
      fields,
    };
  }

  const from = await ip();
  const byIp = await rateLimit(`rl:reset:ip:${from}`, 10, 3600);
  if (!byIp.ok)
    return {
      error: "Too many requests from this network. Try again in an hour.",
      fields,
    };

  const done: FormState = {
    ok: `If ${email} has a ${config.siteName} account, we've sent it a link to choose a new password. It expires in ${RESET_MINUTES} minutes. Check your spam folder if it doesn't arrive in a few minutes.`,
  };
  // At most 3 emails an hour to one address, so the form can't be used to flood someone's inbox.
  const byEmail = await rateLimit(`rl:reset:email:${email}`, 3, 3600);
  if (!byEmail.ok) return done;

  void (async () => {
    const user = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM users WHERE email = $1`,
      [email],
    );
    if (!user || user.status !== "active") return;
    const providers = await query<{ provider: string }>(
      `SELECT provider FROM oauth_accounts WHERE user_id = $1`,
      [user.id],
    );
    const link = await createResetLink(user.id, from);
    const sent = await sendResetEmail(
      email,
      link,
      providers.map((p) => providerLabel(p.provider)),
    );
    if (!sent.ok)
      console.warn(`[password] couldn't send a reset email: ${sent.error}`);
  })().catch((err) => console.error("[password] reset request failed:", err));

  return done;
}

/** The page behind the emailed link: set a new password, sign out everywhere, sign in here. */
export async function resetPassword(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const token = String(form.get("token") || "");
  const password = String(form.get("password") || "");
  const confirm = String(form.get("confirm") || "");

  const limit = await rateLimit(`rl:reset:use:${await ip()}`, 20, 3600);
  if (!limit.ok) return { error: "Too many attempts. Try again later." };

  const target = await findReset(token);
  if (!target)
    return {
      error: "This link has expired or was already used. Ask for a new one.",
    };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  if (password !== confirm) return { error: "The two passwords don't match." };

  if (!(await consumeReset(token, target.user_id))) {
    return {
      error: "This link has expired or was already used. Ask for a new one.",
    };
  }
  await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
    target.user_id,
    await hashPassword(password),
  ]);
  await destroyAllSessions(target.user_id);
  await createSession(target.user_id);
  notifyPasswordChanged(target.email);
  redirect("/account/settings?reset=1");
}
