import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/AuthForms";
import { findReset, RESET_MINUTES } from "@/lib/password-reset";

// The token is in the URL: keep it out of search engines and out of Referer headers.
export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const target = await findReset(token);

  return (
    <div className="auth">
      <section className="frame">
        <span className="marks" aria-hidden="true" />
        {target ? (
          <>
            <h1>Choose a new password</h1>
            <p className="sub">
              For <strong>{target.email}</strong>. You&apos;ll be signed out on
              other devices.
            </p>
            <ResetPasswordForm token={token} email={target.email} />
          </>
        ) : (
          <>
            <h1>This link has expired</h1>
            <p className="sub">
              Reset links work once and expire after {RESET_MINUTES} minutes. If you asked more
              than once, only the newest link works.
            </p>
            <Link className="btn primary block" href="/forgot-password">
              Get a new link
            </Link>
            <p className="switch">
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
