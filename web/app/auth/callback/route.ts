// Back from GitHub with a code: exchanged for tokens (with the app's secret), the user asked for,
// the session written. Anything that does not fit — no sign-in under way, another state, GitHub
// saying no — ends at the sign-in page with a word why.
import { NextResponse } from "next/server";
import { exchange, user } from "@/lib/github";
import { COOKIE, cookieOptions, origin, PENDING, seal, unseal } from "@/lib/session";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const here = origin(request), q = new URL(request.url).searchParams;
  const back = (why: string) => {
    const res = NextResponse.redirect(`${here}/signin?why=${encodeURIComponent(why)}`);
    res.cookies.delete(PENDING);
    return res;
  };
  const pending = await unseal<{ state: string; verifier: string; next: string }>((await cookies()).get(PENDING)?.value);
  if (!pending) return back("expired");
  if (q.get("error")) return back(q.get("error") === "access_denied" ? "denied" : "github");
  const code = q.get("code");
  if (!code || q.get("state") !== pending.state) return back("mismatch");
  try {
    const tokens = await exchange(code, `${here}/auth/callback`, pending.verifier);
    const session = { ...tokens, ...(await user(tokens.access)) };
    const left = Math.max(60, session.refreshExpires - Math.floor(Date.now() / 1000));
    const res = NextResponse.redirect(`${here}${pending.next}`);
    res.cookies.set(COOKIE, await seal(session, left), cookieOptions(left));
    res.cookies.delete(PENDING);
    return res;
  } catch {
    return back("github");
  }
}
