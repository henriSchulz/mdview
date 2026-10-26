// A client registers itself (RFC 7591): its name and where it may be sent back to, sealed into its
// id — nothing is kept here. Only public clients (PKCE, no secret).
import { NextResponse } from "next/server";
import { clientId, goodRedirect } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const redirects = Array.isArray(b?.redirect_uris) ? b.redirect_uris : [];
  if (!redirects.length || redirects.length > 10 || !redirects.every(goodRedirect)) return NextResponse.json({ error: "invalid_redirect_uri", error_description: "redirect_uris: https, or a loopback address" }, { status: 400, headers: CORS });
  const name = typeof b?.client_name === "string" && b.client_name.trim() ? b.client_name.trim().slice(0, 80) : "An application";
  return NextResponse.json({
    client_id: await clientId({ name, redirects: redirects as string[] }),
    client_name: name,
    redirect_uris: redirects,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }, { status: 201, headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
}
