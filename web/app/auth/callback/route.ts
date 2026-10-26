// Back from GitHub with a code: exchanged for tokens (with the app's secret), the user asked for,
// the session written. Anything that does not fit — no sign-in under way, another state, GitHub
// saying no — ends at the sign-in page with a word why. A sign-in for a client of the Model
// Context Protocol (oauth/authorize) writes no session: the client is sent its code instead.
import { NextResponse } from "next/server";
import { exchange, user } from "@/lib/github";
import { COOKIE, cookieOptions, origin, PENDING, seal, unseal } from "@/lib/session";
import { cookies } from "next/headers";
import { back as toClient, codeFor, type Grant } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const here = origin(request), q = new URL(request.url).searchParams;
  const back = (why: string) => {
    const res = NextResponse.redirect(`${here}/signin?why=${encodeURIComponent(why)}`);
    res.cookies.delete(PENDING);
    return res;
  };
  const pending = await unseal<{ state: string; verifier: string; next: string; mcp?: Grant }>((await cookies()).get(PENDING)?.value);
  if (!pending) return back("expired");
  if (pending.mcp && q.get("error")) {
    const res = NextResponse.redirect(toClient(pending.mcp.redirect, { error: "access_denied", state: pending.mcp.state }));
    res.cookies.delete(PENDING);
    return res;
  }
  if (q.get("error")) return back(q.get("error") === "access_denied" ? "denied" : "github");
  const code = q.get("code");
  if (!code || q.get("state") !== pending.state) return back("mismatch");
  try {
    const tokens = await exchange(code, `${here}/auth/callback`, pending.verifier);
    const who = await user(tokens.access);
    if (pending.mcp) {
      const res = NextResponse.redirect(toClient(pending.mcp.redirect, { code: await codeFor(pending.mcp, tokens, who), state: pending.mcp.state }));
      res.cookies.delete(PENDING);
      return res;
    }
    const session = { ...tokens, ...who };
    const left = Math.max(60, session.refreshExpires - Math.floor(Date.now() / 1000));
    const res = NextResponse.redirect(`${here}${pending.next}`);
    res.cookies.set(COOKIE, await seal(session, left), cookieOptions(left));
    res.cookies.delete(PENDING);
    return res;
  } catch {
    return back("github");
  }
}
