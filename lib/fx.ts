/**
 * Exchange rates for showing prices in the visitor's currency.
 *
 * Rates come from open.er-api.com (free, no key, refreshed once a day). Its terms require the
 * "Rates By Exchange Rate API" attribution wherever converted prices are shown; the pricing page
 * renders it. Rates are cached in memory until the provider's next update, and if the provider
 * can't be reached we keep the last good rates, or the built-in fallback below.
 */

export const CURRENCIES = [
  { code: "USD", name: "US dollar" },
  { code: "INR", name: "Indian rupee" },
  { code: "LKR", name: "Sri Lankan rupee" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "AUD", name: "Australian dollar" },
  { code: "NZD", name: "New Zealand dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "AED", name: "UAE dirham" },
  { code: "MYR", name: "Malaysian ringgit" },
  { code: "JPY", name: "Japanese yen" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as CurrencyCode[];
export const DEFAULT_CURRENCY: CurrencyCode = "USD";

export const isCurrency = (v: unknown): v is CurrencyCode =>
  typeof v === "string" && (CURRENCY_CODES as string[]).includes(v);

/** Units of each currency per 1 USD. */
export type FxRates = {
  rates: Record<CurrencyCode, number>;
  /** When the provider last updated these rates (ms since epoch). */
  updatedAt: number;
  /** "live" = from the provider; "fallback" = built-in approximate rates. */
  source: "live" | "fallback";
};

// Approximate rates (23 Oct 2026), used only until the first successful fetch.
const FALLBACK: FxRates = {
  rates: {
    USD: 1,
    INR: 94.9,
    LKR: 332,
    SGD: 1.277,
    CAD: 1.401,
    AUD: 1.425,
    NZD: 1.76,
    EUR: 0.8915,
    GBP: 0.7467,
    AED: 3.6725,
    MYR: 4.083,
    JPY: 156.9,
  },
  updatedAt: Date.UTC(2026, 9, 23),
  source: "fallback",
};

const URL = process.env.FX_RATES_URL || "https://open.er-api.com/v6/latest/USD";
const RETRY_AFTER_FAILURE_MS = 20 * 60 * 1000; // the provider blocks for 20 minutes after too many requests
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let cached: FxRates = FALLBACK;
let refreshAt = 0; // fetch again after this time
let inflight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  try {
    const res = await fetch(URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: string;
      base_code?: string;
      rates?: Record<string, number>;
      time_last_update_unix?: number;
      time_next_update_unix?: number;
    };
    if (body.result !== "success" || body.base_code !== "USD" || !body.rates)
      throw new Error("unexpected response");

    const rates = { ...cached.rates };
    for (const code of CURRENCY_CODES) {
      const r = body.rates[code];
      if (typeof r === "number" && Number.isFinite(r) && r > 0) rates[code] = r;
    }
    const updatedAt = (body.time_last_update_unix ?? Date.now() / 1000) * 1000;
    cached = { rates, updatedAt, source: "live" };

    const next = body.time_next_update_unix
      ? body.time_next_update_unix * 1000 + 5 * 60 * 1000
      : 0;
    // Refresh soon after the provider's next update, but at least every 24 hours and at most every 30 minutes.
    refreshAt = Math.max(
      Date.now() + 30 * 60 * 1000,
      Math.min(next || Infinity, Date.now() + MAX_AGE_MS),
    );
  } catch (err) {
    console.warn(
      `[fx] could not fetch exchange rates (${(err as Error).message}); using ${cached.source} rates`,
    );
    refreshAt = Date.now() + RETRY_AFTER_FAILURE_MS;
  }
}

/** The latest rates. Never throws; waits at most a few seconds for the provider. */
export async function getRates(): Promise<FxRates> {
  if (Date.now() >= refreshAt) {
    inflight ??= refresh().finally(() => {
      inflight = null;
    });
    await inflight;
  }
  return cached;
}

/** The currency plan prices are set in (what you actually charge). */
export function priceCurrency(): CurrencyCode {
  const c = (process.env.PRICE_CURRENCY || "LKR").toUpperCase();
  return isCurrency(c) ? c : "LKR";
}
