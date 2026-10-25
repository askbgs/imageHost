import Link from "next/link";
import { revalidatePath } from "next/cache";
import { SourceTag } from "@/components/SourceTag";
import { formatStorage } from "@/lib/quota";
import { requireAdmin } from "@/lib/auth";
import { PLANS, PLAN_IDS, planFor } from "@/lib/plans";
import { REPORT_LABELS, type ReportReason } from "@/lib/constants";
import { query } from "@/lib/db";
import { IMAGE_ID_RE } from "@/lib/ids";
import { getImage, removeImage } from "@/lib/images";
import { links, type ImageRow } from "@/lib/links";
import { LABEL_TEXT, resumeUploads, screeningStatus } from "@/lib/moderation";
import { CONTACT_TOPICS, type ContactTopic } from "@/lib/contact";
import { config } from "@/lib/config";

const pct = (n: unknown) =>
  typeof n === "number" ? `${Math.round(n * 100)}%` : "";

/** "Adult content 93%, Self-harm 81%": what screening found, with the matching scores. */
function Findings({
  labels,
  scores,
}: {
  labels: string[] | null | undefined;
  scores?: Record<string, number> | null;
}) {
  if (!labels?.length) return null;
  const scoreFor: Record<string, string> = {
    adult: "adult",
    graphic_violence: "graphic_violence",
    self_harm: "self_harm",
    abusive_name: "name_abuse",
  };
  return (
    <div className="findings">
      {labels.map((l) => (
        <span key={l} className="finding">
          {LABEL_TEXT[l] ?? l}
          {scores && scoreFor[l] ? ` ${pct(scores[scoreFor[l]!])}` : ""}
        </span>
      ))}
    </div>
  );
}

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

async function messageDoneAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") || "");
  const done = formData.get("done") === "1";
  if (/^\d+$/.test(id))
    await query(`UPDATE contact_messages SET status = $2 WHERE id = $1`, [
      id,
      done ? "done" : "new",
    ]);
  revalidatePath("/admin");
}

async function resumeAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("user_id") || "");
  if (id) await resumeUploads(id);
  revalidatePath("/admin");
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
  stored: string;
  keys: string;
  paying: boolean;
  uploads_paused_at: Date | null;
};

type MessageRow = {
  id: string;
  name: string;
  email: string;
  topic: string;
  message: string;
  status: string;
  created_at: Date;
  emailed_at: Date | null;
  email_error: string | null;
  account: string | null;
};

type BlockedRow = {
  id: string;
  created_at: Date;
  fail_reason: string;
  moderation_labels: string[] | null;
  moderation_scores: Record<string, number> | null;
  uploader_ip: string | null;
  source: string;
  original_name: string | null;
  email: string | null;
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
          `SELECT u.id, u.email, u.display_name, u.role, u.status, u.plan, u.created_at, u.uploads_paused_at,
                  (SELECT count(*) FROM images i WHERE i.user_id = u.id AND i.status IN ('active','flagged')) AS images,
                  (SELECT COALESCE(sum(COALESCE(i.stored_bytes, i.size_bytes, 0)), 0) FROM images i
                    WHERE i.user_id = u.id AND i.status IN ('active','flagged')) AS stored,
                  (SELECT count(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS keys,
                  EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id
                           AND s.status IN ('active', 'trialing', 'past_due')) AS paying
             FROM users u ORDER BY (u.uploads_paused_at IS NOT NULL) DESC, u.created_at DESC LIMIT 200`,
        )
      : [];

  const messages =
    view === "messages"
      ? await query<MessageRow>(
          `SELECT m.id, m.name, m.email, m.topic, m.message, m.status, m.created_at, m.emailed_at, m.email_error,
                  u.email AS account
             FROM contact_messages m LEFT JOIN users u ON u.id = m.user_id
            ORDER BY (m.status = 'new') DESC, m.created_at DESC LIMIT 200`,
        )
      : [];

  const blocked =
    view === "blocked"
      ? await query<BlockedRow>(
          `SELECT i.id, i.created_at, i.fail_reason, i.moderation_labels, i.moderation_scores, i.uploader_ip,
                  i.source, i.original_name, u.email
             FROM images i LEFT JOIN users u ON u.id = i.user_id
            WHERE i.fail_reason LIKE 'blocked%'
            ORDER BY i.created_at DESC LIMIT 200`,
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
    blocked: string;
    paused: string;
    messages: string;
  }>(
    `SELECT (SELECT count(*) FROM reports WHERE status = 'open') AS open,
            (SELECT count(*) FROM images WHERE status = 'flagged') AS flagged,
            (SELECT count(*) FROM images WHERE status IN ('active', 'flagged')) AS total,
            (SELECT count(*) FROM images WHERE fail_reason LIKE 'blocked%' AND created_at > now() - interval '24 hours') AS blocked,
            (SELECT count(*) FROM users WHERE uploads_paused_at IS NOT NULL) AS paused,
            (SELECT count(*) FROM contact_messages WHERE status = 'new') AS messages`,
  );
  const screening = screeningStatus();

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div className="page-head" style={{ paddingBottom: 0 }}>
        <div>
          <h1>Moderation</h1>
          <p>
            {counts?.open} open report{counts?.open === "1" ? "" : "s"},{" "}
            {counts?.flagged} flagged, {counts?.blocked} blocked in the last 24
            hours
            {counts && counts.paused !== "0"
              ? `, ${counts.paused} account${counts.paused === "1" ? "" : "s"} with uploads paused`
              : ""}
            , {counts?.total} live images.
          </p>
        </div>
      </div>
      <p className={`screening-status ${screening.enabled ? "on" : "off"}`}>
        {screening.enabled ? (
          <>
            <strong>Automatic screening is on</strong> (
            {screening.provider === "openai"
              ? "OpenAI moderation"
              : "your webhook"}
            ). Adult images are{" "}
            {screening.adult === "block"
              ? "blocked"
              : screening.adult === "flag"
                ? "marked sensitive"
                : "allowed"}
            , graphic violence is{" "}
            {screening.gore === "block"
              ? "blocked"
              : screening.gore === "flag"
                ? "marked sensitive"
                : "allowed"}
            , self-harm is marked sensitive. Removed images you block also block
            look-alikes.
          </>
        ) : (
          <>
            <strong>Automatic screening is off.</strong> Set{" "}
            <code>OPENAI_API_KEY</code> to screen every upload for adult
            content, graphic violence and self-harm (free). See MODERATION.md.
          </>
        )}
      </p>
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
          href="/admin?view=blocked"
          aria-current={view === "blocked" ? "page" : undefined}
        >
          Blocked uploads
        </Link>
        <Link
          href="/admin?view=recent"
          aria-current={view === "recent" ? "page" : undefined}
        >
          Recent uploads
        </Link>
        <Link
          href="/admin?view=messages"
          aria-current={view === "messages" ? "page" : undefined}
        >
          Messages
          {counts && counts.messages !== "0" ? ` (${counts.messages})` : ""}
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
                <th>Storage</th>
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
                    {u.uploads_paused_at && (
                      <form action={resumeAction} className="paused-row">
                        <span
                          className="status-chip warn"
                          title={`Since ${new Date(u.uploads_paused_at).toLocaleString("en-GB")}`}
                        >
                          Uploads paused
                        </span>
                        <input type="hidden" name="user_id" value={u.id} />
                        <button className="btn secondary small" type="submit">
                          Resume uploads
                        </button>
                      </form>
                    )}
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
                  <td>
                    {formatStorage(Number(u.stored))}
                    <div className="detail">
                      of {formatStorage(planFor(u).storageBytes)}
                    </div>
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

      {view === "messages" &&
        (messages.length === 0 ? (
          <p>No messages yet. They arrive from the contact form at /contact.</p>
        ) : (
          <div className="message-list">
            {messages.map((m) => (
              <article
                key={m.id}
                className={`panel message${m.status === "done" ? " is-done" : ""}`}
              >
                <header>
                  <div>
                    <strong>{m.name}</strong>{" "}
                    <a
                      href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${CONTACT_TOPICS[m.topic as ContactTopic] ?? m.topic}`)}`}
                    >
                      {m.email}
                    </a>
                    <div className="detail">
                      {CONTACT_TOPICS[m.topic as ContactTopic] ?? m.topic} ·{" "}
                      {new Date(m.created_at).toLocaleString("en-GB")}
                      {m.account ? ` · account ${m.account}` : ""}
                    </div>
                  </div>
                  <form action={messageDoneAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <input
                      type="hidden"
                      name="done"
                      value={m.status === "done" ? "0" : "1"}
                    />
                    <button className="btn secondary small" type="submit">
                      {m.status === "done" ? "Mark as new" : "Mark as done"}
                    </button>
                  </form>
                </header>
                <p className="message-body">{m.message}</p>
                <p className="detail" style={{ margin: 0 }}>
                  {m.emailed_at
                    ? `Emailed to ${config.contactEmail}`
                    : `Not emailed${m.email_error ? `: ${m.email_error.replace(/[.\s]+$/, "")}` : ""}. Reply from here.`}
                </p>
              </article>
            ))}
          </div>
        ))}

      {view === "blocked" &&
        (blocked.length === 0 ? (
          <p>No blocked uploads.</p>
        ) : (
          <>
            <p className="detail" style={{ margin: 0 }}>
              Blocked images are never stored, so there&apos;s nothing to view
              here: just who tried, when and why. Accounts with repeated blocks
              have their uploads paused; review them under Users.
            </p>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Uploaded by</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {blocked.map((b) => (
                    <tr key={b.id}>
                      <td>
                        {new Date(b.created_at).toLocaleString("en-GB")}
                        <div className="detail">{b.original_name ?? b.id}</div>
                      </td>
                      <td>
                        {b.email ?? "Guest"}{" "}
                        <SourceTag
                          source={b.source === "api" ? "api" : "web"}
                        />
                        <div className="detail">{b.uploader_ip ?? ""}</div>
                      </td>
                      <td>
                        <Findings
                          labels={
                            b.moderation_labels ??
                            (b.fail_reason === "blocked_file" ||
                            b.fail_reason === "blocked_content"
                              ? ["blocked_file"]
                              : [])
                          }
                          scores={b.moderation_scores}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}

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
                        <Findings
                          labels={img.moderation_labels}
                          scores={img.moderation_scores}
                        />
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
