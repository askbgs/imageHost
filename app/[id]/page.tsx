import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OwnerDelete } from "@/components/OwnerActions";
import { ReportForm } from "@/components/ReportForm";
import { currentUser } from "@/lib/auth";
import { ShareCodes } from "@/components/ShareCodes";
import { query } from "@/lib/db";
import { IMAGE_ID_RE } from "@/lib/ids";
import { getImage, isLive } from "@/lib/images";
import { embedCodes, links } from "@/lib/links";

type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  if (!IMAGE_ID_RE.test(id)) return null;
  const img = await getImage(id);
  if (!img || !isLive(img) || img.privacy === "private") return null;
  return img;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const img = await load(id);
  if (!img) return { title: "Image not found" };
  const l = links(img);
  const title = img.title || img.slug;
  const flagged = img.status === "flagged";
  return {
    title,
    robots: img.privacy === "unlisted" || flagged ? { index: false } : undefined,
    openGraph: flagged
      ? { title }
      : { title, type: "website", url: l.viewer, images: [{ url: l.medium }] },
    twitter: flagged ? undefined : { card: "summary_large_image", title, images: [l.medium] },
  };
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function ViewerPage({ params }: Props) {
  const { id } = await params;
  const img = await load(id);
  if (!img) notFound();

  query(`UPDATE images SET views = views + 1 WHERE id = $1`, [id]).catch(() => {});

  const l = links(img);
  const codes = embedCodes(img);
  const viewer = await currentUser();
  const isOwner = !!viewer && viewer.id === img.user_id;
  const flagged = img.status === "flagged";
  const title = img.title || img.slug;
  const uploaded = new Date(img.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="viewer">
      {flagged && (
        <p className="notice warn">This image may contain sensitive content. It is blurred until you open the full size.</p>
      )}
      <div className={`plate${flagged ? " flagged" : ""}`}>
        <div className="checker" style={{ lineHeight: 0, borderRadius: 2 }}>
          <a href={l.direct}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={l.direct} alt={title} width={img.width ?? undefined} height={img.height ?? undefined} />
          </a>
        </div>
      </div>
      <div className="info">
        <div>
          <h1>{title}</h1>
          <ul className="facts">
            <li>
              {img.width} × {img.height}
            </li>
            <li>{formatBytes(Number(img.size_bytes ?? 0))}</li>
            <li>Uploaded {uploaded}</li>
            {img.expires_at && <li>Deletes {new Date(img.expires_at).toLocaleString("en-GB")}</li>}
          </ul>
          <div className="row" style={{ marginTop: 16, gap: 8 }}>
            <a className="btn secondary small" href={l.direct} target="_blank" rel="noreferrer">
              Open full size
            </a>
            <a className="btn secondary small" href={l.direct} download={img.slug}>
              Download
            </a>
            {isOwner && <OwnerDelete id={img.id} title={title} thumb={l.thumb} />}
          </div>
        </div>
        <div style={{ display: "grid", gap: 20 }}>
          <ShareCodes
            codes={{
              viewer: codes.viewer,
              direct: codes.direct,
              html_full: codes.html_full,
              html_thumb: codes.html_thumb,
              bbcode_full: codes.bbcode_full,
              bbcode_thumb: codes.bbcode_thumb,
              markdown: codes.markdown,
            }}
          />
          {!isOwner && <ReportForm imageId={id} />}
        </div>
      </div>
    </div>
  );
}
