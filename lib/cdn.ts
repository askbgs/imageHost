import { config } from "./config";

/**
 * Remove deleted images from Cloudflare's cache (public delivery through an R2 custom domain).
 * Best effort: failures are logged, never thrown. Needs CLOUDFLARE_ZONE_ID and a token with
 * the "Cache Purge" permission. Without them, objects are cached for a day (objectCacheControl).
 */
export async function purgeUrls(urls: string[]) {
  const { zoneId, apiToken } = config.cloudflare;
  if (!zoneId || !apiToken || config.imageDelivery !== "public" || urls.length === 0) return;
  for (let i = 0; i < urls.length; i += 100) {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ files: urls.slice(i, i + 100) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) console.error(`[cdn] purge failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
    } catch (err) {
      console.error("[cdn] purge failed:", err instanceof Error ? err.message : err);
    }
  }
}
