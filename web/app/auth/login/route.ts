// "Sign in with GitHub": the user is sent to GitHub. What must come back from there (state), and
// what proves the return is this browser's (PKCE's verifier), wait in a short-lived cookie.
import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/github";
import { challengeOf, cookieOptions, origin, PENDING, random, safePath, seal } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const state = random(16), verifier = random(48);
  const next = safePath(new URL(request.url).searchParams.get("next"));
  const res = NextResponse.redirect(authorizeUrl(`${origin(request)}/auth/callback`, state, challengeOf(verifier)));
  res.cookies.set(PENDING, await seal({ state, verifier, next }, 600), cookieOptions(600));
  return res;
}
