// Values shared by server and client code (no server-only imports here).

export const REPORT_REASONS = ["illegal", "nsfw", "copyright", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_LABELS: Record<ReportReason, string> = {
  illegal: "Illegal content",
  nsfw: "Adult or sexual content",
  copyright: "Copyright infringement",
  spam: "Spam or scam",
  other: "Something else",
};

export const EXPIRY_OPTIONS: { label: string; seconds: number }[] = [
  { label: "Never", seconds: 0 },
  { label: "5 minutes", seconds: 300 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "1 week", seconds: 604800 },
  { label: "1 month", seconds: 2592000 },
  { label: "6 months", seconds: 15552000 },
];
