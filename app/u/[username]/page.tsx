import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconAlbum } from "@/components/Icons";
import { listAlbums } from "@/lib/albums";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";

type Props = { params: Promise<{ username: string }> };

async function load(username: string) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) return null;
  return queryOne<{
    id: string;
    username: string;
    display_name: string | null;
    created_at: Date;
  }>(
    `SELECT id, username, display_name, created_at FROM users WHERE lower(username) = lower($1) AND status = 'active'`,
    [username],
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const user = await load((await params).username);
  if (!user) return { title: "Profile not found", robots: { index: false } };
  const name = user.display_name?.trim() || user.username;
  return {
    title: `${name}'s albums`,
    description: `Public albums by ${name}.`,
  };
}

/** A member's public albums. Unlisted and private albums never appear here. */
export default async function Profile({ params }: Props) {
  const user = await load((await params).username);
  if (!user) notFound();
  const [albums, viewer] = await Promise.all([
    listAlbums(user.id, { visibility: "public" }),
    currentUser(),
  ]);
  const name = user.display_name?.trim() || user.username;
  const since = new Date(user.created_at).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{name}</h1>
          <p>
            @{user.username} · member since {since}
          </p>
        </div>
        {viewer?.id === user.id && (
          <Link className="btn secondary" href="/account/albums">
            Manage albums
          </Link>
        )}
      </div>
      {albums.length === 0 ? (
        <div className="panel empty">
          <span className="empty-icon" aria-hidden="true">
            <IconAlbum size={26} />
          </span>
          <h2>No public albums yet</h2>
          {viewer?.id === user.id && (
            <p>Albums you make Public are shown here.</p>
          )}
        </div>
      ) : (
        <div className="album-grid">
          {albums.map((a) => (
            <Link key={a.id} href={`/a/${a.id}`} className="album-card">
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
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
