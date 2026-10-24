"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  cancelSubscription,
  keepSubscription,
  openBillingPortal,
  type BillingResult,
} from "@/app/actions/billing";
import { useConfirm } from "./ConfirmDialog";
import { useToast } from "./Toast";

export function BillingActions({
  hasSubscription,
  hasCustomer,
  cancelScheduled,
  endsOn,
  pastDue,
}: {
  hasSubscription: boolean;
  hasCustomer: boolean;
  cancelScheduled: boolean;
  endsOn: string | null;
  pastDue: boolean;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<string | null>(null);

  const run = (
    name: string,
    action: () => Promise<BillingResult | undefined>,
  ) => {
    setWhich(name);
    start(async () => {
      const res = await action();
      setWhich(null);
      if (res?.error) toast(res.error, "error");
      else if (res?.ok) {
        toast(res.ok);
        router.refresh();
      }
    });
  };

  async function onCancel() {
    const ok = await confirm({
      title: "Cancel your subscription?",
      message: `You won't be charged again. You keep your plan${endsOn ? ` until ${endsOn}` : " until the end of the period you've paid for"}, then your account moves to Free. Your images stay, and you can subscribe again at any time.`,
      confirmLabel: "Cancel subscription",
      cancelLabel: "Keep my plan",
      tone: "danger",
    });
    if (ok) run("cancel", cancelSubscription);
  }

  return (
    <div className="billing-actions">
      {hasCustomer && (
        <button
          type="button"
          className={`btn ${pastDue ? "primary" : "secondary"}`}
          disabled={pending}
          onClick={() => run("portal", openBillingPortal)}
        >
          {which === "portal"
            ? "Opening…"
            : pastDue
              ? "Update payment method"
              : "Payment method and invoices"}
        </button>
      )}
      <Link className="btn secondary" href="/pricing">
        {hasSubscription ? "Change plan" : "See plans"}
      </Link>
      {hasSubscription &&
        (cancelScheduled ? (
          <button
            type="button"
            className="btn primary"
            disabled={pending}
            onClick={() => run("keep", keepSubscription)}
          >
            {which === "keep" ? "Restarting…" : "Keep my subscription"}
          </button>
        ) : (
          <button
            type="button"
            className="btn danger-quiet"
            disabled={pending}
            onClick={onCancel}
          >
            {which === "cancel" ? "Cancelling…" : "Cancel subscription"}
          </button>
        ))}
    </div>
  );
}

/** After checkout, Paddle's webhook usually lands within seconds; refresh until the plan shows up. */
export function WaitForPlan() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 20) return;
    const t = setTimeout(() => {
      router.refresh();
      setTries((n) => n + 1);
    }, 2500);
    return () => clearTimeout(t);
  }, [tries, router]);
  return (
    <div className="alert ok" role="status">
      {tries < 20
        ? "Thanks for upgrading! We're confirming your payment with Paddle. This page updates by itself in a few seconds."
        : "Your payment is still being confirmed. You'll get an email receipt from Paddle; refresh this page in a minute."}
    </div>
  );
}
