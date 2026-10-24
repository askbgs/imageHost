import type { GalleryImage } from "@/components/Lightbox";
import { embedCodes, links, type ImageRow } from "./links";

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function timeLeft(date: Date) {
  const s = (new Date(date).getTime() - Date.now()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

/** Image rows → tiles for the owner's gallery (My images, album pages). */
export function toGalleryImages(
  rows: (ImageRow & { key_name?: string | null })[],
  opts: { total: number; offset: number },
): GalleryImage[] {
  return rows.map((r, i) => {
    const l = links(r);
    const c = embedCodes(r);
    return {
      id: r.id,
      title: r.title || r.slug,
      slug: r.slug,
      thumb: l.thumb,
      medium: l.medium,
      direct: l.direct,
      viewer: l.viewer,
      width: r.width ?? 0,
      height: r.height ?? 0,
      size: formatBytes(Number(r.size_bytes ?? 0)),
      uploaded: new Date(r.created_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      flagged: r.status === "flagged",
      source: r.source === "api" ? "api" : "web",
      keyName: r.key_name ?? null,
      expires: r.expires_at ? timeLeft(r.expires_at) : null,
      frame: String(opts.total - (opts.offset + i)).padStart(2, "0"),
      codes: {
        viewer: c.viewer,
        direct: c.direct,
        html_full: c.html_full,
        html_thumb: c.html_thumb,
        bbcode_full: c.bbcode_full,
        bbcode_thumb: c.bbcode_thumb,
        markdown: c.markdown,
      },
    };
  });
}
