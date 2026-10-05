// Nothing of the app without signing in: every request without a session goes to the sign-in
// page. Whether the session still holds is the pages' and routes' to find out (lib/session.ts);
// here only its absence is seen.
import { NextResponse, type NextRequest } from "next/server";

const OPEN = ["/signin", "/auth/login", "/auth/callback"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN.includes(pathname) || request.cookies.has("mdview")) return NextResponse.next();
  const to = request.nextUrl.clone();
  to.pathname = "/signin";
  to.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(to);
}

export const config = {
  // (not the framework's own files, nor the page's scripts and styles: they hold no notes)
  matcher: ["/((?!_next/|app/|favicon.ico).*)"],
};
