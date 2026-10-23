import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/lib/config";
import "./globals.css";

// Read SITE_NAME, SITE_URL and limits at request time, not at build time.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(config.siteUrl),
    title: { default: `${config.siteName} · Free image hosting`, template: `%s · ${config.siteName}` },
    description: `Upload images and get direct links, HTML and BBCode embeds. Up to ${config.maxUploadBytes / 1024 / 1024} MB per image.`,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Instrument+Sans:wght@400;600&display=swap"
        />
      </head>
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="wordmark">
              {config.siteName}
            </Link>
            <nav className="site-nav" aria-label="Main">
              <Link href="/api-docs">API</Link>
              <Link href="/terms">Terms</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site-footer">
          <div className="wrap">
            <span>{config.siteName}</span>
            <Link href="/terms">Terms of service</Link>
            <Link href="/abuse">Report abuse</Link>
            <Link href="/api-docs">API</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
