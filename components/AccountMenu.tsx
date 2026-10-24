"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { IconChevron } from "./Icons";

export function AccountMenu({
  name,
  email,
  isAdmin,
}: {
  name: string;
  email: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) =>
      !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="menu-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="menu-name">{name}</span>
        <IconChevron size={16} />
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          <div className="menu-who">
            <strong>{name}</strong>
            <span>{email}</span>
          </div>
          <Link role="menuitem" href="/" onClick={() => setOpen(false)}>
            Upload
          </Link>
          <Link role="menuitem" href="/account" onClick={() => setOpen(false)}>
            My images
          </Link>
          <Link
            role="menuitem"
            href="/account/keys"
            onClick={() => setOpen(false)}
          >
            API keys
          </Link>
          <Link
            role="menuitem"
            href="/account/settings"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <Link
            role="menuitem"
            href="/account/billing"
            onClick={() => setOpen(false)}
          >
            Billing
          </Link>
          <Link role="menuitem" href="/pricing" onClick={() => setOpen(false)}>
            Plans and pricing
          </Link>
          {isAdmin && (
            <Link role="menuitem" href="/admin" onClick={() => setOpen(false)}>
              Moderation
            </Link>
          )}
          <form action={signOut}>
            <button type="submit" role="menuitem">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
