import { timingSafeEqual } from "node:crypto";
import { customAlphabet } from "nanoid";

const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const newImageId = customAlphabet(base62, 8);
export const newDeleteToken = customAlphabet(base62, 32);
export const newUploadSuffix = customAlphabet(base62, 24);
export const newApiKey = () => `pp_${customAlphabet(base62, 40)()}`;

export const IMAGE_ID_RE = /^[0-9A-Za-z]{8}$/;

/** Constant-time comparison for secret tokens. */
export function tokenMatches(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
