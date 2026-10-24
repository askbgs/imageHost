"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Currency = { code: string; name: string };

type Ctx = {
  currency: string;
  base: string;
  setCurrency: (code: string) => void;
  currencies: Currency[];
  /** Converts an amount in the base currency into the chosen currency. */
  convert: (amount: number) => number;
  /** Formats an amount that's already in the chosen currency, without the code. */
  number: (amount: number) => string;
  /** Converts and formats, e.g. "USD 2.98". */
  money: (amountInBase: number) => string;
};

const CurrencyContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "ppx-currency";
const WHOLE = new Set(["JPY", "INR", "LKR"]); // shown without decimals

export function CurrencyProvider({
  children,
  initial,
  base,
  rates,
  currencies,
}: {
  children: ReactNode;
  /** From ?currency=, if given; otherwise USD until the visitor's saved choice is read. */
  initial: string;
  base: string;
  /** Units per 1 USD for every listed currency. */
  rates: Record<string, number>;
  currencies: Currency[];
}) {
  const [currency, setState] = useState(initial);

  // Restore the visitor's last choice, unless the link named a currency.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("currency")) return;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && rates[saved]) setState(saved);
    } catch {
      /* storage unavailable */
    }
  }, [rates]);

  const setCurrency = useCallback(
    (code: string) => {
      if (!rates[code]) return;
      setState(code);
      try {
        window.localStorage.setItem(STORAGE_KEY, code);
      } catch {
        /* storage unavailable */
      }
      const url = new URL(window.location.href);
      url.searchParams.set("currency", code);
      window.history.replaceState(window.history.state, "", url);
    },
    [rates],
  );

  const value = useMemo<Ctx>(() => {
    const convert = (amount: number) =>
      currency === base
        ? amount
        : (amount / (rates[base] || 1)) * (rates[currency] || 1);
    const whole = WHOLE.has(currency);
    const fmt = new Intl.NumberFormat("en", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    });
    const number = (amount: number) =>
      amount === 0 ? "0" : fmt.format(amount);
    return {
      currency,
      base,
      setCurrency,
      currencies,
      convert,
      number,
      money: (amount: number) => `${currency} ${number(convert(amount))}`,
    };
  }, [currency, base, rates, currencies, setCurrency]);

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used inside CurrencyProvider");
  return ctx;
}

export function CurrencySelect() {
  const { currency, setCurrency, currencies } = useCurrency();
  return (
    <label className="currency-select">
      <span>Currency</span>
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        aria-label="Show prices in"
      >
        {currencies.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} · {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A monthly plan price in the chosen currency, for tables. */
export function Money({
  amount,
  free = "Free",
}: {
  amount: number;
  free?: string;
}) {
  const { money } = useCurrency();
  return <>{amount ? money(amount) : free}</>;
}

/** Explains where converted prices come from. Shown under the pricing table. */
export function FxNote({
  updated,
  fallback,
}: {
  updated: string;
  fallback: boolean;
}) {
  const { currency, base, currencies } = useCurrency();
  const baseName = currencies.find((c) => c.code === base)?.name ?? base;
  if (currency === base) {
    return (
      <>
        Prices in {baseName}s ({base}).
      </>
    );
  }
  return (
    <>
      Prices are set in {baseName}s ({base}) and shown in {currency} at{" "}
      {fallback
        ? "an approximate exchange rate"
        : `the exchange rate of ${updated}`}
      , so the amount you pay may differ slightly.{" "}
      <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">
        Rates By Exchange Rate API
      </a>
      .
    </>
  );
}
