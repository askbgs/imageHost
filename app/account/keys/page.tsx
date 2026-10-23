import Link from "next/link";
import { revokeApiKey } from "@/app/actions/account";
import { KeyCreator } from "@/components/KeyCreator";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query } from "@/lib/db";

export const metadata = { title: "API keys" };

type KeyRow = {
  id: string;
  name: string | null;
  key_prefix: string;
  rate_limit: number;
  created_at: Date;
  last_used_at: Date | null;
  uploads: string;
};

const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function KeysPage() {
  const user = await requireUser("/account/keys");
  const keys = await query<KeyRow>(
    `SELECT k.id, k.name, k.key_prefix, k.rate_limit, k.created_at, k.last_used_at,
            (SELECT count(*) FROM images i WHERE i.api_key_id = k.id) AS uploads
       FROM api_keys k
      WHERE k.user_id = $1 AND k.revoked_at IS NULL
      ORDER BY k.created_at DESC`,
    [user.id],
  );

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

      <section className="panel">
        <h2>Create a key</h2>
        <p className="detail">Use one key per app, so you can revoke it without breaking the others.</p>
        <KeyCreator siteUrl={config.siteUrl} />
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
                    {k.uploads} upload{k.uploads === "1" ? "" : "s"} · up to {k.rate_limit} per hour
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
