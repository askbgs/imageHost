"use client";

import { useActionState, useEffect, useRef } from "react";
import { createApiKey, type KeyState } from "@/app/actions/account";
import { IconCopy } from "./Icons";
import { useCopy } from "./Toast";

export function KeyCreator({ siteUrl, limitNote }: { siteUrl: string; limitNote: string | null }) {
  const [state, action, pending] = useActionState<KeyState, FormData>(createApiKey, {});
  const copy = useCopy();
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.key) form.current?.reset();
  }, [state.key]);

  return (
    <div className="stack">
      {state.key && (
        <div className="key-reveal" role="status">
          <strong>Your new key for “{state.name}”</strong>
          <span className="detail">Copy it now. For your security it won&apos;t be shown again.</span>
          <div className="code-field">
            <input type="text" readOnly value={state.key} aria-label="New API key" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn primary small" onClick={() => copy(state.key!, "API key")}>
              <IconCopy size={15} /> Copy key
            </button>
          </div>
          <span className="detail">Try it:</span>
          <div className="code-field">
            <input
              type="text"
              readOnly
              aria-label="Example command"
              value={`curl -X POST "${siteUrl}/1/upload?key=${state.key}" -F "image=@photo.jpg"`}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        </div>
      )}
      {limitNote ? (
        <div className="limit-note">{limitNote}</div>
      ) : (
      <form ref={form} action={action} className="key-form">
        <div className="field">
          <label htmlFor="key-name">Key name</label>
          <input id="key-name" name="name" type="text" placeholder="For example: ShareX on my laptop" maxLength={60} required />
        </div>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>
      )}
      {state.error && <div className="alert error">{state.error}</div>}
    </div>
  );
}
