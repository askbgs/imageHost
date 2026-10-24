"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { IconTrash } from "./Icons";

type Options = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  /** Up to a few thumbnails shown in the dialog, so people see exactly what they're deleting. */
  previews?: string[];
  previewCount?: number;
};

type Pending = Options & { resolve: (ok: boolean) => void };

const Ctx = createContext<(o: Options) => Promise<boolean>>(async () => false);

/** `const confirm = useConfirm(); if (await confirm({...})) …` */
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  const ask = useCallback(
    (o: Options) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })),
    [],
  );

  useEffect(() => {
    const d = dialog.current;
    if (!d || !pending) return;
    if (!d.open) d.showModal();
    // Focus the safe choice for destructive actions.
    (pending.tone === "danger" ? (d.querySelector("[data-cancel]") as HTMLElement) : confirmBtn.current)?.focus();
  }, [pending]);

  function close(ok: boolean) {
    pending?.resolve(ok);
    dialog.current?.close();
    setPending(null);
  }

  const extra = pending?.previewCount && pending.previews ? pending.previewCount - pending.previews.length : 0;

  return (
    <Ctx.Provider value={ask}>
      {children}
      <dialog
        ref={dialog}
        className="confirm"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onCancel={(e) => {
          e.preventDefault();
          close(false);
        }}
        onClick={(e) => e.target === dialog.current && close(false)}
      >
        {pending && (
          <div className="confirm-body">
            {pending.tone === "danger" && (
              <span className="confirm-icon" aria-hidden="true">
                <IconTrash size={22} />
              </span>
            )}
            <h2 id="confirm-title">{pending.title}</h2>
            <p id="confirm-message">{pending.message}</p>
            {pending.previews && pending.previews.length > 0 && (
              <div className="confirm-previews" aria-hidden="true">
                {pending.previews.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={src} src={src} alt="" className="checker" />
                ))}
                {extra > 0 && <span className="confirm-more">+{extra}</span>}
              </div>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn secondary" data-cancel onClick={() => close(false)}>
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={confirmBtn}
                type="button"
                className={`btn ${pending.tone === "danger" ? "danger" : "primary"}`}
                onClick={() => close(true)}
              >
                {pending.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </Ctx.Provider>
  );
}
