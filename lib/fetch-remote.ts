/**
 * Downloads an image from a URL someone gave us (website "import from a link", API `image=https://…`),
 * without letting that URL reach anything private (SSRF protection).
 *
 * - Only http and https, on ports 80, 443 and 8080; no user:password@ in the URL.
 * - The address is checked when the connection is made, by the DNS lookup the connection itself uses.
 *   There's no separate "check first, connect later" step, so DNS rebinding (answering with a public
 *   address for the check and a private one for the download) can't work.
 * - Blocked: loopback, private networks, link-local and cloud metadata (169.254.169.254), carrier-grade
 *   NAT, multicast, reserved and documentation ranges, and the IPv6 forms that carry an IPv4 address
 *   inside them (::ffff:a.b.c.d in any notation, NAT64, 6to4, Teredo).
 * - Every redirect is checked the same way (at most 3).
 * - 10-second limit for the whole download, a byte cap, and no compressed transfers (no zip bombs).
 * - Every refusal gives the same message, so the errors can't be used to map internal names.
 */
import dns from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { config } from "./config";
import { ApiError } from "./http";

const ALLOWED_PORTS = new Set(["", "80", "443", "8080"]);
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const NOT_ALLOWED = "That image URL can't be used. Use a public http(s) link to an image.";

// ---------------------------------------------------------------- address rules

type Cidr = [bigint, number]; // network, prefix length

const v4 = (s: string): bigint | null => {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = (n << 8n) | BigInt(p);
  }
  return n;
};

/** Parses any IPv6 text form (::, embedded dotted IPv4, zone ids) to a 128-bit number. */
const v6 = (input: string): bigint | null => {
  let s = input.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const dotted = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const n = v4(dotted[1]!);
    if (n === null) return null;
    s = s.slice(0, -dotted[1]!.length) + `${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
};

const cidr4 = (s: string): Cidr => {
  const [a, bits] = s.split("/");
  return [v4(a!)!, Number(bits)];
};
const cidr6 = (s: string): Cidr => {
  const [a, bits] = s.split("/");
  return [v6(a!)!, Number(bits)];
};
const inCidr = (n: bigint, [net, bits]: Cidr, width: number) =>
  bits === 0 || n >> BigInt(width - bits) === net >> BigInt(width - bits);

const BLOCKED_V4 = [
  "0.0.0.0/8", // "this network"
  "10.0.0.0/8", // private
  "100.64.0.0/10", // carrier-grade NAT
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local, cloud metadata
  "172.16.0.0/12", // private
  "192.0.0.0/24", // IETF protocol assignments
  "192.0.2.0/24", // documentation
  "192.88.99.0/24", // 6to4 relay
  "192.168.0.0/16", // private
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // documentation
  "203.0.113.0/24", // documentation
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved, broadcast
].map(cidr4);

const BLOCKED_V6 = [
  "::/128", // unspecified
  "::1/128", // loopback
  "100::/64", // discard
  "2001::/23", // IETF protocol assignments, incl. Teredo (2001::/32)
  "2001:db8::/32", // documentation
  "2002::/16", // 6to4 (carries an IPv4 address)
  "3fff::/20", // documentation
  "5f00::/16", // segment routing
  "64:ff9b:1::/48", // local NAT64
  "fc00::/7", // unique local (incl. Railway private networking, fd12::/16)
  "fe80::/10", // link-local
  "fec0::/10", // site-local (deprecated)
  "ff00::/8", // multicast
].map(cidr6);

const EMBEDS_V4 = ["::ffff:0:0/96", "::/96", "64:ff9b::/96"].map(cidr6); // mapped, compatible, NAT64

function isBlockedV4(n: bigint) {
  return BLOCKED_V4.some((c) => inCidr(n, c, 32));
}

/** True for any address a URL upload must not reach. Unparseable input counts as blocked. */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address.replace(/%.*$/, ""));
  if (kind === 4) {
    const n = v4(address);
    return n === null || isBlockedV4(n);
  }
  if (kind === 6) {
    const n = v6(address);
    if (n === null) return true;
    if (EMBEDS_V4.some((c) => inCidr(n, c, 128))) {
      // ::ffff:7f00:1 is 127.0.0.1; :: and ::1 fall in ::/96 and are caught here too.
      return n <= 1n || isBlockedV4(n & 0xffffffffn);
    }
    if (BLOCKED_V6.some((c) => inCidr(n, c, 128))) return true;
    // Everything else outside global unicast (2000::/3) is reserved.
    return !inCidr(n, cidr6("2000::/3"), 128);
  }
  return true;
}

class BlockedAddress extends Error {}

/**
 * The DNS lookup used by the connection itself: whatever the name resolves to is checked right
 * before connecting, and a single blocked answer refuses the whole name.
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(new BlockedAddress(hostname) as NodeJS.ErrnoException, "", 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

// ---------------------------------------------------------------- download

function checkUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ApiError("url_fetch_failed", NOT_ALLOWED);
  if (!ALLOWED_PORTS.has(url.port)) throw new ApiError("url_fetch_failed", NOT_ALLOWED);
  if (url.username || url.password) throw new ApiError("url_fetch_failed", NOT_ALLOWED);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new ApiError("url_fetch_failed", NOT_ALLOWED);
  }
  // Literal IPs don't go through DNS, so check them here. (URL parsing has already turned forms like
  // 2130706433, 0x7f.1 or 017700000001 into 127.0.0.1.)
  if (isIP(host) && isBlockedAddress(host)) throw new ApiError("url_fetch_failed", NOT_ALLOWED);
}

function get(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        agent: false, // a fresh connection every time: nothing is reused across hosts or redirects
        signal,
        headers: {
          "User-Agent": `${config.siteName}-fetch/1.0`,
          Accept: "image/*",
          "Accept-Encoding": "identity", // no compressed transfers, so the byte cap is the real size
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

/** Download an image from a public http(s) URL. Throws ApiError with a message safe to show. */
export async function fetchRemoteImage(rawUrl: string, maxBytes: number): Promise<{ bytes: Buffer; name: string }> {
  let url: URL;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw new ApiError("invalid_image", "Invalid image URL");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      checkUrl(url);
      let res: IncomingMessage;
      try {
        res = await get(url, ctrl.signal);
      } catch (err) {
        if (err instanceof BlockedAddress || (err as { cause?: unknown }).cause instanceof BlockedAddress) {
          throw new ApiError("url_fetch_failed", NOT_ALLOWED);
        }
        // Unknown names get the same message as blocked ones, so errors don't reveal which names exist.
        if ((err as NodeJS.ErrnoException).code === "ENOTFOUND") throw new ApiError("url_fetch_failed", NOT_ALLOWED);
        throw new ApiError("url_fetch_failed", ctrl.signal.aborted ? "The image URL took too long to respond" : "Could not download the image URL");
      }

      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume(); // discard the body
        if (hop === MAX_REDIRECTS) throw new ApiError("url_fetch_failed", "Too many redirects");
        url = new URL(res.headers.location, url);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new ApiError("url_fetch_failed", `The image URL returned HTTP ${status}`);
      }
      if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") {
        res.resume();
        throw new ApiError("url_fetch_failed", "The image URL sent a compressed response; link to the image file itself");
      }
      if (Number(res.headers["content-length"] || 0) > maxBytes) {
        res.destroy();
        throw new ApiError("file_too_large", "The remote image is over the size limit");
      }

      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for await (const chunk of res) {
          total += (chunk as Buffer).length;
          if (total > maxBytes) {
            res.destroy();
            throw new ApiError("file_too_large", "The remote image is over the size limit");
          }
          chunks.push(chunk as Buffer);
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError("url_fetch_failed", ctrl.signal.aborted ? "The image URL took too long to respond" : "Downloading the image URL failed");
      }
      let name = url.pathname.split("/").pop() || "image";
      try {
        name = decodeURIComponent(name);
      } catch {
        /* keep it as is */
      }
      return { bytes: Buffer.concat(chunks), name };
    }
    throw new ApiError("url_fetch_failed", "Too many redirects");
  } finally {
    clearTimeout(timer);
  }
}
