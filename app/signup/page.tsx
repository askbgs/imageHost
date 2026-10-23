import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/AuthForms";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";

export const metadata = { title: "Create an account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: raw } = await searchParams;
  const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  if (await currentUser()) redirect(next);

  return (
    <div className="auth">
      <section className="frame">
        <span className="marks" aria-hidden="true" />
        <h1>Create your account</h1>
        {config.allowSignup ? (
          <>
            <p className="sub">Upload images, keep them organised, and get API keys.</p>
            <SignUpForm next={next} />
          </>
        ) : (
          <>
            <p className="sub">New sign-ups are closed right now.</p>
            <Link href="/login" className="btn secondary">
              Sign in instead
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
