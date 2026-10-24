import Link from "next/link";
import { revalidatePath } from "next/cache";
import { SourceTag } from "@/components/SourceTag";
import { requireAdmin } from "@/lib/auth";
import { PLANS, PLAN_IDS } from "@/lib/plans";
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
  await requireAdmin();
  const id = String(formData.get("image_id") || "");
  const block = formData.get("block") === "1";
  const img = IMAGE_ID_RE.test(id) ? await getImage(id) : null;
  if (img && img.status !== "removed") {
    await removeImage(img, {
      keepRecord: true,
      blockReason: block ? "removed by moderator" : undefined,
    });
  }
  await query(
    `UPDATE reports SET status = 'actioned' WHERE image_id = $1 AND status = 'open'`,
    [id],
  );
  revalidatePath("/admin");
}

async function dismissAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("image_id") || "");
  await query(
    `UPDATE reports SET status = 'dismissed' WHERE image_id = $1 AND status = 'open'`,
    [id],
  );
  revalidatePath("/admin");
}

async function unflagAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("image_id") || "");
  await query(
    `UPDATE images SET status = 'active' WHERE id = $1 AND status = 'flagged'`,
    [id],
  );
  revalidatePath("/admin");
}

function Actions({
  imageId,
  report,
  flagged,
}: {
  imageId: string;
  report?: boolean;
  flagged?: boolean;
}) {
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

async function setUserPlan(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("user_id") || "");
  const plan = String(formData.get("plan") || "");
  if (!(PLAN_IDS as string[]).includes(plan)) return;
  await query(`UPDATE users SET plan = $2 WHERE id = $1`, [id, plan]);
  revalidatePath("/admin");
}

async function setUserStatus(formData: FormData) {
  "use server";
  const admin = await requireAdmin();
  const id = String(formData.get("user_id") || "");
  const status =
    formData.get("status") === "suspended" ? "suspended" : "active";
  if (id === admin.id) return; // never lock yourself out
  await query(`UPDATE users SET status = $2 WHERE id = $1`, [id, status]);
  if (status === "suspended") {
    await query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
    await query(
      `UPDATE api_keys SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [id],
    );
  }
  revalidatePath("/admin");
}

type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  status: string;
  plan: string;
  created_at: Date;
  images: string;
  keys: string;
  paying: boolean;
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const admin = await requireAdmin();
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

  const users =
    view === "users"
      ? await query<UserRow>(
          `SELECT u.id, u.email, u.display_name, u.role, u.status, u.plan, u.created_at,
                  (SELECT count(*) FROM images i WHERE i.user_id = u.id AND i.status IN ('active','flagged')) AS images,
                  (SELECT count(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS keys,
                  EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id
                           AND s.status IN ('active', 'trialing', 'past_due')) AS paying
             FROM users u ORDER BY u.created_at DESC LIMIT 200`,
        )
      : [];

  const images =
    view === "flagged" || view === "recent"
      ? await query<ImageRow>(
          `SELECT * FROM images WHERE status = ANY($1) ORDER BY created_at DESC LIMIT 100`,
          [view === "flagged" ? ["flagged"] : ["active", "flagged"]],
        )
      : [];

  const [counts] = await query<{
    open: string;
    flagged: string;
    total: string;
  }>(
    `SELECT (SELECT count(*) FROM reports WHERE status = 'open') AS open,
            (SELECT count(*) FROM images WHERE status = 'flagged') AS flagged,
            (SELECT count(*) FROM images WHERE status IN ('active', 'flagged')) AS total`,
  );

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div className="page-head" style={{ paddingBottom: 0 }}>
        <div>
          <h1>Moderation</h1>
          <p>
            {counts?.open} open report{counts?.open === "1" ? "" : "s"},{" "}
            {counts?.flagged} flagged, {counts?.total} live images.
          </p>
        </div>
      </div>
      <nav className="segmented" aria-label="Moderation views">
        <Link
          href="/admin?view=reports"
          aria-current={view === "reports" ? "page" : undefined}
        >
          Open reports
        </Link>
        <Link
          href="/admin?view=flagged"
          aria-current={view === "flagged" ? "page" : undefined}
        >
          Flagged
        </Link>
        <Link
          href="/admin?view=recent"
          aria-current={view === "recent" ? "page" : undefined}
        >
          Recent uploads
        </Link>
        <Link
          href="/admin?view=users"
          aria-current={view === "users" ? "page" : undefined}
        >
          Users
        </Link>
      </nav>

      {view === "reports" &&
        (reports.length === 0 ? (
          <p>No open reports.</p>
        ) : (
          <div className="table-scroll">
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
                  const l = links({
                    id: r.image_id,
                    slug: r.slug,
                    delete_token: r.delete_token,
                  });
                  return (
                    <tr key={r.image_id}>
                      <td>
                        <a href={l.viewer} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {r.status === "removed" ? (
                            r.image_id
                          ) : (
                            <img src={l.thumb} alt={r.image_id} />
                          )}
                        </a>
                      </td>
                      <td>
                        <strong>{REPORT_LABELS[r.reason] ?? r.reason}</strong>
                        {r.details && <div className="detail">{r.details}</div>}
                      </td>
                      <td>{r.report_count}</td>
                      <td>
                        <Actions
                          imageId={r.image_id}
                          report
                          flagged={r.status === "flagged"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {view === "users" && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Images</th>
                <th>Plan</th>
                <th>API keys</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.display_name || u.email}</strong>
                    <div className="detail">
                      {u.email}
                      {u.role === "admin" ? ", admin" : ""}
                      {u.status !== "active" ? `, ${u.status}` : ""}
                    </div>
                  </td>
                  <td>{u.images}</td>
                  <td>
                    <form
                      action={setUserPlan}
                      className="plan-form"
                      key={`${u.id}-${u.plan}`}
                    >
                      <input type="hidden" name="user_id" value={u.id} />
                      <label className="sr-only" htmlFor={`plan-${u.id}`}>
                        Plan for {u.email}
                      </label>
                      <select
                        id={`plan-${u.id}`}
                        name="plan"
                        defaultValue={u.plan}
                      >
                        {PLAN_IDS.map((p) => (
                          <option key={p} value={p}>
                            {PLANS[p].label}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn secondary small">
                        Save
                      </button>
                    </form>
                    {u.paying && (
                      <div
                        className="detail"
                        title="Paid through Paddle. A manual change is replaced at the next billing event."
                      >
                        Paid via Paddle
                      </div>
                    )}
                  </td>
                  <td>{u.keys}</td>
                  <td>{new Date(u.created_at).toLocaleDateString("en-GB")}</td>
                  <td>
                    {u.id !== admin.id && (
                      <form action={setUserStatus}>
                        <input type="hidden" name="user_id" value={u.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={u.status === "active" ? "suspended" : "active"}
                        />
                        <button
                          className={`btn small ${u.status === "active" ? "danger" : "secondary"}`}
                          type="submit"
                        >
                          {u.status === "active" ? "Suspend" : "Reactivate"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(view === "flagged" || view === "recent") &&
        (images.length === 0 ? (
          <p>Nothing here.</p>
        ) : (
          <div className="table-scroll">
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
                        <strong>{img.title || img.slug}</strong>{" "}
                        <SourceTag
                          source={img.source === "api" ? "api" : "web"}
                        />
                        <div className="detail">
                          {img.width} × {img.height},{" "}
                          {new Date(img.created_at).toLocaleString("en-GB")}
                          {img.status === "flagged" ? ", flagged" : ""}
                        </div>
                      </td>
                      <td>
                        <Actions
                          imageId={img.id}
                          flagged={img.status === "flagged"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
