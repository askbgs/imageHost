// Create the bucket if needed and try to allow browser uploads (CORS) from SITE_URL.
// Usage: node dist/setup-bucket.js   (or npx tsx scripts/setup-bucket.ts)
import { config } from "../lib/config";
import { ensureBucket } from "../lib/s3";

async function main() {
  const origin = new URL(config.siteUrl).origin;
  const r = await ensureBucket(origin);
  console.log(`Bucket "${r.bucket}": ${r.created ? "created" : "exists"}.`);
  if (r.cors === "set") {
    console.log(`CORS set for ${origin}. You can use UPLOAD_MODE=direct.`);
  } else {
    console.log(`CORS could not be set (${r.corsError}). Keep UPLOAD_MODE=server.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
