import Link from "next/link";
import { revokeApiKey } from "@/app/actions/account";
import { KeyCreator } from "@/components/KeyCreator";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query, queryOne } from "@/lib/db";
import { apiRateKey, planFor } from "@/lib/plans";
import { rateUsage } from "@/lib/ratelimit";

export const metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

type KeyRow = {
  id: string;
  name: string | null;
  key_prefix: string;
  created_at: Date;
  last_used_at: Date | null;
  uploads: string;
};

const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function KeysPage() {
  const user = await requireUser("/account/keys");
  const account = await queryOne<{ plan: string; role: string }>(`SELECT plan, role FROM users WHERE id = $1`, [user.id]);
  const plan = planFor(account ?? {});
  const keys = await query<KeyRow>(
    `SELECT k.id, k.name, k.key_prefix, k.created_at, k.last_used_at,
            (SELECT count(*) FROM images i WHERE i.api_key_id = k.id) AS uploads
       FROM api_keys k
      WHERE k.user_id = $1 AND k.revoked_at IS NULL
      ORDER BY k.created_at DESC`,
    [user.id],
  );
  const usage = await rateUsage(apiRateKey(user.id)).catch(() => ({ used: 0, resetIn: 0 }));
  const used = Math.min(usage.used, plan.apiUploadsPerHour);
  const pct = plan.apiUploadsPerHour ? Math.round((used / plan.apiUploadsPerHour) * 100) : 100;
  const atKeyLimit = keys.length >= plan.maxApiKeys;

  const limitNote = atKeyLimit
    ? plan.maxApiKeys === 1
      ? `The ${plan.label} plan includes 1 API key, and you're using it. Revoke it below to create a new one.`
      : `You're using all ${plan.maxApiKeys} API keys on the ${plan.label} plan. Revoke one to create another.`
    : null;

  return (
    <div className="stack-l">
      <div className="page-head" style={{ paddingBottom: 0 }}>
        <div>
          <h1>API keys</h1>
          <p>
            Upload from scripts, ShareX, WordPress or n8n. Images uploaded with a key appear in My images. See the{" "}
            <Link href="/api-docs">API docs</Link>.
          </p>
        </div>
      </div>

      <section className="panel plan-card" aria-label="Your plan">
        <div className="plan-head">
          <div>
            <span className="plan-badge">{plan.label} plan</span>
            <p className="detail" style={{ margin: "8px 0 0" }}>
              {plan.maxApiKeys} API key{plan.maxApiKeys === 1 ? "" : "s"} · {plan.apiUploadsPerHour.toLocaleString("en")} API
              uploads per hour, shared by all your keys
            </p>
          </div>
          {plan.id !== "business" && (
            <Link className="btn secondary small" href="/pricing">
              {plan.id === "free" ? "Need more? See plans" : "Compare plans"}
            </Link>
          )}
        </div>
        <div className="meters">
          <div className="meter">
            <div className="meter-label">
              <span>Uploads this hour</span>
              <strong>
                {used} of {plan.apiUploadsPerHour.toLocaleString("en")}
              </strong>
            </div>
            <div
              className={`meter-bar${pct >= 100 ? " full" : pct >= 80 ? " high" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={plan.apiUploadsPerHour}
              aria-valuenow={used}
              aria-label="API uploads this hour"
            >
              <span style={{ width: `${pct}%` }} />
            </div>
            {pct >= 100 && usage.resetIn > 0 && (
              <span className="meter-hint">Limit reached. More uploads free up in {Math.ceil(usage.resetIn / 60)} min.</span>
            )}
          </div>
          <div className="meter">
            <div className="meter-label">
              <span>API keys</span>
              <strong>
                {keys.length} of {plan.maxApiKeys}
              </strong>
            </div>
            <div className={`meter-bar${atKeyLimit ? " full-quiet" : ""}`} aria-hidden="true">
              <span style={{ width: `${Math.min(100, (keys.length / Math.max(1, plan.maxApiKeys)) * 100)}%` }} />
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Create a key</h2>
        <p className="detail">
          {plan.maxApiKeys === 1
            ? "Give the key the name of the app that will use it, so you'll recognise it later."
            : "Use one key per app, so you can revoke it without breaking the others."}
        </p>
        <KeyCreator siteUrl={config.siteUrl} limitNote={limitNote} />
      </section>

      <section className="stack">
        <h2 style={{ margin: 0, fontSize: 20 }}>Active keys</h2>
        {keys.length === 0 ? (
          <div className="panel empty" style={{ padding: 32 }}>
            <p>You don&apos;t have any keys yet.</p>
          </div>
        ) : (
          <div className="key-list">
            {keys.map((k) => (
              <div className="key-row" key={k.id}>
                <div style={{ minWidth: 0 }}>
                  <strong>{k.name || "Unnamed key"}</strong>
                  <code>{k.key_prefix}…</code>
                  <div className="detail">
                    Created {fmt(k.created_at)} · {k.last_used_at ? `last used ${fmt(k.last_used_at)}` : "never used"} ·{" "}
                    {k.uploads} upload{k.uploads === "1" ? "" : "s"}
                  </div>
                </div>
                <form action={revokeApiKey}>
                  <input type="hidden" name="id" value={k.id} />
                  <button type="submit" className="btn danger-quiet small">
                    Revoke
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
