import Link from "next/link";
import { revalidatePath } from "next/cache";
import { REPORT_LABELS, type ReportReason } from "@/lib/constants";
import { query } from "@/lib/db";
import { IMAGE_ID_RE } from "@/lib/ids";
import { getImage, removeImage } from "@/lib/images";
import { links, type ImageRow } from "@/lib/links";

export const dynamic = "force-dynamic";
export const metadata = { title: "Moderation", robots: { index: false } };

type ReportRow = {
  id: string;
  image_id: string;
  reason: ReportReason;
  details: string | null;
  created_at: Date;
  report_count: string;
  slug: string;
  delete_token: string;
  status: string;
};

async function removeAction(formData: FormData) {
  "use server";
  const id = String(formData.get("image_id") || "");
  const block = formData.get("block") === "1";
  const img = IMAGE_ID_RE.test(id) ? await getImage(id) : null;
  if (img && img.status !== "removed") {
    await removeImage(img, { keepRecord: true, blockReason: block ? "removed by moderator" : undefined });
  }
  await query(`UPDATE reports SET status = 'actioned' WHERE image_id = $1 AND status = 'open'`, [id]);
  revalidatePath("/admin");
}

async function dismissAction(formData: FormData) {
  "use server";
  const id = String(formData.get("image_id") || "");
  await query(`UPDATE reports SET status = 'dismissed' WHERE image_id = $1 AND status = 'open'`, [id]);
  revalidatePath("/admin");
}

async function unflagAction(formData: FormData) {
  "use server";
  const id = String(formData.get("image_id") || "");
  await query(`UPDATE images SET status = 'active' WHERE id = $1 AND status = 'flagged'`, [id]);
  revalidatePath("/admin");
}

function Actions({ imageId, report, flagged }: { imageId: string; report?: boolean; flagged?: boolean }) {
  return (
    <div className="row-actions">
      <form action={removeAction}>
        <input type="hidden" name="image_id" value={imageId} />
        <button className="btn danger small" type="submit">
          Remove
        </button>
      </form>
      <form action={removeAction}>
        <input type="hidden" name="image_id" value={imageId} />
        <input type="hidden" name="block" value="1" />
        <button className="btn danger small" type="submit">
          Remove and block file
        </button>
      </form>
      {report && (
        <form action={dismissAction}>
          <input type="hidden" name="image_id" value={imageId} />
          <button className="btn secondary small" type="submit">
            Dismiss reports
          </button>
        </form>
      )}
      {flagged && (
        <form action={unflagAction}>
          <input type="hidden" name="image_id" value={imageId} />
          <button className="btn secondary small" type="submit">
            Mark safe
          </button>
        </form>
      )}
    </div>
  );
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "reports" } = await searchParams;

  const reports =
    view === "reports"
      ? await query<ReportRow>(
          `SELECT DISTINCT ON (r.image_id) r.id, r.image_id, r.reason, r.details, r.created_at,
                  count(*) OVER (PARTITION BY r.image_id) AS report_count, i.slug, i.delete_token, i.status
             FROM reports r JOIN images i ON i.id = r.image_id
            WHERE r.status = 'open'
            ORDER BY r.image_id, r.created_at DESC
            LIMIT 200`,
        )
      : [];

  const images =
    view !== "reports"
      ? await query<ImageRow>(
          `SELECT * FROM images WHERE status = ANY($1) ORDER BY created_at DESC LIMIT 100`,
          [view === "flagged" ? ["flagged"] : ["active", "flagged"]],
        )
      : [];

  const [counts] = await query<{ open: string; flagged: string; total: string }>(
    `SELECT (SELECT count(*) FROM reports WHERE status = 'open') AS open,
            (SELECT count(*) FROM images WHERE status = 'flagged') AS flagged,
            (SELECT count(*) FROM images WHERE status IN ('active', 'flagged')) AS total`,
  );

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div className="prose">
        <h1 style={{ marginBottom: 8 }}>Moderation</h1>
        <p style={{ margin: 0 }}>
          {counts?.open} open report{counts?.open === "1" ? "" : "s"}, {counts?.flagged} flagged, {counts?.total} live images.
        </p>
      </div>
      <nav className="code-tabs" aria-label="Moderation views">
        <Link href="/admin?view=reports" aria-current={view === "reports" ? "page" : undefined}>
          Open reports
        </Link>
        <Link href="/admin?view=flagged" aria-current={view === "flagged" ? "page" : undefined}>
          Flagged
        </Link>
        <Link href="/admin?view=recent" aria-current={view === "recent" ? "page" : undefined}>
          Recent uploads
        </Link>
      </nav>

      {view === "reports" &&
        (reports.length === 0 ? (
          <p>No open reports.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Latest reason</th>
                <th>Reports</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const l = links({ id: r.image_id, slug: r.slug, delete_token: r.delete_token });
                return (
                  <tr key={r.image_id}>
                    <td>
                      <a href={l.viewer} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {r.status === "removed" ? r.image_id : <img src={l.thumb} alt={r.image_id} />}
                      </a>
                    </td>
                    <td>
                      <strong>{REPORT_LABELS[r.reason] ?? r.reason}</strong>
                      {r.details && <div className="detail">{r.details}</div>}
                    </td>
                    <td>{r.report_count}</td>
                    <td>
                      <Actions imageId={r.image_id} report flagged={r.status === "flagged"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}

      {view !== "reports" &&
        (images.length === 0 ? (
          <p>Nothing here.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Details</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {images.map((img) => {
                const l = links(img);
                return (
                  <tr key={img.id}>
                    <td>
                      <a href={l.viewer} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={l.thumb} alt={img.id} />
                      </a>
                    </td>
                    <td>
                      <strong>{img.title || img.slug}</strong>
                      <div className="detail">
                        {img.width} × {img.height}, {new Date(img.created_at).toLocaleString("en-GB")}
                        {img.api_key_id ? ", via API" : ", web"} {img.status === "flagged" ? ", flagged" : ""}
                      </div>
                    </td>
                    <td>
                      <Actions imageId={img.id} flagged={img.status === "flagged"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
    </div>
  );
}
