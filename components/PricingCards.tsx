"use client";

import Link from "next/link";
import { useState } from "react";
import { CurrencySelect, useCurrency } from "./Currency";
import { IconCheck } from "./Icons";

export type PriceCard = {
  id: string;
  label: string;
  tagline: string;
  /** Monthly price in the base price currency; null = custom. */
  price: number | null;
  features: string[];
  recommended?: boolean;
  cta: {
    label: string;
    href?: string;
    disabled?: boolean;
    tone: "primary" | "secondary";
  };
  current?: boolean;
};

export function PricingCards({ cards }: { cards: PriceCard[] }) {
  const [yearly, setYearly] = useState(false);
  const { currency, convert, number } = useCurrency();

  return (
    <>
      <div className="pricing-controls">
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
            Yearly <span className="save-pill">2 months free</span>
          </button>
        </div>
        <CurrencySelect />
      </div>

      <div className="price-grid">
        {cards.map((c) => (
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
              {c.price === null ? (
                <span className="price-num">Custom</span>
              ) : c.price === 0 ? (
                <>
                  <span className="price-cur">{currency}</span>
                  <span className="price-num">0</span>
                  <span className="price-per">forever</span>
                </>
              ) : (
                <>
                  <span className="price-cur">{currency}</span>
                  <span className="price-num">
                    {number(convert(yearly ? c.price * 10 : c.price))}
                  </span>
                  <span className="price-per">
                    / {yearly ? "year" : "month"}
                  </span>
                </>
              )}
            </div>
            <p className="price-note">
              {c.price === null
                ? "Volume limits, invoicing and support to fit your team."
                : c.price === 0
                  ? "No card needed."
                  : yearly
                    ? `${currency} ${number(convert((c.price * 10) / 12))} a month, billed yearly`
                    : `or ${currency} ${number(convert(c.price * 10))} a year`}
            </p>
            {c.cta.disabled || !c.cta.href ? (
              <span
                className={`btn block ${c.cta.tone} is-disabled`}
                aria-disabled="true"
              >
                {c.cta.label}
              </span>
            ) : c.cta.href.startsWith("/") ? (
              <Link className={`btn block ${c.cta.tone}`} href={c.cta.href}>
                {c.cta.label}
              </Link>
            ) : (
              <a className={`btn block ${c.cta.tone}`} href={c.cta.href}>
                {c.cta.label}
              </a>
            )}
            <ul className="price-features">
              {c.features.map((f) => (
                <li key={f}>
                  <IconCheck size={16} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
