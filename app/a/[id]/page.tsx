import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyAlbumLink, VisibilityBadge } from "@/components/Albums";
import {
  albumImages,
  albumUrl,
  canView,
  getAlbum,
  listAlbums,
} from "@/lib/albums";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { links } from "@/lib/links";

const PER_PAGE = 60;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
};

/** The album if this visitor may see it. Private albums look like they don't exist to anyone but the owner. */
async function load(id: string) {
  const album = await getAlbum(id);
  if (!album) return null;
  const viewer = await currentUser();
  if (!canView(album, viewer?.id)) return null;
  const owner = await queryOne<{
    username: string;
    display_name: string | null;
    status: string;
  }>(`SELECT username, display_name, status FROM users WHERE id = $1`, [
    album.user_id,
  ]);
  if (!owner || owner.status !== "active") return null;
  return { album, owner, isOwner: viewer?.id === album.user_id };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).id);
  if (!data) return { title: "Album not found", robots: { index: false } };
  const { album } = data;
  const [cover] = await listAlbums(album.user_id).then((all) =>
    all.filter((a) => a.id === album.id),
  );
  const image = cover?.cover ?? undefined;
  return {
    title: album.title,
    description: album.description ?? undefined,
    robots:
      album.visibility === "public"
        ? undefined
        : { index: false, follow: false },
    openGraph: {
      title: album.title,
      description: album.description ?? undefined,
      url: albumUrl(album.id),
      images: image ? [{ url: image }] : undefined,
    },
    twitter: image
      ? { card: "summary_large_image", title: album.title, images: [image] }
      : undefined,
  };
}

export default async function AlbumPage({ params, searchParams }: Props) {
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();
  const { album, owner, isOwner } = data;

  const page = Math.max(
    1,
    Number.parseInt((await searchParams).page || "1", 10) || 1,
  );
  const rows = await albumImages(id, {
    limit: PER_PAGE,
    offset: (page - 1) * PER_PAGE,
  });
  const total = Number(rows[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const by = owner.display_name?.trim() || owner.username;

  return (
    <div className="album-page">
      {isOwner && (
        <p className="notice owner-notice">
          This is your album
          {album.visibility === "private" ? ", and only you can see it" : ""}.{" "}
          <Link href={`/account/albums/${album.id}`}>Manage album</Link>
        </p>
      )}
      <header className="album-head">
        <div>
          <h1>{album.title}</h1>
          {album.description && <p className="lede">{album.description}</p>}
          <p className="album-byline">
            {total} image{total === 1 ? "" : "s"} · by{" "}
            {album.visibility === "public" ? (
              <Link href={`/u/${owner.username}`}>{by}</Link>
            ) : (
              by
            )}
            {isOwner && (
              <>
                {" "}
                · <VisibilityBadge visibility={album.visibility} />
              </>
            )}
          </p>
        </div>
        {album.visibility !== "private" && (
          <CopyAlbumLink url={albumUrl(album.id)} />
        )}
      </header>

      {total === 0 ? (
        <div className="panel empty">
          <h2>This album is empty</h2>
        </div>
      ) : (
        <div className="album-photos">
          {rows.map((img) => {
            const l = links(img);
            const flagged = img.status === "flagged";
            const title = img.title || img.slug;
            return (
              <a
                key={img.id}
                href={l.viewer}
                className={`album-photo checker${flagged ? " flagged" : ""}`}
                title={title}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={l.medium}
                  alt={title}
                  loading="lazy"
                  width={img.width ?? undefined}
                  height={img.height ?? undefined}
                />
                {flagged && <span className="badge">Sensitive</span>}
              </a>
            );
          })}
        </div>
      )}

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 1 && (
            <Link
              className="btn secondary small"
              href={`/a/${id}?page=${page - 1}`}
            >
              Previous
            </Link>
          )}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link
              className="btn secondary small"
              href={`/a/${id}?page=${page + 1}`}
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
