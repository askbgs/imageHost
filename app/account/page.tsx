import Link from "next/link";
import { ImageGallery } from "@/components/ImageGallery";
import type { GalleryImage } from "@/components/Lightbox";
import { IconAlbum, IconUpload } from "@/components/Icons";
import { StorageMeter } from "@/components/StorageMeter";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { toGalleryImages } from "@/lib/gallery";
import { type ImageRow } from "@/lib/links";
import { myAlbumOptions } from "@/app/actions/albums";

import { storageUsage } from "@/lib/quota";

export const metadata = { title: "My images" };

const PER_PAGE = 48;

type Props = {
  searchParams: Promise<{ q?: string; page?: string; source?: string }>;
};

export default async function MyImages({ searchParams }: Props) {
  const user = await requireUser("/account");
  const { q = "", page: pageRaw, source: sourceRaw } = await searchParams;
  const source = sourceRaw === "api" || sourceRaw === "web" ? sourceRaw : "";
  const page = Math.max(1, Number.parseInt(pageRaw || "1", 10) || 1);
  const search = q.trim().slice(0, 100);

  const rows = await query<
    ImageRow & { total: string; key_name: string | null }
  >(
    `SELECT i.*, k.name AS key_name, count(*) OVER () AS total
       FROM images i LEFT JOIN api_keys k ON k.id = i.api_key_id
      WHERE i.user_id = $1 AND i.status IN ('active', 'flagged')
        AND (i.expires_at IS NULL OR i.expires_at > now())
        AND ($2 = '' OR i.title ILIKE $5 OR i.slug ILIKE $5)
        AND ($6 = '' OR i.source = $6)
      ORDER BY i.created_at DESC LIMIT $3 OFFSET $4`,
    [
      user.id,
      search,
      PER_PAGE,
      (page - 1) * PER_PAGE,
      `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
      source,
    ],
  );
  // Counts for the filter tabs (ignoring the current filter, respecting the search).
  const counts = await query<{ source: string; n: string }>(
    `SELECT source, count(*) AS n FROM images
      WHERE user_id = $1 AND status IN ('active', 'flagged') AND (expires_at IS NULL OR expires_at > now())
        AND ($2 = '' OR title ILIKE $3 OR slug ILIKE $3)
      GROUP BY source`,
    [user.id, search, `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`],
  );
  const [usage, albums] = await Promise.all([
    storageUsage(user.id),
    myAlbumOptions(),
  ]);
  const countOf = (s: string) =>
    Number(counts.find((c) => c.source === s)?.n ?? 0);
  const allCount = countOf("web") + countOf("api");
  const total = Number(rows[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const tiles: GalleryImage[] = toGalleryImages(rows, {
    total,
    offset: (page - 1) * PER_PAGE,
  });

  const qs = (p: number) =>
    `/account?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(source ? { source } : {}), page: String(p) })}`;
  const filterHref = (s: string) =>
    `/account${s || search ? `?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(s ? { source: s } : {}) })}` : ""}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My images</h1>
          <p>
            {allCount === 0 && !search
              ? "Images you upload appear here."
              : `${total} image${total === 1 ? "" : "s"}${source ? ` uploaded ${source === "api" ? "with the API" : "on the website"}` : ""}${search ? ` matching “${search}”` : ""}`}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link href="/account/albums" className="btn secondary">
            <IconAlbum size={16} /> Albums
            {albums.length ? ` (${albums.length})` : ""}
          </Link>
          <Link href="/" className="btn primary">
            <IconUpload size={16} /> Upload
          </Link>
        </div>
      </div>

      <section className="panel storage-panel" aria-label="Storage">
        <StorageMeter usage={usage} />
      </section>

      {(allCount > 0 || search || source) && (
        <div className="toolbar">
          <form role="search" action="/account">
            <label htmlFor="q" className="sr-only">
              Search by name
            </label>
            <input
              id="q"
              name="q"
              type="search"
              placeholder="Search by name"
              defaultValue={search}
            />
            <button type="submit" className="btn secondary">
              Search
            </button>
          </form>
          {search && (
            <Link
              href={source ? `/account?source=${source}` : "/account"}
              className="btn ghost small"
            >
              Clear search
            </Link>
          )}
          <nav
            className="segmented"
            aria-label="Filter by how images were uploaded"
          >
            <Link
              href={filterHref("")}
              aria-current={source === "" ? "page" : undefined}
            >
              All <span className="seg-count">{allCount}</span>
            </Link>
            <Link
              href={filterHref("web")}
              aria-current={source === "web" ? "page" : undefined}
            >
              Web <span className="seg-count">{countOf("web")}</span>
            </Link>
            <Link
              href={filterHref("api")}
              aria-current={source === "api" ? "page" : undefined}
            >
              API <span className="seg-count">{countOf("api")}</span>
            </Link>
          </nav>
        </div>
      )}

      {tiles.length === 0 ? (
        <div className="panel empty">
          <h2>
            {search
              ? "No images match that name"
              : source === "api"
                ? "No images uploaded with the API yet"
                : source === "web"
                  ? "No images uploaded on the website yet"
                  : "No images yet"}
          </h2>
          <p>
            {search
              ? "Try another word, or clear the search."
              : "Drop an image on the upload page and it will show up here with its links."}
          </p>
          {!search && (
            <Link href="/" className="btn primary">
              Upload your first image
            </Link>
          )}
        </div>
      ) : (
        <ImageGallery
          initial={tiles}
          albums={albums}
          canPrivate={usage.plan.privateAlbums}
        />
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
