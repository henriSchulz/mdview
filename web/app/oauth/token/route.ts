// A client's code for its tokens, and a refresh token for new ones (OAuth 2.1, public clients: the
// code's verifier proves it is the client that asked).
import { NextResponse } from "next/server";
import { redeem, refreshed, resourceOf, tokensFor } from "@/lib/mcp/oauth";
import { origin } from "@/lib/session";

export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
const no = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: CORS });

export async function POST(request: Request) {
  const type = request.headers.get("content-type") || "";
  const q = type.includes("application/json") ? new URLSearchParams(Object.entries((await request.json().catch(() => ({}))) as Record<string, string>)) : new URLSearchParams(await request.text());
  const client = q.get("client_id") || "", aud = resourceOf(origin(request));
  if (q.get("resource") && q.get("resource") !== aud) return no("invalid_target");
  try {
    if (q.get("grant_type") === "authorization_code") {
      const got = await redeem(q.get("code") || "", client, q.get("redirect_uri") || "", q.get("code_verifier") || "");
      return got ? NextResponse.json(await tokensFor(client, aud, got.gh, got.who), { headers: CORS }) : no("invalid_grant");
    }
    if (q.get("grant_type") === "refresh_token") {
      const got = await refreshed(q.get("refresh_token") || "", client);
      return got ? NextResponse.json(await tokensFor(client, got.aud, got.gh, got.who), { headers: CORS }) : no("invalid_grant");
    }
    return no("unsupported_grant_type");
  } catch {
    return no("temporarily_unavailable", 503); // (GitHub not reached)
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
}
