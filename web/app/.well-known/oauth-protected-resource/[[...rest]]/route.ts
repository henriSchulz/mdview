// What the protocol's endpoint is and who signs in for it (RFC 9728) — asked at this address, and
// at it with the endpoint's path after it (/.well-known/oauth-protected-resource/mcp).
import { NextResponse } from "next/server";
import { resourceOf, SCOPE } from "@/lib/mcp/oauth";
import { origin } from "@/lib/session";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const here = origin(request);
  return NextResponse.json({ resource: resourceOf(here), authorization_servers: [here], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "Markdown Notes" }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
