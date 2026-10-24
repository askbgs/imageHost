import Link from "next/link";
import { CurrencyProvider, FxNote, Money } from "@/components/Currency";
import { PricingCards, type PriceCard } from "@/components/PricingCards";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { queryOne } from "@/lib/db";
import { CURRENCIES, DEFAULT_CURRENCY, getRates, isCurrency } from "@/lib/fx";
import {
  ACCESS_STATUSES,
  billingEnabled,
  checkoutSuccessUrl,
  currentSubscription,
  getPlanPricing,
  paddleConfig,
  type PaidPlanId,
} from "@/lib/paddle";
import { PLANS, PLAN_IDS, type PlanId } from "@/lib/plans";
import { formatStorage } from "@/lib/quota";

export const metadata = {
  title: "Pricing",
  description:
    "Free image hosting with direct links, plus plans with higher API limits.",
};

const n = (x: number) => x.toLocaleString("en");

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string }>;
}) {
  const [user, fx, params, pricing] = await Promise.all([
    currentUser(),
    getRates(),
    searchParams,
    getPlanPricing(),
  ]);
  const asked = params.currency?.toUpperCase();
  const initialCurrency = isCurrency(asked) ? asked : DEFAULT_CURRENCY;
  const updated = new Date(fx.updatedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const billing = billingEnabled();
  const account = user
    ? await queryOne<{ plan: string; paddle_customer_id: string | null }>(
        `SELECT plan, paddle_customer_id FROM users WHERE id = $1`,
        [user.id],
      )
    : null;
  const current = (account?.plan as PlanId | undefined) ?? null;
  const sub = user && billing ? await currentSubscription(user.id) : null;
  const liveSub = sub && ACCESS_STATUSES.includes(sub.status) ? sub : null;
  const mb = config.maxUploadBytes / 1024 / 1024;
  const contact = config.contactEmail;

  const mail = (subject: string) =>
    `mailto:${contact}?subject=${encodeURIComponent(subject)}${
      user
        ? `&body=${encodeURIComponent(`Hi,\n\nPlease switch my account (${user.email}) to the plan above.\n\nThanks`)}`
        : ""
    }`;

  // Monthly and yearly prices, in pricing.currency.
  const monthly = (id: PlanId) => {
    if (id === "free") return 0;
    const p = pricing.plans[id];
    return p.month ?? (p.year !== null ? p.year / 12 : PLANS[id].price);
  };
  const yearPrice = (id: PlanId) =>
    id === "free" ? 0 : pricing.plans[id].year;
  const priceIds = (id: PaidPlanId) => ({
    month: paddleConfig.prices[id].month || undefined,
    year: paddleConfig.prices[id].year || undefined,
  });

  // "2 months free" when yearly is 10 × monthly; otherwise the actual saving. null hides the Yearly option.
  const savings = (["pro", "business"] as PaidPlanId[])
    .filter((id) => pricing.plans[id].month && pricing.plans[id].year)
    .map((id) => 1 - pricing.plans[id].year! / (12 * pricing.plans[id].month!));
  const yearlyOffered = (["pro", "business"] as PaidPlanId[]).some(
    (id) => pricing.plans[id].year !== null,
  );
  const minSaving = savings.length ? Math.min(...savings) : 0;
  const yearlyNote = !yearlyOffered
    ? null
    : Math.abs(minSaving - 1 / 6) < 0.01
      ? "2 months free"
      : minSaving >= 0.01
        ? `Save ${Math.floor(minSaving * 100)}%`
        : "";

  const base = [
    `Files up to ${mb} MB`,
    "Direct links, HTML, BBCode and Markdown",
    "Location and camera data removed",
  ];

  const cards: PriceCard[] = PLAN_IDS.map((id) => {
    const p = PLANS[id];
    const isCurrent = current === id;
    const rank = PLAN_IDS.indexOf(id);
    const currentRank = current ? PLAN_IDS.indexOf(current) : -1;
    const tone = id === "pro" ? "primary" : "secondary";
    const verb = rank < currentRank ? "Switch to" : "Upgrade to";
    let cta: PriceCard["cta"];

    if (id === "free") {
      if (!user)
        cta = {
          label: "Create a free account",
          href: "/signup",
          tone: "secondary",
        };
      else if (liveSub)
        cta = {
          label: "Cancel your plan in Billing",
          href: "/account/billing",
          tone: "secondary",
        };
      else if (isCurrent)
        cta = { label: "Your current plan", disabled: true, tone: "secondary" };
      else
        cta = {
          label: "Included with every account",
          disabled: true,
          tone: "secondary",
        };
    } else if (!user) {
      cta = {
        label: `Start with ${p.label}`,
        href: `/signup?next=${encodeURIComponent("/pricing")}`,
        tone,
      };
    } else if (billing && liveSub) {
      // Already paying: change the subscription in place.
      cta = {
        label: `${verb} ${p.label}`,
        tone,
        switchTo: { plan: id, prices: priceIds(id) },
      };
    } else if (isCurrent) {
      cta = { label: "Your current plan", disabled: true, tone: "secondary" };
    } else if (billing) {
      cta = { label: `${verb} ${p.label}`, tone, checkout: priceIds(id) };
    } else {
      cta = {
        label: `${verb} ${p.label}`,
        href: mail(`${verb} ${p.label}`),
        tone,
      };
    }

    const features = [
      `${formatStorage(p.storageBytes)} storage`,
      `${p.maxApiKeys} API key${p.maxApiKeys === 1 ? "" : "s"}`,
      `${n(p.webUploadsPerHour)} website uploads per hour`,
      `${n(p.apiUploadsPerHour)} API uploads per hour`,
      ...(id === "free"
        ? base
        : [`Everything in ${PLANS[PLAN_IDS[rank - 1]!].label}`]),
      ...p.perks,
    ];
    return {
      id,
      label: p.label,
      tagline: p.tagline,
      price: monthly(id),
      yearPrice: yearPrice(id),
      features,
      recommended: id === "pro" && current !== "pro" && current !== "business",
      current: isCurrent,
      cta,
    };
  });

  cards.push({
    id: "enterprise",
    label: "Enterprise",
    tagline: "For high volumes, your own limits and an agreement.",
    price: null,
    features: [
      "Custom API keys and upload limits",
      "Everything in Business",
      "Invoiced billing",
      "A named contact",
    ],
    cta: {
      label: "Contact us",
      href: mail("PinPicX Enterprise"),
      tone: "secondary",
    },
  });

  return (
    <CurrencyProvider
      initial={initialCurrency}
      base={pricing.currency}
      rates={fx.rates}
      currencies={CURRENCIES.map((c) => ({ code: c.code, name: c.name }))}
    >
      <div className="pricing">
        <section className="pricing-hero">
          <h1>Simple pricing</h1>
          <p className="lede">
            Every account starts on Free. Upgrade when your apps and automations
            need more API uploads.
          </p>
        </section>

        <PricingCards
          cards={cards}
          yearlyNote={yearlyNote}
          currentPriceId={liveSub?.price_id ?? null}
          paddle={
            billing && user
              ? {
                  token: paddleConfig.clientToken,
                  environment: paddleConfig.environment,
                  email: user.email,
                  customerId: account?.paddle_customer_id ?? null,
                  userId: user.id,
                  successUrl: checkoutSuccessUrl(),
                }
              : null
          }
        />

        <section className="compare" aria-labelledby="compare-title">
          <h2 id="compare-title">Compare plans</h2>
          <div className="table-scroll">
            <table className="table compare-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Feature</span>
                  </th>
                  {PLAN_IDS.map((id) => (
                    <th scope="col" key={id}>
                      {PLANS[id].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Price per month</th>
                  {PLAN_IDS.map((id) => (
                    <td key={id}>
                      <Money amount={monthly(id)} />
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Storage</th>
                  {PLAN_IDS.map((id) => (
                    <td key={id}>{formatStorage(PLANS[id].storageBytes)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">API keys</th>
                  {PLAN_IDS.map((id) => (
                    <td key={id}>{PLANS[id].maxApiKeys}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">API uploads per hour</th>
                  {PLAN_IDS.map((id) => (
                    <td key={id}>{n(PLANS[id].apiUploadsPerHour)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Website uploads per hour</th>
                  {PLAN_IDS.map((id) => (
                    <td key={id}>{n(PLANS[id].webUploadsPerHour)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Largest file</th>
                  {PLAN_IDS.map((id) => (
                    <td key={id}>{mb} MB</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Links and embed codes</th>
                  {PLAN_IDS.map((id) => (
                    <td key={id}>Yes</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Support</th>
                  {PLAN_IDS.map((id) => (
                    <td key={id}>
                      {PLANS[id].perks.find((p) => /support/i.test(p)) ??
                        "Email"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="faq" aria-labelledby="faq-title">
          <h2 id="faq-title">Questions</h2>
          {billing ? (
            <>
              <details>
                <summary>How do I upgrade?</summary>
                <p>
                  Choose Upgrade on a plan and pay with a card or another
                  payment method offered in your country. Your new limits apply
                  as soon as the payment goes through, and your existing keys
                  get them straight away.
                </p>
              </details>
              <details>
                <summary>Can I change or cancel my plan?</summary>
                <p>
                  Yes, at any time. A plan change applies straight away: you pay
                  the difference for the rest of the billing period, or
                  it&apos;s credited if the new plan costs less. If you cancel,
                  you keep your plan until the end of the period you&apos;ve
                  paid for, then move to Free. Manage it all in{" "}
                  <Link href="/account/billing">Billing</Link>.
                </p>
              </details>
              <details>
                <summary>Who handles the payment?</summary>
                <p>
                  Our orders are processed by Paddle.com, our online reseller
                  and Merchant of Record. Paddle handles payment, sales tax and
                  invoices, and your receipts come from Paddle. We never see
                  your card details.
                </p>
              </details>
            </>
          ) : (
            <details>
              <summary>How do I upgrade?</summary>
              <p>
                Choose Upgrade on a plan, or email{" "}
                <a href={`mailto:${contact}`}>{contact}</a> from your
                account&apos;s address. We switch your plan, usually within a
                day, and the new limits apply to your existing keys straight
                away.
              </p>
            </details>
          )}
          <details>
            <summary>What counts towards the API limit?</summary>
            <p>
              Each image uploaded with an API key. The limit is shared by all
              your keys and counted over a rolling hour. Uploads on the website
              don&apos;t count towards it. In My images, each image is tagged
              Web or API so you can see where it came from.
            </p>
          </details>
          <details>
            <summary>What happens when I reach the limit?</summary>
            <p>
              New API uploads are refused with a message saying when you can
              upload again. Your existing images and links keep working.
            </p>
          </details>
          <details>
            <summary>What counts towards my storage?</summary>
            <p>
              Every image you keep, including the thumbnail and preview sizes we
              make for it. Deleted and expired images free their space straight
              away. If you reach your limit, your images and links keep working;
              you just can&apos;t upload more until you delete some or upgrade.
            </p>
          </details>
          <details>
            <summary>Can I go back to Free?</summary>
            <p>
              Yes. Your images stay where they are. If you have more keys than
              Free allows, they keep working, but you can&apos;t create new ones
              until you&apos;re under the limit. The same goes for storage: if
              you&apos;re over Free&apos;s allowance, nothing is deleted, but
              new uploads wait until you&apos;re back under it.
            </p>
          </details>
        </section>

        <p className="pricing-foot">
          <FxNote updated={updated} fallback={fx.source === "fallback"} />{" "}
          {billing &&
            "Checkout shows the exact amount, including any tax, before you pay. "}
          {user ? (
            <Link href="/account/keys">See your usage</Link>
          ) : (
            <Link href="/signup">Create a free account</Link>
          )}
        </p>
      </div>
    </CurrencyProvider>
  );
}
