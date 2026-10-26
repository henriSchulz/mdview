// The user's answer to a client (authorize/page.tsx). No: the client is told so. Yes: up to GitHub
// for tokens of the client's own — what is under way waits in the sign-in's cookie, and the way
// back is the sign-in's own (auth/callback), which hands the client its code.
import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/github";
import { askedFor, back, PENDING_LIFE, resourceOf } from "@/lib/mcp/oauth";
import { challengeOf, cookieOptions, origin, PENDING, random, seal } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const here = origin(request);
  // (only this app's own page answers: a form on another site cannot say yes for the user)
  if (request.headers.get("origin") !== here) return new NextResponse("Not allowed", { status: 403 });
  const form = await request.formData(), q = new URLSearchParams();
  for (const k of ["client_id", "redirect_uri", "state", "code_challenge"]) q.set(k, String(form.get(k) || ""));
  q.set("response_type", "code");
  q.set("code_challenge_method", "S256");
  const asked = await askedFor(q, resourceOf(here));
  if ("error" in asked) return asked.redirect ? NextResponse.redirect(back(asked.redirect, { error: asked.error, state: asked.state || "" }), 303) : new NextResponse(asked.error, { status: 400 });
  if (form.get("answer") !== "allow") return NextResponse.redirect(back(asked.grant.redirect, { error: "access_denied", state: asked.grant.state }), 303);
  const state = random(16), verifier = random(48);
  const res = NextResponse.redirect(authorizeUrl(`${here}/auth/callback`, state, challengeOf(verifier)), 303);
  res.cookies.set(PENDING, await seal({ state, verifier, next: "/", mcp: asked.grant }, PENDING_LIFE), cookieOptions(PENDING_LIFE));
  return res;
}
