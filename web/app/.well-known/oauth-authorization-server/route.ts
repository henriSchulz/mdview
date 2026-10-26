// Where a client of the Model Context Protocol finds how to sign in here (RFC 8414): the app is
// its own authorization server, in front of GitHub (lib/mcp/oauth.ts).
import { NextResponse } from "next/server";
import { SCOPE } from "@/lib/mcp/oauth";
import { origin } from "@/lib/session";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const here = origin(request);
  return NextResponse.json({
    issuer: here,
    authorization_endpoint: `${here}/oauth/authorize`,
    token_endpoint: `${here}/oauth/token`,
    registration_endpoint: `${here}/oauth/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
