/**
 * Paddle Billing: subscriptions for the Pro and Business plans.
 *
 * Paddle is the merchant of record: it runs checkout, charges cards, handles tax and invoices,
 * and tells us about changes through webhooks (app/api/paddle/webhook). The webhook is the
 * source of truth for users.plan; the pages only read it.
 *
 * Setup is in PADDLE.md. Billing turns on when the API key, client-side token, webhook secret
 * and at least one price ID are set; until then the pricing page falls back to "email us".
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { pool, query, queryOne } from "./db";
import { isCurrency, priceCurrency, type CurrencyCode } from "./fx";
import { PLANS, type PlanId } from "./plans";

export type PaidPlanId = Exclude<PlanId, "free">;
export type Interval = "month" | "year";

const env = (name: string) => (process.env[name] || "").trim();

export const paddleConfig = {
  environment: (env("PADDLE_ENV") === "production"
    ? "production"
    : "sandbox") as "sandbox" | "production",
  apiKey: env("PADDLE_API_KEY"),
  clientToken: env("PADDLE_CLIENT_TOKEN"),
  webhookSecret: env("PADDLE_WEBHOOK_SECRET"),
  prices: {
    pro: {
      month: env("PADDLE_PRICE_PRO_MONTHLY"),
      year: env("PADDLE_PRICE_PRO_YEARLY"),
    },
    business: {
      month: env("PADDLE_PRICE_BUSINESS_MONTHLY"),
      year: env("PADDLE_PRICE_BUSINESS_YEARLY"),
    },
  } as Record<PaidPlanId, Record<Interval, string>>,
};

const apiBase =
  env("PADDLE_API_URL") ||
  (paddleConfig.environment === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com");

export const PAID_PLANS: PaidPlanId[] = ["pro", "business"];

/** True when checkout can be offered. */
export function billingEnabled() {
  const c = paddleConfig;
  return Boolean(
    c.apiKey &&
    c.clientToken &&
    c.webhookSecret &&
    PAID_PLANS.some((p) => c.prices[p].month || c.prices[p].year),
  );
}

/** Statuses that keep the paid plan. past_due keeps access while Paddle retries the payment. */
export const ACCESS_STATUSES = ["active", "trialing", "past_due"];

// ---------------------------------------------------------------- API

export class PaddleApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function paddleApi<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${paddleConfig.apiKey}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as {
    data?: T;
    error?: { code?: string; detail?: string };
  } | null;
  if (!res.ok) {
    const detail = json?.error?.detail || `HTTP ${res.status}`;
    throw new PaddleApiError(
      `Paddle: ${detail}`,
      res.status,
      json?.error?.code,
    );
  }
  return json?.data as T;
}

// ---------------------------------------------------------------- webhook signatures

/**
 * Checks the Paddle-Signature header ("ts=...;h1=...") against the raw body.
 * The signed string is `${ts}:${rawBody}`, HMAC-SHA256 with the destination's secret, hex encoded.
 * Several h1 values can appear while a secret is being rotated; any match is accepted.
 */
export function verifyWebhook(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!header || !secret) return false;
  let ts = "";
  const sigs: string[] = [];
  for (const part of header.split(";")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim() ?? "");
    if (k === "ts") ts = v;
    else if (k === "h1" && v) sigs.push(v);
  }
  if (!/^\d+$/.test(ts) || sigs.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${ts}:${rawBody}`)
    .digest();
  return sigs.some((h) => {
    if (!/^[0-9a-f]{64}$/i.test(h)) return false;
    const got = Buffer.from(h, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

// ---------------------------------------------------------------- prices

type PaddlePrice = {
  id: string;
  status: string;
  unit_price: { amount: string; currency_code: string };
  billing_cycle: { interval: string; frequency: number } | null;
  custom_data?: Record<string, unknown> | null;
};

export type PlanPricing = {
  /** Currency the amounts are in. */
  currency: CurrencyCode;
  /** Monthly and yearly price per paid plan, in major units (e.g. 2.99). null = not offered. */
  plans: Record<PaidPlanId, { month: number | null; year: number | null }>;
  source: "paddle" | "config";
};

const minorDigits = (currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;

function configPricing(): PlanPricing {
  const plans = {} as PlanPricing["plans"];
  for (const id of PAID_PLANS)
    plans[id] = { month: PLANS[id].price, year: PLANS[id].price * 10 };
  return { currency: priceCurrency(), plans, source: "config" };
}

let pricingCache: { value: PlanPricing; until: number } | null = null;

/**
 * The prices to show on the pricing page. With Paddle on, they come from the Paddle prices themselves,
 * so the page always matches what checkout charges. Cached for 10 minutes; falls back to the
 * PRO_PRICE / BUSINESS_PRICE settings if Paddle can't be reached.
 */
export async function getPlanPricing(): Promise<PlanPricing> {
  if (!billingEnabled()) return configPricing();
  if (pricingCache && Date.now() < pricingCache.until)
    return pricingCache.value;

  try {
    const plans = {} as PlanPricing["plans"];
    let currency = "";
    for (const id of PAID_PLANS) {
      plans[id] = { month: null, year: null };
      for (const interval of ["month", "year"] as Interval[]) {
        const priceId = paddleConfig.prices[id][interval];
        if (!priceId) continue;
        const p = await paddleApi<PaddlePrice>(
          `/prices/${encodeURIComponent(priceId)}`,
        );
        const code = p.unit_price.currency_code.toUpperCase();
        if (currency && code !== currency)
          throw new Error(
            `prices use different currencies (${currency}, ${code})`,
          );
        currency = code;
        plans[id][interval] =
          Number(p.unit_price.amount) / 10 ** minorDigits(code);
      }
      // Without a yearly price, offer monthly only (and the reverse).
    }
    if (!isCurrency(currency))
      throw new Error(
        `price currency ${currency} isn't in the currency list (lib/fx.ts)`,
      );
    const value: PlanPricing = { currency, plans, source: "paddle" };
    pricingCache = { value, until: Date.now() + 10 * 60 * 1000 };
    return value;
  } catch (err) {
    console.error(
      `[paddle] couldn't load prices: ${(err as Error).message}; showing configured prices`,
    );
    const value = configPricing();
    pricingCache = { value, until: Date.now() + 60 * 1000 };
    return value;
  }
}

/** Which plan and billing interval a Paddle price stands for. */
export function planForPrice(
  priceId: string,
  priceCustomData?: Record<string, unknown> | null,
): { plan: PaidPlanId; interval: Interval | null } | null {
  for (const plan of PAID_PLANS) {
    for (const interval of ["month", "year"] as Interval[]) {
      if (paddleConfig.prices[plan][interval] === priceId)
        return { plan, interval };
    }
  }
  // Prices added later in Paddle can say which plan they're for with custom data: {"plan": "pro"}.
  const named = priceCustomData?.plan;
  if (named === "pro" || named === "business")
    return { plan: named, interval: null };
  return null;
}

// ---------------------------------------------------------------- subscriptions → plans

export type PaddleSubscription = {
  id: string;
  status: string;
  customer_id: string;
  custom_data: Record<string, unknown> | null;
  currency_code: string;
  items: { price: PaddlePrice }[];
  current_billing_period: { starts_at: string; ends_at: string } | null;
  next_billed_at: string | null;
  scheduled_change: { action: string; effective_at: string } | null;
  canceled_at: string | null;
  updated_at: string;
};

export type SubscriptionRow = {
  id: string;
  user_id: string | null;
  customer_id: string;
  status: string;
  plan: PaidPlanId;
  price_id: string | null;
  billing_interval: Interval | null;
  currency: string | null;
  current_period_end: Date | null;
  next_billed_at: Date | null;
  scheduled_change: string | null;
  scheduled_change_at: Date | null;
  canceled_at: Date | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANK: Record<string, number> = { free: 0, pro: 1, business: 2 };

/**
 * Saves a subscription from a webhook or an API response and updates the owner's plan.
 * Older versions of a subscription (by Paddle's updated_at) are ignored, so events can arrive in any order.
 * Returns the user it belongs to, or null if no account matches.
 */
export async function applySubscription(
  sub: PaddleSubscription,
): Promise<string | null> {
  const match = sub.items
    .map((i) => ({ item: i, m: planForPrice(i.price.id, i.price.custom_data) }))
    .find((x) => x.m !== null);
  if (!match?.m) {
    console.warn(
      `[paddle] subscription ${sub.id} has no price for a PinPicX plan; ignoring it`,
    );
    return null;
  }
  const interval =
    match.m.interval ??
    ((match.item.price.billing_cycle?.interval as Interval | undefined) ||
      null);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Who is it for? The account that opened checkout, else whoever already owns it or the Paddle customer.
    let userId: string | null = null;
    const claimed = sub.custom_data?.user_id;
    if (typeof claimed === "string" && UUID_RE.test(claimed)) {
      const r = await client.query(`SELECT id FROM users WHERE id = $1`, [
        claimed,
      ]);
      userId = r.rows[0]?.id ?? null;
    }
    if (!userId) {
      const r = await client.query(
        `SELECT user_id FROM subscriptions WHERE id = $1`,
        [sub.id],
      );
      userId = r.rows[0]?.user_id ?? null;
    }
    if (!userId) {
      const r = await client.query(
        `SELECT id FROM users WHERE paddle_customer_id = $1`,
        [sub.customer_id],
      );
      userId = r.rows[0]?.id ?? null;
    }
    if (userId)
      await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [
        userId,
      ]);

    const saved = await client.query(
      `INSERT INTO subscriptions (id, user_id, customer_id, status, plan, price_id, billing_interval, currency,
                                  current_period_end, next_billed_at, scheduled_change, scheduled_change_at,
                                  canceled_at, paddle_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET
         user_id = COALESCE(subscriptions.user_id, EXCLUDED.user_id),
         customer_id = EXCLUDED.customer_id, status = EXCLUDED.status, plan = EXCLUDED.plan,
         price_id = EXCLUDED.price_id, billing_interval = EXCLUDED.billing_interval, currency = EXCLUDED.currency,
         current_period_end = EXCLUDED.current_period_end, next_billed_at = EXCLUDED.next_billed_at,
         scheduled_change = EXCLUDED.scheduled_change, scheduled_change_at = EXCLUDED.scheduled_change_at,
         canceled_at = EXCLUDED.canceled_at, paddle_updated_at = EXCLUDED.paddle_updated_at, updated_at = now()
       WHERE subscriptions.paddle_updated_at <= EXCLUDED.paddle_updated_at
       RETURNING user_id`,
      [
        sub.id,
        userId,
        sub.customer_id,
        sub.status,
        match.m.plan,
        match.item.price.id,
        interval,
        sub.currency_code,
        sub.current_billing_period?.ends_at ?? null,
        sub.next_billed_at,
        sub.scheduled_change?.action ?? null,
        sub.scheduled_change?.effective_at ?? null,
        sub.canceled_at,
        sub.updated_at,
      ],
    );
    const owner: string | null = saved.rows[0]?.user_id ?? userId;

    if (owner) {
      await client.query(
        `UPDATE users SET paddle_customer_id = $2 WHERE id = $1 AND paddle_customer_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM users WHERE paddle_customer_id = $2)`,
        [owner, sub.customer_id],
      );
      // The plan is the best one among the account's live subscriptions; none left means Free.
      const live = await client.query<{ plan: string }>(
        `SELECT plan FROM subscriptions WHERE user_id = $1 AND status = ANY($2)`,
        [owner, ACCESS_STATUSES],
      );
      const best =
        live.rows
          .map((r) => r.plan)
          .sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0))[0] ?? "free";
      await client.query(`UPDATE users SET plan = $2 WHERE id = $1`, [
        owner,
        best,
      ]);
    } else {
      console.warn(
        `[paddle] subscription ${sub.id} (customer ${sub.customer_id}) doesn't match any account yet`,
      );
    }

    await client.query("COMMIT");
    return owner;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The subscription that sets the account's plan: a live one if any, else the most recent. */
export async function currentSubscription(
  userId: string,
): Promise<SubscriptionRow | null> {
  return queryOne<SubscriptionRow>(
    `SELECT id, user_id, customer_id, status, plan, price_id, billing_interval, currency, current_period_end,
            next_billed_at, scheduled_change, scheduled_change_at, canceled_at
       FROM subscriptions
      WHERE user_id = $1
      ORDER BY (status = ANY($2)) DESC, updated_at DESC
      LIMIT 1`,
    [userId, ACCESS_STATUSES],
  );
}

export async function liveSubscriptions(
  userId: string,
): Promise<SubscriptionRow[]> {
  return query<SubscriptionRow>(
    `SELECT id, user_id, customer_id, status, plan, price_id, billing_interval, currency, current_period_end,
            next_billed_at, scheduled_change, scheduled_change_at, canceled_at
       FROM subscriptions WHERE user_id = $1 AND status = ANY($2)`,
    [userId, ACCESS_STATUSES],
  );
}

/**
 * Cancels every live subscription right away. Used when an account is deleted,
 * so nobody keeps paying for an account that no longer exists. (Not a server action on purpose.)
 */
export async function cancelAllNow(userId: string): Promise<void> {
  if (!billingEnabled()) return;
  for (const sub of await liveSubscriptions(userId)) {
    const updated = await paddleApi<PaddleSubscription>(
      `/subscriptions/${sub.id}/cancel`,
      {
        method: "POST",
        body: { effective_from: "immediately" },
      },
    );
    await applySubscription(updated);
  }
}

/** Where Paddle sends people after a successful checkout. */
export const checkoutSuccessUrl = () =>
  `${config.siteUrl}/account/billing?checkout=success`;
