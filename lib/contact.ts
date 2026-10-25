export const CONTACT_TOPICS = {
  general: "General question",
  account: "My account",
  billing: "Billing and plans",
  api: "API and integrations",
  enterprise: "Enterprise and sales",
  abuse: "Report abuse or copyright",
} as const;
export type ContactTopic = keyof typeof CONTACT_TOPICS;
export const isTopic = (t: unknown): t is ContactTopic => typeof t === "string" && t in CONTACT_TOPICS;
