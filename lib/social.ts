import { isAdminEmail } from "./auth";
import { config } from "./config";
import { pool, query, queryOne } from "./db";
import { OAuthError, type Profile, type ProviderId } from "./oauth";

type UserRow = { id: string; status: string };

/**
 * Find or create the account for a social sign-in.
 *
 * 1. The provider account is already connected → that user.
 * 2. The provider vouches for the email (GitHub verified primary, Google email_verified) and an
 *    account has that email → connect the provider to it. Unverified emails never join
 *    existing accounts, so nobody can take over an account by claiming its address.
 * 3. Otherwise create a new account (if sign-ups are open).
 */
export async function userForSignIn(provider: ProviderId, profile: Profile): Promise<string> {
  const linked = await queryOne<UserRow & { user_id: string }>(
    `SELECT u.id, u.status, o.user_id FROM oauth_accounts o JOIN users u ON u.id = o.user_id
      WHERE o.provider = $1 AND o.provider_user_id = $2`,
    [provider, profile.id],
  );
  if (linked) {
    if (linked.status !== "active") throw new OAuthError("suspended", "This account is suspended.");
    await query(
      `UPDATE oauth_accounts SET last_used_at = now(), email = COALESCE($3, email) WHERE provider = $1 AND provider_user_id = $2`,
      [provider, profile.id, profile.email],
    );
    await touchLogin(linked.id, profile);
    return linked.id;
  }

  const email = profile.email?.trim().toLowerCase() || null;
  if (email) {
    const existing = await queryOne<UserRow>(`SELECT id, status FROM users WHERE email = $1`, [email]);
    if (existing) {
      if (!profile.emailVerified) {
        throw new OAuthError(
          "email_in_use",
          "An account with this email already exists. Sign in with your password, then connect this provider in Settings.",
        );
      }
      if (existing.status !== "active") throw new OAuthError("suspended", "This account is suspended.");
      await connect(existing.id, provider, profile);
      await touchLogin(existing.id, profile);
      return existing.id;
    }
  }

  if (!config.allowSignup) throw new OAuthError("signup_closed", "New sign-ups are closed.");
  if (!email) {
    throw new OAuthError(
      "no_email",
      "We couldn't get an email address from this account. Allow access to your email, or sign up with email and password.",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const base = email.split("@")[0]!.replace(/[^\w.-]/g, "").slice(0, 24) || "user";
    const created = await client.query<{ id: string }>(
      `INSERT INTO users (email, username, display_name, password_hash, role, last_login_at)
       VALUES ($1, $2 || '-' || substr(md5(random()::text), 1, 5), $3, NULL, $4, now())
       RETURNING id`,
      [email, base, profile.name?.slice(0, 60) || null, profile.emailVerified && isAdminEmail(email) ? "admin" : "user"],
    );
    const userId = created.rows[0]!.id;
    await client.query(
      `INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email, display_name, last_used_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [provider, profile.id, userId, email, profile.name],
    );
    await client.query("COMMIT");
    return userId;
  } catch (err) {
    await client.query("ROLLBACK");
    if ((err as { code?: string }).code === "23505") {
      // Someone signed up with this email or provider account at the same moment.
      throw new OAuthError("retry", "Something changed while signing you in. Please try again.");
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Connect a provider to the signed-in user (from Settings). */
export async function connectToUser(userId: string, provider: ProviderId, profile: Profile) {
  const other = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2`,
    [provider, profile.id],
  );
  if (other && other.user_id !== userId) {
    throw new OAuthError("linked_elsewhere", "That account is already connected to a different user here.");
  }
  if (other) return;
  const mine = await queryOne(`SELECT 1 FROM oauth_accounts WHERE user_id = $1 AND provider = $2`, [userId, provider]);
  if (mine) throw new OAuthError("already_connected", "You already have an account from this provider connected. Disconnect it first.");
  await connect(userId, provider, profile);
}

async function connect(userId: string, provider: ProviderId, profile: Profile) {
  await query(
    `INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email, display_name, last_used_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (provider, provider_user_id) DO NOTHING`,
    [provider, profile.id, userId, profile.email, profile.name],
  );
}

async function touchLogin(userId: string, profile: Profile) {
  await query(
    `UPDATE users SET last_login_at = now(),
            role = CASE WHEN $2 THEN 'admin' ELSE role END
      WHERE id = $1`,
    [userId, profile.emailVerified && !!profile.email && isAdminEmail(profile.email)],
  );
}

export type SignInMethods = { hasPassword: boolean; providers: { provider: string; email: string | null; created_at: Date }[] };

export async function signInMethods(userId: string): Promise<SignInMethods> {
  const u = await queryOne<{ has_password: boolean }>(`SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = $1`, [userId]);
  const providers = await query<{ provider: string; email: string | null; created_at: Date }>(
    `SELECT provider, email, created_at FROM oauth_accounts WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return { hasPassword: !!u?.has_password, providers };
}
