import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE_NAME = process.env.NEXT_PUBLIC_AUTH_COOKIE_NAME || "spo_access_token";

export function middleware(request: NextRequest) {
  const hasAuthCookie = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);

  if (!hasAuthCookie) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/main/:path*", "/profile/:path*", "/study-room/:path*"],
};
