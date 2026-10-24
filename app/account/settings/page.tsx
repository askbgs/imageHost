import { disconnectProvider, signOutEverywhere } from "@/app/actions/auth";
import { DeleteAccountForm, PasswordForm, ProfileForm } from "@/components/SettingsForms";
import { requireUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { PROVIDER_IDS, enabledProviders, providerLabel } from "@/lib/oauth";
import { oauthMessage } from "@/lib/oauth-messages";
import { signInMethods } from "@/lib/social";

export const metadata = { title: "Settings" };

type Props = { searchParams: Promise<{ error?: string; connected?: string; disconnected?: string }> };

export default async function SettingsPage({ searchParams }: Props) {
  const user = await requireUser("/account/settings");
  const { error, connected, disconnected } = await searchParams;
  const sessions = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND expires_at > now()`,
    [user.id],
  );
  const n = Number(sessions?.n ?? 1);
  const methods = await signInMethods(user.id);
  const enabled = new Set(enabledProviders().map((p) => p.id as string));
  const linked = new Map(methods.providers.map((p) => [p.provider, p]));
  // Show every provider that is enabled, plus any already connected (even if since disabled).
  const rows = PROVIDER_IDS.filter((id) => enabled.has(id) || linked.has(id));
  const canDisconnect = methods.hasPassword || methods.providers.length > 1;
  const errorText = oauthMessage(error);
  const known = (v?: string) => (v && (PROVIDER_IDS as string[]).includes(v) ? v : null);
  const notice = known(connected)
    ? `${providerLabel(connected!)} is connected. You can use it to sign in.`
    : known(disconnected)
      ? `${providerLabel(disconnected!)} was disconnected.`
      : null;

  return (
    <div className="stack-l" style={{ maxWidth: 640 }}>
      <div className="page-head" style={{ paddingBottom: 0 }}>
        <div>
          <h1>Settings</h1>
          <p>Member since {new Date(user.created_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}.</p>
        </div>
      </div>

      {errorText && (
        <div className="alert error" role="alert">
          {errorText}
        </div>
      )}
      {notice && (
        <div className="alert ok" role="status">
          {notice}
        </div>
      )}

      <section className="panel">
        <h2>Profile</h2>
        <p className="detail">Your name is only shown to you.</p>
        <ProfileForm name={user.display_name ?? ""} email={user.email} />
      </section>

      {rows.length > 0 && (
        <section className="panel">
          <h2>Sign-in methods</h2>
          <p className="detail">Connect accounts so you can sign in with one click.</p>
          <div className="methods">
            <div className="method">
              <span className="social-mark" aria-hidden="true" style={{ background: "var(--accent)" }}>
                @
              </span>
              <div className="who">
                <strong>Email and password</strong>
                <span>{methods.hasPassword ? user.email : "Not set up. Set a password below."}</span>
              </div>
            </div>
            {rows.map((id) => {
              const link = linked.get(id);
              return (
                <div className={`method social-${id}`} key={id}>
                  <span className="social-mark" aria-hidden="true">
                    {id === "github" ? "GH" : id === "google" ? "G" : "f"}
                  </span>
                  <div className="who">
                    <strong>{providerLabel(id)}</strong>
                    <span>{link ? `Connected${link.email ? ` as ${link.email}` : ""}` : "Not connected"}</span>
                  </div>
                  {link ? (
                    <form action={disconnectProvider}>
                      <input type="hidden" name="provider" value={id} />
                      <button
                        type="submit"
                        className="btn danger-quiet small"
                        disabled={!canDisconnect}
                        title={canDisconnect ? undefined : "Set a password or connect another provider first"}
                      >
                        Disconnect
                      </button>
                    </form>
                  ) : enabled.has(id) ? (
                    <a className="btn secondary small" href={`/auth/${id}?mode=link`}>
                      Connect
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Password</h2>
        <p className="detail">
          {methods.hasPassword
            ? "Use a password you don't use anywhere else."
            : "You signed up with a provider. Set a password to also sign in with your email."}
        </p>
        <PasswordForm hasPassword={methods.hasPassword} />
      </section>

      <section className="panel">
        <h2>Signed-in devices</h2>
        <p className="detail">
          You&apos;re signed in on {n} device{n === 1 ? "" : "s"}. Sign out everywhere if you lost one or used a shared computer.
        </p>
        <form action={signOutEverywhere}>
          <button type="submit" className="btn secondary">
            Sign out everywhere
          </button>
        </form>
      </section>

      <section className="panel" id="delete">
        <h2>Delete account</h2>
        <p className="detail">
          Permanently deletes your account, all your images and their links, your API keys and connected sign-in
          methods. This can&apos;t be undone.
        </p>
        <DeleteAccountForm email={user.email} />
      </section>
    </div>
  );
}
