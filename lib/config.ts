// Central configuration, read from environment variables once.

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`${name} must be an integer`);
  return n;
}

const siteUrl = env("SITE_URL", "http://localhost:3000").replace(/\/$/, "");

export const config = {
  siteName: env("SITE_NAME", "imghost"),
  siteUrl,
  // Where direct image links point. Defaults to this app's /i route; in production
  // map a separate host (i.yoursite.com) to /i on this app through the reverse proxy.
  imageBaseUrl: env("IMAGE_BASE_URL", `${siteUrl}/i`).replace(/\/$/, ""),

  databaseUrl: env("DATABASE_URL", "postgres://imghost:imghost@localhost:5432/imghost"),
  redisUrl: env("REDIS_URL", "redis://localhost:6379"),

  s3: {
    // Endpoint the app and worker use (inside Docker: http://minio:9000).
    endpoint: process.env.S3_ENDPOINT || undefined,
    // Endpoint browsers use for presigned PUTs (e.g. https://s3.yoursite.com). Defaults to endpoint.
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || undefined,
    region: env("S3_REGION", "auto"),
    bucket: env("S3_BUCKET", "imghost"),
    accessKeyId: env("S3_ACCESS_KEY_ID", "minioadmin"),
    secretAccessKey: env("S3_SECRET_ACCESS_KEY", "minioadmin"),
    forcePathStyle: env("S3_FORCE_PATH_STYLE", "true") === "true",
  },

  maxUploadBytes: int("MAX_UPLOAD_MB", 32) * 1024 * 1024,
  maxPixels: int("MAX_PIXELS", 100_000_000),
  maxExpirationSeconds: 15_552_000, // 180 days
  minExpirationSeconds: 60,

  limits: {
    guestUploadsPerHour: int("GUEST_UPLOADS_PER_HOUR", 30),
    userUploadsPerHour: int("USER_UPLOADS_PER_HOUR", 200),
    maxApiKeysPerUser: int("MAX_API_KEYS_PER_USER", 10),
    reportsPerHour: int("REPORTS_PER_HOUR", 10),
  },

  // Set to "true" only when the app sits behind a proxy you control (Caddy, Cloudflare),
  // otherwise clients could spoof X-Forwarded-For to dodge rate limits.
  trustProxy: env("TRUST_PROXY", "false") === "true",
  // Read CF-Connecting-IP only when all traffic really comes through Cloudflare.
  trustCloudflare: env("TRUST_CLOUDFLARE", "false") === "true",
  // When set (e.g. "x-real-ip" on Railway), read the client IP from this one header only.
  clientIpHeader: (process.env.CLIENT_IP_HEADER || "").toLowerCase(),

  // "direct": browsers PUT to storage with presigned URLs (needs bucket CORS).
  // "server": browsers POST the file to this app, which stores it (works everywhere).
  uploadMode: env("UPLOAD_MODE", "direct") === "server" ? ("server" as const) : ("direct" as const),
  // "proxy": /i/... streams bytes through this app (best behind a CDN).
  // "redirect": /i/... redirects to a short-lived signed storage URL, so bytes come
  // straight from the bucket (Railway bucket egress is free; service egress is not).
  imageDelivery: env("IMAGE_DELIVERY", "proxy") === "redirect" ? ("redirect" as const) : ("proxy" as const),

  // Accounts
  allowSignup: env("ALLOW_SIGNUP", "true") === "true",
  // "true" (default): only signed-in users can upload from the website.
  requireLoginToUpload: env("REQUIRE_LOGIN_TO_UPLOAD", "true") === "true",
  // Accounts with these emails get the admin role (moderation) when they sign in.
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  sessionDays: int("SESSION_DAYS", 30),

  // Optional: an HTTP endpoint that scores images for NSFW content (see lib/moderation.ts).
  moderationWebhookUrl: process.env.MODERATION_WEBHOOK_URL || "",
  moderationThreshold: Number(process.env.MODERATION_THRESHOLD || "0.8"),

  abuseEmail: env("ABUSE_EMAIL", "abuse@example.com"),
};
