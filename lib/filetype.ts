// Identify images by their first bytes. Extensions and client Content-Type are never trusted.

export type ImageKind = "jpeg" | "png" | "gif" | "webp" | "avif" | "bmp" | "tiff";

export const MIME: Record<ImageKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

// What each input is stored as after re-encoding. BMP and TIFF become PNG.
export const OUTPUT: Record<ImageKind, { kind: "jpeg" | "png" | "gif" | "webp" | "avif"; ext: string; mime: string }> = {
  jpeg: { kind: "jpeg", ext: "jpg", mime: "image/jpeg" },
  png: { kind: "png", ext: "png", mime: "image/png" },
  gif: { kind: "gif", ext: "gif", mime: "image/gif" },
  webp: { kind: "webp", ext: "webp", mime: "image/webp" },
  avif: { kind: "avif", ext: "avif", mime: "image/avif" },
  bmp: { kind: "png", ext: "png", mime: "image/png" },
  tiff: { kind: "png", ext: "png", mime: "image/png" },
};

// MIME types the web uploader may declare when asking for a presigned URL.
export const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/tiff",
]);

export function sniffImage(buf: Uint8Array): ImageKind | null {
  if (buf.length < 12) return null;
  const ascii = (start: number, end: number) => String.fromCharCode(...buf.subarray(start, end));

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (ascii(0, 4) === "GIF8") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    return null; // HEIC/HEIF and video containers are not accepted in v1
  }
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "bmp";
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a) || (buf[0] === 0x4d && buf[1] === 0x4d && buf[3] === 0x2a))
    return "tiff";
  return null;
}

/** Turn a user-supplied name into a short, URL-safe file stem. */
export function safeStem(name: string | null | undefined): string {
  const base = (name || "image")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "") // drop an extension
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, 60);
  return base || "image";
}
