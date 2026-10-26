// The Model Context Protocol's endpoint (Streamable HTTP, without sessions: every request stands
// alone, and is answered as JSON). Who asks shows a token from this app's sign-in (lib/mcp/oauth.ts);
// without one, or with one GitHub takes no more, the answer says where to sign in (RFC 9728).
// What may be done: lib/mcp/tools.ts.
import { NextResponse } from "next/server";
import { Refused } from "@/lib/github";
import { bearer, resourceOf } from "@/lib/mcp/oauth";
import { call, TOOLS } from "@/lib/mcp/tools";
import { origin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]; // newest first
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id", "Cache-Control": "no-store" };
type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

function signIn(request: Request, why = "") {
  const here = origin(request);
  return new NextResponse(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Sign in with GitHub first" } }), {
    status: 401,
    headers: { ...CORS, "Content-Type": "application/json", "WWW-Authenticate": `Bearer resource_metadata="${here}/.well-known/oauth-protected-resource/mcp"${why ? `, error="${why}"` : ""}` },
  });
}

async function answer(m: Rpc, access: string): Promise<object | null> {
  const ok = (result: object) => ({ jsonrpc: "2.0", id: m.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return fail(-32600, "Not a request");
  if (m.id === undefined) return null; // (a notification: nothing to say back)
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion || "");
      return ok({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "mdview", title: "Markdown Notes", version: "1.0.0" },
        instructions: "The user's notes in Markdown Notes (mdview), kept in GitHub repositories: list_repositories first, then list_files, read_file, search_notes. Notes are Markdown with the app's own additions (callouts, [[wikilinks]], KaTeX, Mermaid); what is written is committed at once.",
      });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(m.params?.name || ""), args = (m.params?.arguments && typeof m.params.arguments === "object" ? m.params.arguments : {}) as Record<string, unknown>;
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `No tool ${name}`);
      return ok(await call(access, name, args));
    }
    default: return fail(-32601, `No method ${m.method}`);
  }
}

export async function POST(request: Request) {
  const who = await bearer(request.headers.get("authorization"), resourceOf(origin(request)));
  if (!who) return signIn(request, request.headers.get("authorization") ? "invalid_token" : "");
  const body = (await request.json().catch(() => undefined)) as Rpc | Rpc[] | undefined;
  if (body === undefined || body === null || typeof body !== "object") return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Not JSON" } }, { status: 400, headers: CORS });
  try {
    const all = Array.isArray(body) ? body : [body];
    const said = (await Promise.all(all.map((m) => answer(m, who.access).catch((e) => {
      if (e instanceof Refused) throw e;
      return { jsonrpc: "2.0", id: m.id ?? null, error: { code: -32603, message: String((e as Error).message || e) } };
    })))).filter(Boolean);
    if (!said.length) return new NextResponse(null, { status: 202, headers: CORS });
    return NextResponse.json(Array.isArray(body) ? said : said[0], { headers: CORS });
  } catch (e) {
    if (e instanceof Refused) return signIn(request, "invalid_token"); // (GitHub takes the token no more: the client renews it, or signs in again)
    throw e;
  }
}

// (no stream of the server's own to listen to, and no session to end)
export function GET() {
  return new NextResponse(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}
export const DELETE = GET;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "POST, GET, DELETE", "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id" } });
}
