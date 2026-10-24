import { NextResponse } from "next/server";
import { config } from "./config";

export type ErrorCode =
  | "invalid_image"
  | "invalid_expiration"
  | "invalid_request"
  | "invalid_key"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "file_too_large"
  | "unsupported_type"
  | "blocked_content"
  | "rate_limited"
  | "storage_full"
  | "url_fetch_failed"
  | "processing"
  | "server_error";

const STATUS: Record<ErrorCode, number> = {
  invalid_image: 400,
  invalid_expiration: 400,
  invalid_request: 400,
  invalid_key: 401,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  file_too_large: 413,
  unsupported_type: 415,
  blocked_content: 422,
  rate_limited: 429,
  storage_full: 403,
  url_fetch_failed: 502,
  processing: 202,
  server_error: 500,
};

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function apiError(code: ErrorCode, message: string, headers: Record<string, string> = {}) {
  const status = STATUS[code];
  return NextResponse.json(
    { success: false, status, error: { code, message } },
    { status, headers: { ...corsHeaders, ...headers } },
  );
}

export function apiOk(data: unknown, status = 200) {
  return NextResponse.json({ data, success: true, status }, { status, headers: corsHeaders });
}

export function handleError(err: unknown) {
  if (err instanceof ApiError) return apiError(err.code, err.message, err.headers);
  console.error(err);
  return apiError("server_error", "Something went wrong");
}

// The public API is meant to be called from anywhere (browser scripts, plugins).
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
};

export function preflight() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export function clientIp(source: Request | Headers): string | null {
  const req = { headers: source instanceof Headers ? source : source.headers };
  if (config.clientIpHeader) {
    const v = req.headers.get(config.clientIpHeader);
    return v ? v.split(",")[0]!.trim() : null;
  }
  if (config.trustCloudflare) {
    const cf = req.headers.get("cf-connecting-ip");
    if (cf) return cf.trim();
  }
  if (config.trustProxy) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }
  return null;
}

export const limitHeaders = (r: { limit: number; remaining: number; retryAfter: number }) => ({
  "X-RateLimit-Limit": String(r.limit),
  "X-RateLimit-Remaining": String(r.remaining),
  ...(r.retryAfter ? { "Retry-After": String(r.retryAfter) } : {}),
});
