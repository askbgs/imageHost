"use client";

import { useCallback, useEffect, useState } from "react";

export type PaddleSetup = {
  token: string;
  environment: "sandbox" | "production";
  email: string;
  customerId: string | null;
  userId: string;
  successUrl: string;
};

type PaddleGlobal = {
  Environment: { set: (env: string) => void };
  Initialize: (opts: {
    token: string;
    eventCallback?: (e: { name?: string; data?: unknown }) => void;
  }) => void;
  Checkout: { open: (opts: Record<string, unknown>) => void };
};

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
    __ppxPaddleReady?: Promise<PaddleGlobal>;
  }
}

const SCRIPT = "https://cdn.paddle.com/paddle/v2/paddle.js";

/** Loads Paddle.js once per page and initialises it (Paddle.Initialize may only run once). */
function loadPaddle(
  setup: PaddleSetup,
  onEvent: (name: string) => void,
): Promise<PaddleGlobal> {
  if (window.__ppxPaddleReady) return window.__ppxPaddleReady;
  window.__ppxPaddleReady = new Promise<PaddleGlobal>((resolve, reject) => {
    const init = () => {
      const P = window.Paddle;
      if (!P) return reject(new Error("Paddle.js didn't load"));
      if (setup.environment === "sandbox") P.Environment.set("sandbox");
      P.Initialize({
        token: setup.token,
        eventCallback: (e) => e?.name && onEvent(e.name),
      });
      resolve(P);
    };
    if (window.Paddle) return init();
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = init;
    s.onerror = () => {
      window.__ppxPaddleReady = undefined;
      reject(
        new Error(
          "Couldn't load the checkout. Check your connection or turn off content blockers, then try again.",
        ),
      );
    };
    document.head.appendChild(s);
  });
  return window.__ppxPaddleReady;
}

/**
 * Opens Paddle's overlay checkout for one price. The account id travels as custom data,
 * so the webhook knows whose plan to upgrade.
 */
export function usePaddleCheckout(setup: PaddleSetup | null) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Warm up the script so the first click opens quickly.
  useEffect(() => {
    if (setup) loadPaddle(setup, () => {}).catch(() => {});
  }, [setup]);

  const open = useCallback(
    async (priceId: string) => {
      if (!setup) return;
      setOpening(true);
      setError(null);
      try {
        const P = await loadPaddle(setup, () => {});
        const dark = window.matchMedia?.(
          "(prefers-color-scheme: dark)",
        ).matches;
        P.Checkout.open({
          items: [{ priceId, quantity: 1 }],
          customer: setup.customerId
            ? { id: setup.customerId }
            : { email: setup.email },
          customData: { user_id: setup.userId },
          settings: {
            displayMode: "overlay",
            theme: dark ? "dark" : "light",
            successUrl: setup.successUrl,
            allowLogout: false,
          },
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't open the checkout.",
        );
      } finally {
        setOpening(false);
      }
    },
    [setup],
  );

  return { open, opening, error };
}
