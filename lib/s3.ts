import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutBucketLifecycleConfigurationCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config";

function makeClient(endpoint: string | undefined) {
  return new S3Client({
    endpoint,
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    // Newer SDKs add checksums by default; several S3-compatible services (and browsers
    // using presigned URLs) can't handle them, so only send them when an API requires it.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });
}

const g = globalThis as unknown as { __s3?: S3Client; __s3Public?: S3Client };
export const s3 = g.__s3 ?? makeClient(config.s3.endpoint);
// Separate client so presigned URLs carry the host browsers can reach.
const s3Public = g.__s3Public ?? makeClient(config.s3.publicEndpoint);
if (process.env.NODE_ENV !== "production") {
  g.__s3 = s3;
  g.__s3Public = s3Public;
}

const Bucket = config.s3.bucket;

export async function presignPut(key: string, contentType: string, contentLength: number) {
  const cmd = new PutObjectCommand({
    Bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  // content-length is signed, so the browser cannot upload more bytes than it declared.
  return getSignedUrl(s3Public, cmd, {
    expiresIn: 600,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
}

/**
 * Cache-Control stored on each object. With public delivery the CDN and browsers follow it,
 * so images are only cached "forever" when deletions can purge the CDN; otherwise a day.
 */
export function objectCacheControl(expiresAt?: Date | null) {
  if (expiresAt) {
    const left = Math.max(60, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    return `public, max-age=${Math.min(left, 86400)}`;
  }
  const canPurge = !!(config.cloudflare.zoneId && config.cloudflare.apiToken);
  return canPurge || config.imageDelivery !== "public" ? "public, max-age=31536000, immutable" : "public, max-age=86400";
}

export async function putObject(key: string, body: Buffer, contentType: string, cacheControl = objectCacheControl()) {
  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}

export async function headObject(key: string) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
  } catch {
    return null;
  }
}

export async function getObjectBuffer(key: string, maxBytes: number): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  if ((res.ContentLength ?? 0) > maxBytes) throw new Error("object too large");
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function getObjectStream(key: string) {
  return s3.send(new GetObjectCommand({ Bucket, Key: key }));
}

export async function deleteObjects(keys: string[]) {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return;
  try {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket,
        Delete: { Objects: unique.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  } catch {
    // Some S3-compatible services reject the batch call's checksum header; delete one by one.
    await Promise.all(unique.map((Key) => s3.send(new DeleteObjectCommand({ Bucket, Key }))));
  }
}

/** Short-lived signed GET URL, used when IMAGE_DELIVERY=redirect. */
export async function presignGet(key: string, opts: { contentType: string; expiresIn: number; cacheSeconds: number }) {
  const cmd = new GetObjectCommand({
    Bucket,
    Key: key,
    ResponseContentType: opts.contentType,
    ResponseContentDisposition: "inline",
    ResponseCacheControl: `public, max-age=${opts.cacheSeconds}`,
  });
  // Sign at the start of the current hour so every request in that hour gets the same URL
  // and browsers and CDNs can reuse their cached copy.
  const signingDate = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  return getSignedUrl(s3Public, cmd, { expiresIn: opts.expiresIn, signingDate });
}

export const CORS_RULES = (origin: string) => [
  {
    AllowedOrigins: [origin],
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["content-type"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

/**
 * Create the bucket if missing, allow browser PUTs from the site (UPLOAD_MODE=direct), and
 * expire raw uploads after a day. Each step reports its own result; a token without admin
 * rights can still upload even if these settings must be made in the dashboard instead.
 */
export async function ensureBucket(siteOrigin: string) {
  const result = {
    bucket: Bucket,
    created: false,
    cors: "failed" as "set" | "failed",
    corsError: "",
    lifecycle: "failed" as "set" | "failed",
    lifecycleError: "",
  };
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket }));
    result.created = true;
  }
  try {
    await s3.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: CORS_RULES(siteOrigin) } }));
    result.cors = "set";
  } catch (err) {
    result.corsError = err instanceof Error ? err.message : String(err);
  }
  try {
    await s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: "expire-raw-uploads",
              Status: "Enabled",
              Filter: { Prefix: "uploads/" },
              Expiration: { Days: 1 },
            },
          ],
        },
      }),
    );
    result.lifecycle = "set";
  } catch (err) {
    result.lifecycleError = err instanceof Error ? err.message : String(err);
  }
  return result;
}

/** A client for another bucket, used when migrating existing images into this storage. */
export function sourceClient(opts: {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}) {
  return new S3Client({
    endpoint: opts.endpoint,
    region: opts.region,
    forcePathStyle: opts.forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
  });
}
