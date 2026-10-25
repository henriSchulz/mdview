// A bug reported or a feature asked for (lib/feedback.ts), by anyone, signed in or not.
//
//   POST { kind, title, body, email?, platform?, version?, website: (the field nobody sees) }
//        → { ok: true } — 400 { field, error } where a field does not fit, 429 after too many
import { NextResponse } from "next/server";
import { add, addressOf, allowed, check, LIMITS } from "@/lib/feedback";
import { read } from "@/lib/session";

export const dynamic = "force-dynamic";
const say = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const text = await request.text().catch(() => "");
  if (text.length > 20_000) return say({ field: "body", error: "That is too long to send." }, 413);
  let said: Record<string, unknown>;
  try { said = JSON.parse(text); } catch { return say({ error: "Nothing could be read." }, 400); }
  if (!said || typeof said !== "object" || Array.isArray(said)) return say({ error: "Nothing could be read." }, 400);
  const checked = check(said);
  if (!checked.ok) return say({ field: checked.field, error: checked.error }, 400);
  const address = addressOf(request);
  // (the field nobody sees, filled in: thanks all the same — and nothing kept)
  if (typeof said.website === "string" && said.website.trim()) { allowed(address); return say({ ok: true }); }
  if (!allowed(address)) return say({ error: "That is a lot at once. Try again in an hour." }, 429);
  let login = "";
  try { login = (await read())?.login || ""; } catch { /* (no session to be read) */ }
  try {
    await add({ ...checked.entry, agent: (request.headers.get("user-agent") || "").slice(0, LIMITS.agent), login, status: "open", created: new Date().toISOString() });
  } catch {
    return say({ error: "It could not be kept just now. Try again in a moment." }, 502);
  }
  return say({ ok: true });
}
