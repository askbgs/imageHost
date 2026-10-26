import Link from "next/link";
import { ForgotPasswordForm } from "@/components/AuthForms";
import { config } from "@/lib/config";
import { mailEnabled } from "@/lib/mail";

export const metadata = { title: "Forgot password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <div className="auth">
      <section className="frame">
        <span className="marks" aria-hidden="true" />
        <h1>Forgot your password?</h1>
        {mailEnabled() ? (
          <>
            <p className="sub">
              Enter the email address you signed up with and we&apos;ll send you
              a link to choose a new one.
            </p>
            <ForgotPasswordForm />
          </>
        ) : (
          <>
            <p className="sub">
              Password reset by email isn&apos;t available right now.{" "}
              <Link href="/contact?topic=account">Contact us</Link> or email{" "}
              <a href={`mailto:${config.contactEmail}`}>
                {config.contactEmail}
              </a>{" "}
              from your account&apos;s address and we&apos;ll help.
            </p>
            <p className="switch">
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
