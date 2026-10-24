// Prepare the bucket: create it if needed, allow browser uploads from SITE_URL (CORS),
// and expire unprocessed raw uploads after a day.
// Usage: node dist/setup-bucket.js   (or npx tsx scripts/setup-bucket.ts)
import { config } from "../lib/config";
import { CORS_RULES, ensureBucket } from "../lib/s3";

async function main() {
  const origin = new URL(config.siteUrl).origin;
  console.log(`Storage: ${config.s3.driver === "r2" ? "Cloudflare R2" : "S3-compatible"} · bucket "${config.s3.bucket}" · delivery: ${config.imageDelivery}`);
  if (config.imageDelivery === "public") console.log(`Public image domain: ${config.imageBaseUrl}`);

  const r = await ensureBucket(origin);
  console.log(`Bucket: ${r.created ? "created" : "exists"}.`);

  if (r.cors === "set") {
    console.log(`CORS: set for ${origin}. Browser uploads (UPLOAD_MODE=direct) will work.`);
  } else {
    console.log(`CORS: not set (${r.corsError}).`);
    console.log("  Set it in the Cloudflare dashboard (R2 → bucket → Settings → CORS Policy) with:");
    console.log(JSON.stringify(CORS_RULES(origin), null, 2).replace(/^/gm, "  "));
    console.log("  Or use UPLOAD_MODE=server.");
  }

  if (r.lifecycle === "set") {
    console.log("Lifecycle: raw uploads under uploads/ expire after 1 day.");
  } else {
    console.log(`Lifecycle: not set (${r.lifecycleError}). The worker's cleanup job removes them anyway.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
