import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";

// Sign-in with GitHub, Google and Facebook: OAuth 2.0 authorization code flow with
// state (CSRF) and PKCE. A provider is enabled when its client ID and secret are set.

export type ProviderId = "github" | "google" | "facebook";

export type Profile = {
  id: string;
  email: string | null;
  /** True only when the provider says it has confirmed the person controls this email. */
  emailVerified: boolean;
  name: string | null;
};

type Provider = {
  id: ProviderId;
  label: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  scope: string;
  extraAuthParams?: Record<string, string>;
  exchange: (code: string, verifier: string, redirectUri: string) => Promise<string>;
  profile: (accessToken: string) => Promise<Profile>;
};

const fbVersion = process.env.FACEBOOK_GRAPH_VERSION || "v26.0";

export class OAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function json<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OAuthError("provider_error", `${what}: unexpected response (HTTP ${res.status})`);
  }
  if (!res.ok || (body as { error?: unknown }).error) {
    const e = body as { error?: unknown; error_description?: string };
    const msg = typeof e.error === "string" ? e.error : (e.error as { message?: string })?.message;
    throw new OAuthError("provider_error", `${what}: ${e.error_description || msg || `HTTP ${res.status}`}`);
  }
  return body as T;
}

const timeout = () => AbortSignal.timeout(10_000);

function tokenForm(p: Provider, code: string, verifier: string, redirectUri: string) {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    code_verifier: verifier,
  });
}

const PROVIDERS: Record<ProviderId, Provider> = {
  github: {
    id: "github",
    label: "GitHub",
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    scope: "read:user user:email",
    extraAuthParams: { allow_signup: "true" },
    async exchange(code, verifier, redirectUri) {
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenForm(PROVIDERS.github, code, verifier, redirectUri),
        signal: timeout(),
      });
      return (await json<{ access_token: string }>(res, "GitHub token")).access_token;
    },
    async profile(token) {
      const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "imghost" };
      const user = await json<{ id: number; login: string; name: string | null }>(
        await fetch("https://api.github.com/user", { headers, signal: timeout() }),
        "GitHub profile",
      );
      // The profile's email field is optional and unverified; use the account's verified primary email.
      const emails = await json<{ email: string; primary: boolean; verified: boolean }[]>(
        await fetch("https://api.github.com/user/emails", { headers, signal: timeout() }),
        "GitHub emails",
      ).catch(() => []);
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      return { id: String(user.id), email: primary?.email ?? null, emailVerified: !!primary, name: user.name || user.login };
    },
  },

  google: {
    id: "google",
    label: "Google",
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scope: "openid email profile",
    extraAuthParams: { prompt: "select_account" },
    async exchange(code, verifier, redirectUri) {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenForm(PROVIDERS.google, code, verifier, redirectUri),
        signal: timeout(),
      });
      return (await json<{ access_token: string }>(res, "Google token")).access_token;
    },
    async profile(token) {
      const u = await json<{ sub: string; email?: string; email_verified?: boolean; name?: string }>(
        await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { Authorization: `Bearer ${token}` },
          signal: timeout(),
        }),
        "Google profile",
      );
      return { id: u.sub, email: u.email ?? null, emailVerified: u.email_verified === true, name: u.name ?? null };
    },
  },

  facebook: {
    id: "facebook",
    label: "Facebook",
    clientId: process.env.FACEBOOK_CLIENT_ID || "",
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET || "",
    authorizeUrl: `https://www.facebook.com/${fbVersion}/dialog/oauth`,
    scope: "email,public_profile",
    async exchange(code, verifier, redirectUri) {
      const url = new URL(`https://graph.facebook.com/${fbVersion}/oauth/access_token`);
      for (const [k, v] of tokenForm(PROVIDERS.facebook, code, verifier, redirectUri)) url.searchParams.set(k, v);
      const res = await fetch(url, { signal: timeout() });
      return (await json<{ access_token: string }>(res, "Facebook token")).access_token;
    },
    async profile(token) {
      const url = new URL(`https://graph.facebook.com/${fbVersion}/me`);
      url.searchParams.set("fields", "id,name,email");
      url.searchParams.set("access_token", token);
      const u = await json<{ id: string; name?: string; email?: string }>(await fetch(url, { signal: timeout() }), "Facebook profile");
      // Facebook doesn't say whether the email is confirmed, so it is never used to join
      // an existing account or to grant admin rights.
      return { id: u.id, email: u.email ?? null, emailVerified: false, name: u.name ?? null };
    },
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function getProvider(id: string): Provider | null {
  const p = PROVIDERS[id as ProviderId];
  return p && p.clientId && p.clientSecret ? p : null;
}

/** Providers with credentials configured, for showing buttons. */
export function enabledProviders(): { id: ProviderId; label: string }[] {
  return PROVIDER_IDS.filter((id) => getProvider(id)).map((id) => ({ id, label: PROVIDERS[id].label }));
}

export const providerLabel = (id: string) => PROVIDERS[id as ProviderId]?.label ?? id;

export function redirectUri(id: ProviderId) {
  return `${config.siteUrl}/auth/${id}/callback`;
}

// ---- state + PKCE, kept in a short-lived httpOnly cookie ----

export const STATE_COOKIE = "ih_oauth";

export type OAuthState = {
  provider: ProviderId;
  state: string;
  verifier: string;
  next: string;
  mode: "signin" | "link";
};

const b64url = (b: Buffer) => b.toString("base64url");

export function newAuthorization(provider: Provider, next: string, mode: OAuthState["mode"]) {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48)); // 64 chars, within PKCE's 43–128
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", redirectUri(provider.id));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  for (const [k, v] of Object.entries(provider.extraAuthParams ?? {})) url.searchParams.set(k, v);
  const cookie: OAuthState = { provider: provider.id, state, verifier, next, mode };
  return { url: url.toString(), cookie: Buffer.from(JSON.stringify(cookie)).toString("base64url") };
}

export function readStateCookie(value: string | undefined): OAuthState | null {
  if (!value || value.length > 2000) return null;
  try {
    const s = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as OAuthState;
    return s && typeof s.state === "string" && typeof s.verifier === "string" ? s : null;
  } catch {
    return null;
  }
}

export function safeNext(v: string | null | undefined) {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}
