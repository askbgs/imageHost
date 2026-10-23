import { signOutEverywhere } from "@/app/actions/auth";
import { PasswordForm, ProfileForm } from "@/components/SettingsForms";
import { requireUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser("/account/settings");
  const sessions = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND expires_at > now()`,
    [user.id],
  );
  const n = Number(sessions?.n ?? 1);

  return (
    <div className="stack-l" style={{ maxWidth: 640 }}>
      <div className="page-head" style={{ paddingBottom: 0 }}>
        <div>
          <h1>Settings</h1>
          <p>Member since {new Date(user.created_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}.</p>
        </div>
      </div>

      <section className="panel">
        <h2>Profile</h2>
        <p className="detail">Your name is only shown to you.</p>
        <ProfileForm name={user.display_name ?? ""} email={user.email} />
      </section>

      <section className="panel">
        <h2>Password</h2>
        <p className="detail">Use a password you don&apos;t use anywhere else.</p>
        <PasswordForm />
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
    </div>
  );
}
