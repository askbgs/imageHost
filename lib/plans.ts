// Plan limits. Every account has a plan (users.plan); admins can change it under Moderation → Users.
// API upload limits count across all of an account's keys, so extra keys don't add uploads.

export type PlanId = "free" | "pro" | "business";

export type Plan = {
  id: PlanId;
  label: string;
  maxApiKeys: number;
  apiUploadsPerHour: number;
  /** Uploads per hour from the website (drag and drop, paste, URL), counted separately from API uploads. */
  webUploadsPerHour: number;
  /** Monthly price in PRICE_CURRENCY (default LKR; 0 = free). Yearly billing is 10 × monthly: two months free. */
  price: number;
  tagline: string;
  /** Extra lines shown on the pricing page. Keep them to things the plan really includes. */
  perks: string[];
};

function int(name: string, fallback: number) {
  const n = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** A price from the environment: PRO_PRICE, or the older PRO_PRICE_LKR name. Decimals allowed (e.g. 2.99). */
function price(name: string, fallback: number) {
  for (const key of [`${name}_PRICE`, `${name}_PRICE_LKR`]) {
    const n = Number.parseFloat(process.env[key] || "");
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return fallback;
}

const paidWebDefault = int("USER_UPLOADS_PER_HOUR", 200);

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    label: "Free",
    maxApiKeys: int("FREE_API_KEYS", 1),
    apiUploadsPerHour: int("FREE_API_UPLOADS_PER_HOUR", 10),
    webUploadsPerHour: int("FREE_WEB_UPLOADS_PER_HOUR", 50),
    price: 0,
    tagline: "For personal use and trying out the API.",
    perks: [],
  },
  pro: {
    id: "pro",
    label: "Pro",
    maxApiKeys: int("PRO_API_KEYS", 5),
    apiUploadsPerHour: int("PRO_API_UPLOADS_PER_HOUR", 500),
    webUploadsPerHour: int("PRO_WEB_UPLOADS_PER_HOUR", paidWebDefault),
    price: price("PRO", 990),
    tagline: "For creators and automations that upload every day.",
    perks: ["Priority email support"],
  },
  business: {
    id: "business",
    label: "Business",
    maxApiKeys: int("BUSINESS_API_KEYS", 20),
    apiUploadsPerHour: int("BUSINESS_API_UPLOADS_PER_HOUR", 5000),
    webUploadsPerHour: int("BUSINESS_WEB_UPLOADS_PER_HOUR", paidWebDefault),
    price: price("BUSINESS", 4900),
    tagline: "For shops, agencies and apps that run on images.",
    perks: ["Priority support with faster replies"],
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** The limits that apply to an account. Admins get the highest plan's limits. */
export function planFor(user: {
  plan?: string | null;
  role?: string | null;
}): Plan {
  if (user.role === "admin")
    return {
      ...PLANS.business,
      label: `${PLANS[(user.plan as PlanId) ?? "free"]?.label ?? "Free"} (admin)`,
    };
  return PLANS[(user.plan as PlanId) ?? "free"] ?? PLANS.free;
}

export const apiRateKey = (userId: string) => `rl:api:user:${userId}`;
export const webRateKey = (userId: string) => `rl:user:${userId}`;
