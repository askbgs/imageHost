import {
  CreateBucketCommand,
  DeleteObjectsCommand,
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

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
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
  await s3.send(
    new DeleteObjectsCommand({
      Bucket,
      Delete: { Objects: unique.map((Key) => ({ Key })), Quiet: true },
    }),
  );
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

/** Create the bucket if missing and allow browser PUTs from the site (for UPLOAD_MODE=direct). */
export async function ensureBucket(siteOrigin: string) {
  const result: { bucket: string; created: boolean; cors: "set" | "failed"; corsError?: string } = {
    bucket: Bucket,
    created: false,
    cors: "failed",
  };
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket }));
    result.created = true;
  }
  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [siteOrigin],
              AllowedMethods: ["PUT", "GET", "HEAD"],
              AllowedHeaders: ["content-type"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    result.cors = "set";
  } catch (err) {
    result.corsError = err instanceof Error ? err.message : String(err);
  }
  return result;
}
