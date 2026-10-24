// Copy existing images into the configured storage (e.g. Cloudflare R2) using the current
// key layout ({id}/{file}, {id}/t/{file}, {id}/m/{file}), then point the database at them.
//
// Same bucket, new layout only:   node dist/migrate-storage.js
// From another bucket (Railway, MinIO, S3):
//   SOURCE_S3_ENDPOINT=... SOURCE_S3_BUCKET=... SOURCE_S3_ACCESS_KEY_ID=... \
//   SOURCE_S3_SECRET_ACCESS_KEY=... [SOURCE_S3_REGION=auto] [SOURCE_S3_FORCE_PATH_STYLE=true] \
//   node dist/migrate-storage.js
// Add --dry-run to list what would happen. Safe to run again; finished images are skipped.
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { config } from "../lib/config";
import { pool, query } from "../lib/db";
import { imageKeys } from "../lib/process";
import { headObject, objectCacheControl, putObject, s3, sourceClient } from "../lib/s3";

const dry = process.argv.includes("--dry-run");

type Row = { id: string; slug: string; storage_key: string; mime_type: string | null; expires_at: Date | null };
type VRow = { image_id: string; variant: "thumb" | "medium"; storage_key: string; mime_type: string };

async function read(client: S3Client, bucket: string, key: string) {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return { body: Buffer.from(await res.Body!.transformToByteArray()), type: res.ContentType };
}

async function main() {
  const fromOther = !!process.env.SOURCE_S3_BUCKET;
  const source = fromOther
    ? sourceClient({
        endpoint: process.env.SOURCE_S3_ENDPOINT || undefined,
        region: process.env.SOURCE_S3_REGION || "auto",
        accessKeyId: process.env.SOURCE_S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.SOURCE_S3_SECRET_ACCESS_KEY || "",
        forcePathStyle: (process.env.SOURCE_S3_FORCE_PATH_STYLE || "true") === "true",
      })
    : s3;
  const sourceBucket = process.env.SOURCE_S3_BUCKET || config.s3.bucket;

  console.log(
    `Copying images ${fromOther ? `from bucket "${sourceBucket}"` : "within"} → ${config.s3.driver} bucket "${config.s3.bucket}"${dry ? " (dry run)" : ""}`,
  );

  const images = await query<Row>(
    `SELECT id, slug, storage_key, mime_type, expires_at FROM images
      WHERE status IN ('active', 'flagged') AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at`,
  );
  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (const img of images) {
    const keys = imageKeys(img.id, img.slug);
    const variants = await query<VRow>(`SELECT image_id, variant, storage_key, mime_type FROM image_variants WHERE image_id = $1`, [img.id]);
    const jobs: { from: string; to: string; mime: string; update: () => Promise<unknown> }[] = [
      {
        from: img.storage_key,
        to: keys.original,
        mime: img.mime_type ?? "application/octet-stream",
        update: () => query(`UPDATE images SET storage_key = $2 WHERE id = $1`, [img.id, keys.original]),
      },
      ...variants.map((v) => ({
        from: v.storage_key,
        to: v.variant === "thumb" ? keys.thumb : keys.medium,
        mime: v.mime_type,
        update: () =>
          query(`UPDATE image_variants SET storage_key = $3 WHERE image_id = $1 AND variant = $2`, [
            img.id,
            v.variant,
            v.variant === "thumb" ? keys.thumb : keys.medium,
          ]),
      })),
    ];

    try {
      for (const job of jobs) {
        const sameObject = !fromOther && job.from === job.to;
        if (sameObject || (await headObject(job.to))) {
          if (!dry && job.from !== job.to) await job.update();
          skipped++;
          continue;
        }
        if (dry) {
          console.log(`  would copy ${job.from} → ${job.to}`);
          copied++;
          continue;
        }
        const obj = await read(source, sourceBucket, job.from);
        await putObject(job.to, obj.body, job.mime || obj.type || "application/octet-stream", objectCacheControl(img.expires_at));
        await job.update();
        copied++;
      }
    } catch (err) {
      failed++;
      console.error(`  ${img.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`Done: ${images.length} images, ${copied} files copied, ${skipped} already in place, ${failed} images failed.`);
  if (!fromOther && copied > 0 && !dry) console.log("Old-layout objects were left in place; delete them once links are confirmed working.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
