"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();
  const items = signedIn
    ? [
        { href: "/", label: "Upload" },
        { href: "/account", label: "My images" },
        { href: "/account/keys", label: "API keys" },
        { href: "/account/settings", label: "Settings" },
      ]
    : [{ href: "/api-docs", label: "API docs" }];

  return (
    <nav className="site-nav" aria-label="Main">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path === i.href ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
