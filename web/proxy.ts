// Nothing of the app without signing in: every request without a session goes to the sign-in
// page — but the address itself, which shows the welcome page then (app/welcome), sample notes and all. Whether the session still holds is the pages' and routes' to find out (lib/session.ts);
// here only its absence is seen.
import { NextResponse, type NextRequest } from "next/server";

const OPEN = ["/signin", "/auth/login", "/auth/callback"];
const OWN = ["shares", "signin", "auth", "api", "file", "r", "s", "share", "app", "host", "welcome"]; // the app's own names at the top: never a shared note's id

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN.includes(pathname) || request.cookies.has("mdview")) return NextResponse.next();
  if (pathname === "/welcome" || pathname.startsWith("/welcome/")) return NextResponse.next(); // (the welcome page and what it is made of: nobody's notes)
  if (pathname === "/") { const to = request.nextUrl.clone(); to.pathname = "/welcome"; return NextResponse.rewrite(to); }
  // a shared note, /<id> and /<id>/raw: for whoever has the link — it guards itself (app/[id])
  if (/^\/[A-Za-z0-9_-]{1,64}(\/raw)?$/.test(pathname) && !OWN.includes(pathname.split("/")[1])) return NextResponse.next();
  const to = request.nextUrl.clone();
  to.pathname = "/signin";
  to.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(to);
}

export const config = {
  // (not the framework's own files, nor the page's scripts and styles: they hold no notes — and
  // not a shared note, /s/…, nor the id for a new one, /share/…: those are for whoever has the
  // link, and guard themselves)
  matcher: ["/((?!_next/|app/|host/|s/|share/|favicon.ico).*)"],
};
