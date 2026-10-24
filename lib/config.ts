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

// ---- Storage: Cloudflare R2 (default) or any S3-compatible service ----
// R2 is used whenever R2_ACCOUNT_ID is set; the S3_* variables are the fallback
// (for example MinIO for local development).
const r2Account = process.env.R2_ACCOUNT_ID || "";
const r2Jurisdiction = (process.env.R2_JURISDICTION || "").toLowerCase(); // "", "eu" or "fedramp"
const r2Endpoint = r2Account
  ? `https://${r2Account}${r2Jurisdiction ? `.${r2Jurisdiction}` : ""}.r2.cloudflarestorage.com`
  : "";
// Public custom domain connected to the bucket, e.g. https://img.yoursite.com
const r2PublicUrl = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

const storage = r2Account
  ? {
      driver: "r2" as const,
      endpoint: r2Endpoint,
      publicEndpoint: r2Endpoint,
      region: "auto",
      bucket: env("R2_BUCKET"),
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      forcePathStyle: false,
    }
  : {
      driver: "s3" as const,
      // Endpoint the app and worker use (inside Docker: http://minio:9000).
      endpoint: process.env.S3_ENDPOINT || undefined,
      // Endpoint browsers use for presigned PUTs. Defaults to endpoint.
      publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || undefined,
      region: env("S3_REGION", "auto"),
      bucket: env("S3_BUCKET", "pinpicx"),
      accessKeyId: env("S3_ACCESS_KEY_ID", "minioadmin"),
      secretAccessKey: env("S3_SECRET_ACCESS_KEY", "minioadmin"),
      forcePathStyle: env("S3_FORCE_PATH_STYLE", "true") === "true",
    };

// How /i/... image links are served:
//   "public":   links point straight at the bucket's public domain (R2 custom domain + Cloudflare CDN)
//   "redirect": links on this site redirect to a short-lived signed storage URL
//   "proxy":    links on this site stream the bytes through the app
// Default: "public" when R2_PUBLIC_URL is set, "redirect" for R2 without it, "proxy" otherwise.
type Delivery = "public" | "redirect" | "proxy";
const deliveryRaw = (process.env.IMAGE_DELIVERY || "").toLowerCase();
const imageDelivery: Delivery =
  deliveryRaw === "public" || deliveryRaw === "redirect" || deliveryRaw === "proxy"
    ? deliveryRaw
    : r2PublicUrl
      ? "public"
      : storage.driver === "r2"
        ? "redirect"
        : "proxy";
if (imageDelivery === "public" && !r2PublicUrl && !process.env.IMAGE_BASE_URL) {
  throw new Error("IMAGE_DELIVERY=public needs R2_PUBLIC_URL (the bucket's custom domain)");
}

export const config = {
  siteName: env("SITE_NAME", "PinPicX"),
  siteUrl,
  // Where direct image links point. With public delivery this is the bucket's domain;
  // otherwise this app's /i route (or a host you map to it).
  imageBaseUrl: (imageDelivery === "public"
    ? process.env.IMAGE_BASE_URL || r2PublicUrl
    : env("IMAGE_BASE_URL", `${siteUrl}/i`)
  ).replace(/\/$/, ""),

  databaseUrl: env("DATABASE_URL", "postgres://pinpicx:pinpicx@localhost:5432/pinpicx"),
  redisUrl: env("REDIS_URL", "redis://localhost:6379"),

  s3: storage,
  imageDelivery,

  // Optional: purge Cloudflare's cache when images are deleted (public delivery).
  // Token needs the "Cache Purge" permission on the zone of R2_PUBLIC_URL.
  cloudflare: {
    zoneId: process.env.CLOUDFLARE_ZONE_ID || "",
    apiToken: process.env.CLOUDFLARE_API_TOKEN || "",
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
