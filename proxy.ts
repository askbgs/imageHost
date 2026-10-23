import { NextResponse, type NextRequest } from "next/server";

// HTTP Basic auth in front of the moderation area (pages and their server actions).
export function proxy(req: NextRequest) {
  const user = process.env.ADMIN_USER || "admin";
  const password = process.env.ADMIN_PASSWORD || "";
  if (!password) {
    return new NextResponse("Admin is disabled: set ADMIN_PASSWORD.", { status: 503 });
  }

  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    const [u, ...rest] = atob(header.slice(6)).split(":");
    if (u === user && rest.join(":") === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="imghost admin", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
