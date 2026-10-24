import Link from "next/link";
import { CurrencyProvider, FxNote, Money } from "@/components/Currency";
import { PricingCards, type PriceCard } from "@/components/PricingCards";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { queryOne } from "@/lib/db";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  getRates,
  isCurrency,
  priceCurrency,
} from "@/lib/fx";
import { PLANS, PLAN_IDS, type PlanId } from "@/lib/plans";

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
  const [user, fx, params] = await Promise.all([
    currentUser(),
    getRates(),
    searchParams,
  ]);
  const asked = params.currency?.toUpperCase();
  const initialCurrency = isCurrency(asked) ? asked : DEFAULT_CURRENCY;
  const updated = new Date(fx.updatedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const account = user
    ? await queryOne<{ plan: string }>(`SELECT plan FROM users WHERE id = $1`, [
        user.id,
      ])
    : null;
  const current = (account?.plan as PlanId | undefined) ?? null;
  const mb = config.maxUploadBytes / 1024 / 1024;
  const contact = config.contactEmail;

  const mail = (subject: string) =>
    `mailto:${contact}?subject=${encodeURIComponent(subject)}${
      user
        ? `&body=${encodeURIComponent(`Hi,\n\nPlease switch my account (${user.email}) to the plan above.\n\nThanks`)}`
        : ""
    }`;

  const base = [
    "No limit on how many images you keep",
    `Files up to ${mb} MB`,
    "Direct links, HTML, BBCode and Markdown",
    "Location and camera data removed",
  ];

  const cards: PriceCard[] = PLAN_IDS.map((id) => {
    const p = PLANS[id];
    const isCurrent = current === id;
    const rank = PLAN_IDS.indexOf(id);
    const currentRank = current ? PLAN_IDS.indexOf(current) : -1;
    let cta: PriceCard["cta"];
    if (isCurrent)
      cta = { label: "Your current plan", disabled: true, tone: "secondary" };
    else if (id === "free") {
      cta = user
        ? {
            label: "Included with every account",
            disabled: true,
            tone: "secondary",
          }
        : {
            label: "Create a free account",
            href: "/signup",
            tone: "secondary",
          };
    } else if (!user)
      cta = {
        label: `Start with ${p.label}`,
        href: `/signup?next=${encodeURIComponent("/pricing")}`,
        tone: id === "pro" ? "primary" : "secondary",
      };
    else if (rank < currentRank)
      cta = {
        label: `Switch to ${p.label}`,
        href: mail(`Switch to ${p.label}`),
        tone: "secondary",
      };
    else
      cta = {
        label: `Upgrade to ${p.label}`,
        href: mail(`Upgrade to ${p.label}`),
        tone: id === "pro" ? "primary" : "secondary",
      };

    const features = [
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
      price: p.price,
      features,
      recommended: id === "pro" && current !== "pro",
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
      base={priceCurrency()}
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

        <PricingCards cards={cards} />

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
                      <Money amount={PLANS[id].price} />
                    </td>
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
          <details>
            <summary>How do I upgrade?</summary>
            <p>
              Choose Upgrade on a plan, or email{" "}
              <a href={`mailto:${contact}`}>{contact}</a> from your
              account&apos;s address. We switch your plan, usually within a day,
              and the new limits apply to your existing keys straight away.
            </p>
          </details>
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
            <summary>Can I go back to Free?</summary>
            <p>
              Yes. Your images stay where they are. If you have more keys than
              Free allows, they keep working, but you can&apos;t create new ones
              until you&apos;re under the limit.
            </p>
          </details>
        </section>

        <p className="pricing-foot">
          <FxNote updated={updated} fallback={fx.source === "fallback"} />{" "}
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
