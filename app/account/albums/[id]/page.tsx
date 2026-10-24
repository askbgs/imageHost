import Link from "next/link";
import { notFound } from "next/navigation";
import { AlbumOwnerBar, VisibilityBadge } from "@/components/Albums";
import { ImageGallery } from "@/components/ImageGallery";
import { accountPlan, albumImages, albumUrl, getAlbum } from "@/lib/albums";
import { requireUser } from "@/lib/auth";
import { toGalleryImages } from "@/lib/gallery";

export const dynamic = "force-dynamic";

const PER_PAGE = 60;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const album = await getAlbum((await params).id);
  return { title: album ? album.title : "Album" };
}

export default async function ManageAlbum({ params, searchParams }: Props) {
  const { id } = await params;
  const user = await requireUser(`/account/albums/${id}`);
  const album = await getAlbum(id);
  if (!album || album.user_id !== user.id) notFound();

  const page = Math.max(
    1,
    Number.parseInt((await searchParams).page || "1", 10) || 1,
  );
  const [rows, plan] = await Promise.all([
    albumImages(id, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
    accountPlan(user.id),
  ]);
  const total = Number(rows[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const tiles = toGalleryImages(rows, { total, offset: (page - 1) * PER_PAGE });

  return (
    <div className="stack-l">
      <div>
        <p className="crumbs">
          <Link href="/account/albums">Albums</Link> /
        </p>
        <div className="page-head" style={{ paddingTop: 4, paddingBottom: 12 }}>
          <div>
            <h1>
              {album.title} <VisibilityBadge visibility={album.visibility} />
            </h1>
            <p>
              {album.description ? `${album.description} · ` : ""}
              {total} image{total === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <AlbumOwnerBar
          album={{
            id: album.id,
            title: album.title,
            description: album.description,
            visibility: album.visibility,
          }}
          shareUrl={albumUrl(album.id)}
          canPrivate={plan.privateAlbums}
        />
      </div>

      <ImageGallery
        initial={tiles}
        album={{ id: album.id, coverId: album.cover_image_id }}
      />

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 1 && (
            <Link
              className="btn secondary small"
              href={`/account/albums/${id}?page=${page - 1}`}
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
              href={`/account/albums/${id}?page=${page + 1}`}
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
