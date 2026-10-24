import Link from "next/link";
import { BillingActions, WaitForPlan } from "@/components/BillingActions";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { queryOne } from "@/lib/db";
import {
  ACCESS_STATUSES,
  billingEnabled,
  currentSubscription,
  getPlanPricing,
  paddleConfig,
} from "@/lib/paddle";
import { PLANS, planFor } from "@/lib/plans";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

const day = (d: Date | null) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "ok" },
  trialing: { label: "Trial", tone: "ok" },
  past_due: { label: "Payment failed", tone: "warn" },
  paused: { label: "Paused", tone: "muted" },
  canceled: { label: "Cancelled", tone: "muted" },
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const user = await requireUser("/account/billing");
  const { checkout } = await searchParams;
  const account = await queryOne<{
    plan: string;
    role: string;
    paddle_customer_id: string | null;
  }>(`SELECT plan, role, paddle_customer_id FROM users WHERE id = $1`, [
    user.id,
  ]);
  const plan = planFor(account ?? {});
  const enabled = billingEnabled();
  const sub = enabled ? await currentSubscription(user.id) : null;
  const live = sub && ACCESS_STATUSES.includes(sub.status) ? sub : null;
  const pricing = enabled ? await getPlanPricing() : null;

  // The price of the live subscription, from the same Paddle prices the pricing page shows.
  let priceText: string | null = null;
  if (live && pricing && live.billing_interval) {
    const amount = pricing.plans[live.plan]?.[live.billing_interval];
    if (amount != null) {
      const fmt = new Intl.NumberFormat("en", {
        style: "currency",
        currency: pricing.currency,
        currencyDisplay: "code",
      });
      priceText = `${fmt.format(amount)} / ${live.billing_interval}`;
    }
  }
  const renews =
    live && !live.scheduled_change ? day(live.next_billed_at) : null;
  const ends =
    live?.scheduled_change === "cancel"
      ? day(live.scheduled_change_at ?? live.current_period_end)
      : null;
  const waiting = checkout === "success" && !live;
  const status = live ? STATUS[live.status] : null;
  const manual = !live && account?.plan && account.plan !== "free";

  return (
    <div className="stack-l" style={{ maxWidth: 720 }}>
      <div className="page-head" style={{ paddingBottom: 0 }}>
        <div>
          <h1>Billing</h1>
          <p>Your plan, payments and invoices.</p>
        </div>
      </div>

      {waiting && <WaitForPlan />}
      {checkout === "success" && live && (
        <div className="alert ok" role="status">
          You&apos;re on {PLANS[live.plan].label}. Your new limits are already
          active. A receipt is on its way from Paddle.
        </div>
      )}
      {live?.status === "past_due" && (
        <div className="alert warn" role="alert">
          Your last payment didn&apos;t go through. Paddle will try again over
          the next few days. Update your payment method to keep{" "}
          {PLANS[live.plan].label}.
        </div>
      )}

      <section className="panel plan-card" aria-label="Your plan">
        <div className="plan-head">
          <div>
            <span className="plan-badge">{plan.label} plan</span>
            {status && (
              <span className={`status-chip ${status.tone}`}>
                {status.label}
              </span>
            )}
            {priceText && <p className="billing-price">{priceText}</p>}
            <p className="detail" style={{ margin: "8px 0 0" }}>
              {ends
                ? `Cancelled. You keep ${PLANS[live!.plan].label} until ${ends}, then move to Free.`
                : renews
                  ? `Renews on ${renews}.`
                  : live?.status === "past_due"
                    ? "Waiting for payment."
                    : manual
                      ? "Your plan was set up by the PinPicX team, so there's nothing to pay here."
                      : "Free forever. Upgrade when you need more uploads or API keys."}
            </p>
          </div>
        </div>
        <ul className="billing-limits">
          <li>
            <strong>{plan.webUploadsPerHour.toLocaleString("en")}</strong>{" "}
            website uploads per hour
          </li>
          <li>
            <strong>{plan.apiUploadsPerHour.toLocaleString("en")}</strong> API
            uploads per hour
          </li>
          <li>
            <strong>{plan.maxApiKeys}</strong> API key
            {plan.maxApiKeys === 1 ? "" : "s"}
          </li>
        </ul>

        {enabled ? (
          <BillingActions
            hasSubscription={Boolean(live)}
            hasCustomer={Boolean(account?.paddle_customer_id)}
            cancelScheduled={Boolean(ends)}
            endsOn={day(
              live?.next_billed_at ?? live?.current_period_end ?? null,
            )}
            pastDue={live?.status === "past_due"}
          />
        ) : (
          <p className="detail" style={{ marginBottom: 0 }}>
            To change your plan, email{" "}
            <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>{" "}
            or see <Link href="/pricing">Pricing</Link>.
          </p>
        )}
      </section>

      {enabled && (
        <p className="detail">
          Payments are handled by Paddle, our reseller, who also sends your
          receipts and invoices.
          {paddleConfig.environment === "sandbox" && (
            <>
              {" "}
              <strong>Test mode:</strong> no real money is charged.
            </>
          )}
        </p>
      )}
    </div>
  );
}
