import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { STATE_COOKIE, getProvider, newAuthorization, safeNext } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /auth/{provider}?next=/path[&mode=link] — send the browser to the provider's sign-in page. */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: id } = await ctx.params;
  const url = new URL(req.url);
  const provider = getProvider(id);
  const back = (path: string) => NextResponse.redirect(new URL(path, config.siteUrl));
  if (!provider) return back("/login?error=provider_disabled");

  const mode = url.searchParams.get("mode") === "link" ? "link" : "signin";
  const next = safeNext(url.searchParams.get("next") ?? (mode === "link" ? "/account/settings" : "/"));
  if (mode === "link" && !(await currentUser())) return back(`/login?next=${encodeURIComponent("/account/settings")}`);

  const auth = newAuthorization(provider, next, mode);
  (await cookies()).set(STATE_COOKIE, auth.cookie, {
    httpOnly: true,
    sameSite: "lax", // sent on the provider's top-level redirect back to us
    secure: config.siteUrl.startsWith("https://"),
    path: "/auth",
    maxAge: 600,
  });
  return NextResponse.redirect(auth.url);
}
