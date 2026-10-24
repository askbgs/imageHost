"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changePlan } from "@/app/actions/billing";
import { useConfirm } from "./ConfirmDialog";
import { CurrencySelect, useCurrency } from "./Currency";
import { IconCheck } from "./Icons";
import { usePaddleCheckout, type PaddleSetup } from "./PaddleCheckout";
import { useToast } from "./Toast";

type Prices = { month?: string; year?: string };

export type PriceCard = {
  id: string;
  label: string;
  tagline: string;
  /** Monthly price in the base price currency; null = custom. */
  price: number | null;
  /** Yearly price; null = not offered yearly; undefined = 10 × monthly. */
  yearPrice?: number | null;
  features: string[];
  recommended?: boolean;
  current?: boolean;
  cta: {
    label: string;
    tone: "primary" | "secondary";
    href?: string;
    disabled?: boolean;
    /** Opens Paddle checkout for the price matching the chosen billing period. */
    checkout?: Prices;
    /** Changes the existing subscription to this plan. */
    switchTo?: { plan: string; prices: Prices };
  };
};

export function PricingCards({
  cards,
  paddle,
  currentPriceId,
  yearlyNote,
}: {
  cards: PriceCard[];
  /** Set when online checkout is available for the signed-in user. */
  paddle?: PaddleSetup | null;
  /** The price of the user's live subscription, if any. */
  currentPriceId?: string | null;
  /** E.g. "2 months free"; null hides the yearly option. */
  yearlyNote: string | null;
}) {
  const [yearly, setYearly] = useState(false);
  const { currency, convert, number } = useCurrency();
  const checkout = usePaddleCheckout(paddle ?? null);
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const interval = yearly ? "year" : "month";
  const pick = (p: Prices) => (yearly ? p.year || p.month : p.month || p.year);

  async function onSwitch(c: PriceCard, priceId: string) {
    const target = c.cta.switchTo!;
    const toInterval = target.prices.year === priceId ? "year" : "month";
    const samePlan = c.current;
    const ok = await confirm({
      title: samePlan
        ? `Switch to ${toInterval === "year" ? "yearly" : "monthly"} billing?`
        : `Switch to ${c.label}?`,
      message:
        "The change happens straight away. Paddle charges the difference for the rest of this billing period to your saved payment method, or credits it if the new plan costs less.",
      confirmLabel: samePlan ? "Switch billing" : `Switch to ${c.label}`,
    });
    if (!ok) return;
    setBusy(c.id);
    start(async () => {
      const res = await changePlan(target.plan, toInterval);
      setBusy(null);
      if (res.error) toast(res.error, "error");
      else {
        toast(res.ok ?? "Plan changed");
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="pricing-controls">
        {yearlyNote !== null && (
          <div
            className="billing-toggle segmented"
            role="group"
            aria-label="Billing period"
          >
            <button
              type="button"
              aria-pressed={!yearly}
              onClick={() => setYearly(false)}
            >
              Monthly
            </button>
            <button
              type="button"
              aria-pressed={yearly}
              onClick={() => setYearly(true)}
            >
              Yearly{" "}
              {yearlyNote && <span className="save-pill">{yearlyNote}</span>}
            </button>
          </div>
        )}
        <CurrencySelect />
      </div>

      {checkout.error && (
        <p
          className="alert error"
          role="alert"
          style={{ maxWidth: 640, margin: "0 auto 20px" }}
        >
          {checkout.error}
        </p>
      )}

      <div className="price-grid">
        {cards.map((c) => {
          const yearAmount =
            c.price === null
              ? null
              : c.yearPrice === undefined
                ? c.price * 10
                : c.yearPrice;
          const showYear = yearly && yearAmount !== null && c.price !== 0;
          const amount =
            c.price === null ? null : showYear ? yearAmount! : c.price;

          let note: string;
          if (c.price === null)
            note = "Volume limits, invoicing and support to fit your team.";
          else if (c.price === 0) note = "No card needed.";
          else if (yearly && yearAmount === null) note = "Billed monthly only";
          else if (showYear)
            note = `${currency} ${number(convert(yearAmount! / 12))} a month, billed yearly`;
          else if (yearAmount !== null)
            note = `or ${currency} ${number(convert(yearAmount))} a year`;
          else note = "Billed monthly";

          return (
            <section
              key={c.id}
              className={`price-card${c.recommended ? " recommended" : ""}${c.current ? " current" : ""}`}
              aria-labelledby={`plan-${c.id}`}
            >
              {c.recommended && <span className="price-flag">Recommended</span>}
              {c.current && (
                <span className="price-flag current-flag">Your plan</span>
              )}
              <h2 id={`plan-${c.id}`}>{c.label}</h2>
              <p className="price-tagline">{c.tagline}</p>
              <div className="price-amount">
                {amount === null ? (
                  <span className="price-num">Custom</span>
                ) : (
                  <>
                    <span className="price-cur">{currency}</span>
                    <span className="price-num">
                      {amount === 0 ? "0" : number(convert(amount))}
                    </span>
                    <span className="price-per">
                      {amount === 0
                        ? "forever"
                        : `/ ${showYear ? "year" : "month"}`}
                    </span>
                  </>
                )}
              </div>
              <p className="price-note">{note}</p>
              <Cta
                card={c}
                interval={interval}
                priceId={
                  c.cta.checkout
                    ? pick(c.cta.checkout)
                    : c.cta.switchTo
                      ? pick(c.cta.switchTo.prices)
                      : undefined
                }
                currentPriceId={currentPriceId}
                busy={(busy === c.id && pending) || checkout.opening}
                onCheckout={(id) => checkout.open(id)}
                onSwitch={(id) => onSwitch(c, id)}
              />
              <ul className="price-features">
                {c.features.map((f) => (
                  <li key={f}>
                    <IconCheck size={16} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Cta({
  card,
  interval,
  priceId,
  currentPriceId,
  busy,
  onCheckout,
  onSwitch,
}: {
  card: PriceCard;
  interval: "month" | "year";
  priceId?: string;
  currentPriceId?: string | null;
  busy: boolean;
  onCheckout: (priceId: string) => void;
  onSwitch: (priceId: string) => void;
}) {
  const { cta } = card;
  const cls = `btn block ${cta.tone}`;
  const disabled = (label: string) => (
    <span className={`btn block ${cta.tone} is-disabled`} aria-disabled="true">
      {label}
    </span>
  );

  if (cta.checkout && priceId) {
    return (
      <button
        type="button"
        className={cls}
        onClick={() => onCheckout(priceId)}
        disabled={busy}
      >
        {cta.label}
      </button>
    );
  }
  if (cta.switchTo && priceId) {
    if (priceId === currentPriceId) return disabled("Your current plan");
    const label = card.current
      ? `Switch to ${interval === "year" ? "yearly" : "monthly"} billing`
      : cta.label;
    return (
      <button
        type="button"
        className={cls}
        onClick={() => onSwitch(priceId)}
        disabled={busy}
      >
        {busy ? "Switching…" : label}
      </button>
    );
  }
  if (cta.disabled || !cta.href) return disabled(cta.label);
  if (cta.href.startsWith("/")) {
    return (
      <Link className={cls} href={cta.href}>
        {cta.label}
      </Link>
    );
  }
  return (
    <a className={cls} href={cta.href}>
      {cta.label}
    </a>
  );
}
