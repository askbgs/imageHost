"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import {
  applySubscription,
  billingEnabled,
  currentSubscription,
  liveSubscriptions,
  PAID_PLANS,
  PaddleApiError,
  paddleApi,
  paddleConfig,
  type Interval,
  type PaddleSubscription,
  type PaidPlanId,
} from "@/lib/paddle";
import { PLANS } from "@/lib/plans";

export type BillingResult = { ok?: string; error?: string };

function friendly(err: unknown, fallback: string) {
  console.error("[billing]", err);
  if (err instanceof PaddleApiError && err.status < 500)
    return `${fallback} ${err.message.replace(/^Paddle: /, "")}`;
  return `${fallback} Please try again in a minute.`;
}

const done = () => {
  revalidatePath("/account/billing");
  revalidatePath("/pricing");
  revalidatePath("/account/keys");
};

/** Upgrade or downgrade an existing subscription. Paddle charges or credits the difference straight away. */
export async function changePlan(
  plan: string,
  interval: string,
): Promise<BillingResult> {
  const user = await currentUser();
  if (!user) return { error: "Sign in again to change your plan." };
  if (!billingEnabled())
    return { error: "Online billing isn't set up on this site." };
  if (
    !(PAID_PLANS as string[]).includes(plan) ||
    (interval !== "month" && interval !== "year")
  ) {
    return { error: "Choose a plan." };
  }
  const priceId = paddleConfig.prices[plan as PaidPlanId][interval as Interval];
  if (!priceId)
    return {
      error: `${PLANS[plan as PaidPlanId].label} isn't offered ${interval === "year" ? "yearly" : "monthly"}.`,
    };

  const sub = await currentSubscription(user.id);
  if (!sub || !["active", "trialing", "past_due"].includes(sub.status)) {
    return {
      error:
        "You don't have a subscription to change. Choose a plan on the pricing page.",
    };
  }
  if (sub.status === "past_due")
    return {
      error:
        "Your last payment didn't go through. Update your payment method in Billing first.",
    };
  if (sub.price_id === priceId && !sub.scheduled_change)
    return { ok: "You're already on that plan." };

  try {
    const updated = await paddleApi<PaddleSubscription>(
      `/subscriptions/${sub.id}`,
      {
        method: "PATCH",
        body: {
          items: [{ price_id: priceId, quantity: 1 }],
          proration_billing_mode: "prorated_immediately",
          // Changing plan also keeps the subscription going if a cancellation was scheduled.
          ...(sub.scheduled_change ? { scheduled_change: null } : {}),
        },
      },
    );
    await applySubscription(updated);
  } catch (err) {
    return { error: friendly(err, "We couldn't change your plan.") };
  }
  done();
  return { ok: `You're now on ${PLANS[plan as PaidPlanId].label}.` };
}

/** Cancel at the end of the period that's already paid for. */
export async function cancelSubscription(): Promise<BillingResult> {
  const user = await currentUser();
  if (!user) return { error: "Sign in again." };
  const sub = await currentSubscription(user.id);
  if (!sub || sub.status === "canceled")
    return { error: "You don't have an active subscription." };
  try {
    const updated = await paddleApi<PaddleSubscription>(
      `/subscriptions/${sub.id}/cancel`,
      {
        method: "POST",
        body: { effective_from: "next_billing_period" },
      },
    );
    await applySubscription(updated);
  } catch (err) {
    return { error: friendly(err, "We couldn't cancel your subscription.") };
  }
  done();
  return {
    ok: "Your subscription is cancelled. You keep your plan until the end of the period you've paid for.",
  };
}

/** Undo a scheduled cancellation. */
export async function keepSubscription(): Promise<BillingResult> {
  const user = await currentUser();
  if (!user) return { error: "Sign in again." };
  const sub = await currentSubscription(user.id);
  if (!sub?.scheduled_change)
    return { ok: "Your subscription is already set to renew." };
  try {
    const updated = await paddleApi<PaddleSubscription>(
      `/subscriptions/${sub.id}`,
      {
        method: "PATCH",
        body: { scheduled_change: null },
      },
    );
    await applySubscription(updated);
  } catch (err) {
    return { error: friendly(err, "We couldn't restart your subscription.") };
  }
  done();
  return { ok: "Your subscription will renew as usual." };
}

/** Opens Paddle's customer portal: payment method, invoices and receipts. */
export async function openBillingPortal(): Promise<BillingResult> {
  const user = await currentUser();
  if (!user) return { error: "Sign in again." };
  const row = await queryOne<{ paddle_customer_id: string | null }>(
    `SELECT paddle_customer_id FROM users WHERE id = $1`,
    [user.id],
  );
  if (!row?.paddle_customer_id)
    return { error: "There's no billing history for this account yet." };
  let url: string;
  try {
    const subs = await liveSubscriptions(user.id);
    const session = await paddleApi<{
      urls: { general: { overview: string } };
    }>(`/customers/${row.paddle_customer_id}/portal-sessions`, {
      method: "POST",
      body: subs.length ? { subscription_ids: subs.map((s) => s.id) } : {},
    });
    url = session.urls.general.overview;
  } catch (err) {
    return { error: friendly(err, "We couldn't open the billing portal.") };
  }
  redirect(url);
}
