// Plan limits. Every account has a plan (users.plan); admins can change it under Moderation → Users.
// API upload limits count across all of an account's keys, so extra keys don't add uploads.

export type PlanId = "free" | "pro" | "business";

export type Plan = {
  id: PlanId;
  label: string;
  maxApiKeys: number;
  apiUploadsPerHour: number;
  /** Monthly price in LKR (0 = free). Yearly billing is 10 × monthly: two months free. */
  priceLkr: number;
  tagline: string;
  /** Extra lines shown on the pricing page. Keep them to things the plan really includes. */
  perks: string[];
};

function int(name: string, fallback: number) {
  const n = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    label: "Free",
    maxApiKeys: int("FREE_API_KEYS", 1),
    apiUploadsPerHour: int("FREE_API_UPLOADS_PER_HOUR", 10),
    priceLkr: 0,
    tagline: "For personal use and trying out the API.",
    perks: [],
  },
  pro: {
    id: "pro",
    label: "Pro",
    maxApiKeys: int("PRO_API_KEYS", 5),
    apiUploadsPerHour: int("PRO_API_UPLOADS_PER_HOUR", 500),
    priceLkr: int("PRO_PRICE_LKR", 990),
    tagline: "For creators and automations that upload every day.",
    perks: ["Priority email support"],
  },
  business: {
    id: "business",
    label: "Business",
    maxApiKeys: int("BUSINESS_API_KEYS", 20),
    apiUploadsPerHour: int("BUSINESS_API_UPLOADS_PER_HOUR", 5000),
    priceLkr: int("BUSINESS_PRICE_LKR", 4900),
    tagline: "For shops, agencies and apps that run on images.",
    perks: ["Priority support with faster replies"],
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** The limits that apply to an account. Admins get the highest plan's limits. */
export function planFor(user: { plan?: string | null; role?: string | null }): Plan {
  if (user.role === "admin") return { ...PLANS.business, label: `${PLANS[(user.plan as PlanId) ?? "free"]?.label ?? "Free"} (admin)` };
  return PLANS[(user.plan as PlanId) ?? "free"] ?? PLANS.free;
}

export const apiRateKey = (userId: string) => `rl:api:user:${userId}`;

export const formatLkr = (n: number) => `LKR ${n.toLocaleString("en")}`;
