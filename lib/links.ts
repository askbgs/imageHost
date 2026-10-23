import { config } from "./config";

export type ImageRow = {
  id: string;
  title: string | null;
  slug: string;
  storage_key: string;
  upload_key: string;
  mime_type: string | null;
  size_bytes: string | number | null;
  width: number | null;
  height: number | null;
  status: string;
  fail_reason: string | null;
  delete_token: string;
  expires_at: Date | null;
  created_at: Date;
  user_id: string | null;
  api_key_id: string | null;
  views: string | number;
  privacy: string;
  original_name: string | null;
  sha256: string | null;
};

export type VariantRow = {
  image_id: string;
  variant: "thumb" | "medium";
  storage_key: string;
  mime_type: string;
  width: number;
  height: number;
  size_bytes: string | number;
};

export function links(img: Pick<ImageRow, "id" | "slug" | "delete_token">) {
  const viewer = `${config.siteUrl}/${img.id}`;
  const direct = `${config.imageBaseUrl}/${img.id}/${img.slug}`;
  const thumb = `${config.imageBaseUrl}/${img.id}/t/${img.slug}`;
  const medium = `${config.imageBaseUrl}/${img.id}/m/${img.slug}`;
  const del = `${config.siteUrl}/${img.id}/delete/${img.delete_token}`;
  return { viewer, direct, thumb, medium, delete: del };
}

const escAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escMd = (s: string) => s.replace(/[[\]]/g, "");

export function embedCodes(img: Pick<ImageRow, "id" | "slug" | "delete_token" | "title">) {
  const l = links(img);
  const alt = escAttr(img.title || img.slug);
  return {
    viewer: l.viewer,
    direct: l.direct,
    html_full: `<img src="${l.direct}" alt="${alt}">`,
    html_thumb: `<a href="${l.viewer}"><img src="${l.thumb}" alt="${alt}"></a>`,
    bbcode_full: `[img]${l.direct}[/img]`,
    bbcode_thumb: `[url=${l.viewer}][img]${l.thumb}[/img][/url]`,
    markdown: `![${escMd(img.title || img.slug)}](${l.direct})`,
    markdown_thumb: `[![${escMd(img.title || img.slug)}](${l.thumb})](${l.viewer})`,
  };
}

/** Response body in ImgBB's shape (plus an `embed` object), so ImgBB clients work unchanged. */
export function imgbbData(img: ImageRow, variants: VariantRow[], includeDelete = true) {
  const l = links(img);
  const ext = img.slug.split(".").pop() ?? "";
  const stem = img.slug.replace(/\.[^.]+$/, "");
  const v = Object.fromEntries(variants.map((x) => [x.variant, x]));
  const expiration = img.expires_at
    ? Math.max(0, Math.round((new Date(img.expires_at).getTime() - new Date(img.created_at).getTime()) / 1000))
    : 0;

  const file = (url: string, mime: string | null) => ({
    filename: img.slug,
    name: stem,
    mime: mime ?? "",
    extension: ext,
    url,
  });

  const codes = embedCodes(img);
  return {
    id: img.id,
    title: img.title ?? stem,
    url_viewer: l.viewer,
    url: l.direct,
    display_url: v.medium ? l.medium : l.direct,
    width: img.width ?? 0,
    height: img.height ?? 0,
    size: Number(img.size_bytes ?? 0),
    time: Math.floor(new Date(img.created_at).getTime() / 1000),
    expiration,
    status: img.status,
    image: file(l.direct, img.mime_type),
    thumb: file(l.thumb, v.thumb?.mime_type ?? img.mime_type),
    medium: file(l.medium, v.medium?.mime_type ?? img.mime_type),
    ...(includeDelete ? { delete_url: l.delete } : {}),
    embed: {
      html: codes.html_thumb,
      html_full: codes.html_full,
      bbcode: codes.bbcode_thumb,
      bbcode_full: codes.bbcode_full,
      markdown: codes.markdown,
    },
  };
}
