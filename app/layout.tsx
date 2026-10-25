import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { LogoMark } from "@/components/Icons";
import { NavLinks } from "@/components/NavLinks";
import { ToastProvider } from "@/components/Toast";
import { currentUser, displayName } from "@/lib/auth";
import { config } from "@/lib/config";
import "./globals.css";

// Read SITE_NAME, SITE_URL and limits at request time, not at build time.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(config.siteUrl),
    title: { default: `${config.siteName}: image hosting with direct links`, template: `%s · ${config.siteName}` },
    description: `Upload images and get direct links, HTML and BBCode embeds. Up to ${config.maxUploadBytes / 1024 / 1024} MB per image.`,
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9edf0" },
    { media: "(prefers-color-scheme: dark)", color: "#121619" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Instrument+Sans:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <ToastProvider>
          <ConfirmProvider>
          <a href="#main" className="skip">
            Skip to content
          </a>
          <header className="site-header">
            <div className="wrap header-row">
              <Link href="/" className="wordmark" aria-label={`${config.siteName} home`}>
                <LogoMark />
                <span>{config.siteName}</span>
              </Link>
              <NavLinks signedIn={!!user} />
              <div className="header-account">
                {user ? (
                  <AccountMenu name={displayName(user)} email={user.email} isAdmin={user.role === "admin"} />
                ) : (
                  <>
                    <Link href="/login" className="btn ghost">
                      Sign in
                    </Link>
                    {config.allowSignup && (
                      <Link href="/signup" className="btn">
                        Create account
                      </Link>
                    )}
                  </>
                )}
              </div>
            </div>
          </header>
          <main id="main" className="wrap">
            {children}
          </main>
          <footer className="site-footer">
            <div className="wrap footer-row">
              <span className="footer-brand">
                <LogoMark size={16} /> {config.siteName}
              </span>
              <Link href="/pricing">Pricing</Link>
              <Link href="/api-docs">API</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/refunds">Refunds</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/abuse">Report abuse</Link>
            </div>
          </footer>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
