import Link from "next/link";
import { ImageTile, type TileData } from "@/components/ImageTile";
import { IconUpload } from "@/components/Icons";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { links, type ImageRow } from "@/lib/links";

export const metadata = { title: "My images" };

const PER_PAGE = 48;

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function timeLeft(date: Date) {
  const s = (new Date(date).getTime() - Date.now()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

type Props = { searchParams: Promise<{ q?: string; page?: string }> };

export default async function MyImages({ searchParams }: Props) {
  const user = await requireUser("/account");
  const { q = "", page: pageRaw } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageRaw || "1", 10) || 1);
  const search = q.trim().slice(0, 100);

  const rows = await query<ImageRow & { total: string }>(
    `SELECT *, count(*) OVER () AS total FROM images
      WHERE user_id = $1 AND status IN ('active', 'flagged')
        AND (expires_at IS NULL OR expires_at > now())
        AND ($2 = '' OR title ILIKE $5 OR slug ILIKE $5)
      ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
    [user.id, search, PER_PAGE, (page - 1) * PER_PAGE, `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`],
  );
  const total = Number(rows[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const tiles: TileData[] = rows.map((r, i) => {
    const l = links(r);
    return {
      id: r.id,
      title: r.title || r.slug,
      thumb: l.thumb,
      direct: l.direct,
      viewer: l.viewer,
      meta: `${r.width} × ${r.height} · ${formatBytes(Number(r.size_bytes ?? 0))} · ${new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
      flagged: r.status === "flagged",
      expires: r.expires_at ? timeLeft(r.expires_at) : null,
      frame: String(total - ((page - 1) * PER_PAGE + i)).padStart(2, "0"),
    };
  });

  const qs = (p: number) => `/account?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(p) })}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My images</h1>
          <p>
            {total === 0 && !search
              ? "Images you upload appear here."
              : `${total} image${total === 1 ? "" : "s"}${search ? ` matching “${search}”` : ""}`}
          </p>
        </div>
        <Link href="/" className="btn primary">
          <IconUpload size={16} /> Upload
        </Link>
      </div>

      {(total > 0 || search) && (
        <div className="toolbar">
          <form role="search" action="/account">
            <label htmlFor="q" className="sr-only">
              Search by name
            </label>
            <input id="q" name="q" type="search" placeholder="Search by name" defaultValue={search} />
            <button type="submit" className="btn secondary">
              Search
            </button>
          </form>
          {search && (
            <Link href="/account" className="btn ghost small">
              Clear search
            </Link>
          )}
        </div>
      )}

      {tiles.length === 0 ? (
        <div className="panel empty">
          <h2>{search ? "No images match that name" : "No images yet"}</h2>
          <p>{search ? "Try another word, or clear the search." : "Drop an image on the upload page and it will show up here with its links."}</p>
          {!search && (
            <Link href="/" className="btn primary">
              Upload your first image
            </Link>
          )}
        </div>
      ) : (
        <div className="grid">
          {tiles.map((t) => (
            <ImageTile key={t.id} img={t} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 1 ? (
            <Link className="btn secondary small" href={qs(page - 1)}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link className="btn secondary small" href={qs(page + 1)}>
              Older
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
