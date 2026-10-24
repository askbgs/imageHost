import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { clientIp } from "@/lib/http";
import { tokenMatches } from "@/lib/ids";
import { OAuthError, STATE_COOKIE, getProvider, readStateCookie, redirectUri, type ProviderId } from "@/lib/oauth";
import { rateLimit } from "@/lib/ratelimit";
import { connectToUser, userForSignIn } from "@/lib/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The provider sends the browser back here with ?code=…&state=… (or ?error=…). */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: id } = await ctx.params;
  const url = new URL(req.url);
  const jar = await cookies();
  const saved = readStateCookie(jar.get(STATE_COOKIE)?.value);
  jar.delete({ name: STATE_COOKIE, path: "/auth" });

  const linking = saved?.mode === "link";
  // Only a code goes in the URL; pages turn it into text (lib/oauth-messages.ts).
  const fail = (code: string) => {
    const to = new URL(linking ? "/account/settings" : "/login", config.siteUrl);
    to.searchParams.set("error", code);
    if (!linking && saved?.next && saved.next !== "/") to.searchParams.set("next", saved.next);
    return NextResponse.redirect(to);
  };

  const provider = getProvider(id);
  if (!provider) return fail("provider_disabled");

  // The person pressed "Cancel" on the provider's page.
  if (url.searchParams.get("error")) return fail("cancelled");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!saved || saved.provider !== id || !code || !state || !tokenMatches(state, saved.state)) {
    return fail("state_mismatch");
  }

  const ip = clientIp(await headers()) ?? "unknown";
  const rl = await rateLimit(`rl:oauth:${ip}`, 30, 900);
  if (!rl.ok) return fail("rate_limited");

  try {
    const token = await provider.exchange(code, saved.verifier, redirectUri(provider.id));
    const profile = await provider.profile(token);

    if (linking) {
      const user = await currentUser();
      if (!user) return NextResponse.redirect(new URL("/login?next=%2Faccount%2Fsettings", config.siteUrl));
      await connectToUser(user.id, id as ProviderId, profile);
      return NextResponse.redirect(new URL(`/account/settings?connected=${id}`, config.siteUrl));
    }

    const userId = await userForSignIn(id as ProviderId, profile);
    await createSession(userId);
    return NextResponse.redirect(new URL(saved.next || "/", config.siteUrl));
  } catch (err) {
    if (err instanceof OAuthError) {
      if (err.code === "provider_error") console.error(`[oauth] ${id}: ${err.message}`);
      return fail(err.code);
    }
    console.error(`[oauth] ${id}:`, err);
    return fail("server_error");
  }
}
