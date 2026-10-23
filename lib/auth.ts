import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "./config";
import { query, queryOne } from "./db";
import { ApiError } from "./http";

export const SESSION_COOKIE = "ih_session";

export type User = {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  role: "user" | "admin";
  status: string;
  created_at: Date;
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function displayName(u: Pick<User, "display_name" | "email">) {
  return u.display_name?.trim() || u.email.split("@")[0]!;
}

/** Start a session: store only the token's hash, give the browser the token. */
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await query(`INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)`, [
    sha256(token),
    userId,
    expires,
    ua,
  ]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.siteUrl.startsWith("https://"),
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await query(`DELETE FROM sessions WHERE id = $1`, [sha256(token)]);
  jar.delete(SESSION_COOKIE);
}

export async function destroyAllSessions(userId: string) {
  await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

/** The signed-in user for this request, or null. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const user = await queryOne<User & { last_seen_at: Date }>(
    `SELECT u.id, u.email, u.username, u.display_name, u.role, u.status, u.created_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (!user || user.status !== "active") return null;
  // Refresh last-seen at most every 10 minutes.
  if (Date.now() - new Date(user.last_seen_at).getTime() > 600_000) {
    query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [sha256(token)]).catch(() => {});
  }
  return user;
}

/** For pages: send signed-out visitors to the sign-in page. */
export async function requireUser(next = "/"): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser("/admin");
  if (user.role !== "admin") redirect("/");
  return user;
}

/**
 * For cookie-authenticated API routes: reject cross-site requests. Browsers always send
 * Origin on fetch POSTs; SameSite=Lax cookies are the second line of defence.
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const expected = new URL(config.siteUrl).origin;
  const own = new URL(req.url).origin;
  if (origin !== expected && origin !== own) throw new ApiError("forbidden", "Cross-site request blocked");
}

/** Upload routes used by the website: returns the user, or null for guests when allowed. */
export async function uploaderFor(req: Request): Promise<User | null> {
  assertSameOrigin(req);
  const user = await currentUser();
  if (!user && config.requireLoginToUpload) throw new ApiError("unauthorized", "Sign in to upload images");
  return user;
}

export function isAdminEmail(email: string) {
  return config.adminEmails.includes(email.toLowerCase());
}
