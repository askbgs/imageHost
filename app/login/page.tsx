import { redirect } from "next/navigation";
import { SignInForm } from "@/components/AuthForms";
import { SocialButtons } from "@/components/SocialButtons";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { enabledProviders, safeNext } from "@/lib/oauth";
import { oauthMessage } from "@/lib/oauth-messages";

export const metadata = { title: "Sign in" };

type Props = { searchParams: Promise<{ next?: string; error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next: raw, error } = await searchParams;
  const next = safeNext(raw);
  if (await currentUser()) redirect(next);
  const message = oauthMessage(error);

  return (
    <div className="auth">
      <section className="frame">
        <span className="marks" aria-hidden="true" />
        <h1>Sign in</h1>
        <p className="sub">Welcome back to {config.siteName}.</p>
        {message && (
          <div className="alert error" role="alert">
            {message}
          </div>
        )}
        <SocialButtons providers={enabledProviders()} next={next} />
        <SignInForm next={next} allowSignup={config.allowSignup} />
      </section>
    </div>
  );
}
