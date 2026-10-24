import Link from "next/link";
import { NewAlbumButton, VisibilityBadge } from "@/components/Albums";
import { IconAlbum } from "@/components/Icons";
import { accountPlan, listAlbums } from "@/lib/albums";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Albums" };
export const dynamic = "force-dynamic";

export default async function AlbumsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await requireUser("/account/albums");
  const [{ new: openNew }, albums, plan] = await Promise.all([
    searchParams,
    listAlbums(user.id),
    accountPlan(user.id),
  ]);
  const publicCount = albums.filter((a) => a.visibility === "public").length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Albums</h1>
          <p>
            Group images and share them with one link.
            {publicCount > 0 && (
              <>
                {" "}
                Public albums are shown on{" "}
                <Link href={`/u/${user.username}`}>your profile</Link>.
              </>
            )}
          </p>
        </div>
        <NewAlbumButton
          canPrivate={plan.privateAlbums}
          autoOpen={openNew === "1"}
        />
      </div>

      {albums.length === 0 ? (
        <div className="panel empty">
          <span className="empty-icon" aria-hidden="true">
            <IconAlbum size={26} />
          </span>
          <h2>No albums yet</h2>
          <p>
            Create an album, then add images from{" "}
            <Link href="/account">My images</Link> or choose it when you upload.
          </p>
        </div>
      ) : (
        <div className="album-grid">
          {albums.map((a) => (
            <Link
              key={a.id}
              href={`/account/albums/${a.id}`}
              className="album-card"
            >
              <span className="album-cover checker">
                {a.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.cover} alt="" loading="lazy" />
                ) : (
                  <IconAlbum size={32} />
                )}
              </span>
              <span className="album-meta">
                <strong>{a.title}</strong>
                <span className="album-sub">
                  {a.image_count} image{a.image_count === 1 ? "" : "s"}
                  <VisibilityBadge visibility={a.visibility} />
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
