import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ApiError } from "./http";

// Ranges a remote-URL upload must never reach (SSRF protection).
function isPrivate(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("::ffff:")) return isPrivate(v6.slice(7));
  return v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

async function assertPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new ApiError("url_fetch_failed", "That URL is not allowed");
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new ApiError("url_fetch_failed", "Could not resolve the image URL");
  if (addrs.some((a) => isPrivate(a.address))) throw new ApiError("url_fetch_failed", "That URL is not allowed");
}

/**
 * Download an image from a public http(s) URL with a timeout and a byte cap.
 * Redirects are followed manually (max 3) so every hop is checked.
 * Note: a DNS answer can change between this check and the connection (DNS rebinding);
 * for stronger isolation run the app where it cannot reach internal services, or route
 * these fetches through an egress proxy.
 */
export async function fetchRemoteImage(rawUrl: string, maxBytes: number): Promise<{ bytes: Buffer; name: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ApiError("invalid_image", "Invalid image URL");
  }

  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ApiError("url_fetch_failed", "Only http and https URLs are supported");
    }
    if (url.port && !["80", "443", "8080"].includes(url.port)) {
      throw new ApiError("url_fetch_failed", "That port is not allowed");
    }
    await assertPublicHost(url.hostname);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": "PinPicX-fetch/1.0", Accept: "image/*" },
      });
    } catch {
      clearTimeout(timer);
      throw new ApiError("url_fetch_failed", "Could not download the image URL");
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(timer);
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok || !res.body) {
      clearTimeout(timer);
      throw new ApiError("url_fetch_failed", `The image URL returned HTTP ${res.status}`);
    }
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > maxBytes) {
      clearTimeout(timer);
      ctrl.abort();
      throw new ApiError("file_too_large", "The remote image is over the size limit");
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          ctrl.abort();
          throw new ApiError("file_too_large", "The remote image is over the size limit");
        }
        chunks.push(value);
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("url_fetch_failed", "Downloading the image URL failed or timed out");
    } finally {
      clearTimeout(timer);
    }
    const name = decodeURIComponent(url.pathname.split("/").pop() || "image");
    return { bytes: Buffer.concat(chunks), name };
  }
  throw new ApiError("url_fetch_failed", "Too many redirects");
}
