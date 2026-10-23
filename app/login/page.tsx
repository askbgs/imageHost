import { redirect } from "next/navigation";
import { SignInForm } from "@/components/AuthForms";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: raw } = await searchParams;
  const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  if (await currentUser()) redirect(next);

  return (
    <div className="auth">
      <section className="frame">
        <span className="marks" aria-hidden="true" />
        <h1>Sign in</h1>
        <p className="sub">Welcome back to {config.siteName}.</p>
        <SignInForm next={next} allowSignup={config.allowSignup} />
      </section>
    </div>
  );
}
