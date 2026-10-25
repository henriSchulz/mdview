// A new space (the list of notebooks' New Space): { space, device } → its repository, made on
// GitHub under the space's name as GitHub takes it (lib/reponame.ts), private, and made a notebook
// with its first commit — { name: "owner/repo" } — or why not: { error, name, why } (lib/github.ts:
// newSpace). The page opens the one made.
import { NextResponse } from "next/server";
import { newSpace, Refused } from "@/lib/github";
import { newName, repoName } from "@/lib/reponame";
import { fresh, origin } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // (only the app's own pages make one: a form on another site cannot send this for the signed-in user)
  if (request.headers.get("origin") !== origin(request)) return NextResponse.json({ error: "origin" }, { status: 403 });
  try {
    const session = await fresh();
    if (!session) return NextResponse.json({ error: "signin" }, { status: 401 });
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const space = typeof b?.space === "string" ? b.space.trim().slice(0, 200) : "";
    const device = typeof b?.device === "string" && /^[^\n\r]{1,200}$/.test(b.device) ? b.device : "";
    if (!space) return NextResponse.json({ error: "malformed" }, { status: 400 });
    // (a name with nothing GitHub takes in it: said, and nothing made)
    if (!repoName(space)) return NextResponse.json({ error: "invalid", name: newName(space) }, { headers: { "Cache-Control": "no-store" } });
    const made = await newSpace(session.access, newName(space), device);
    return NextResponse.json(made, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof Refused) return NextResponse.json({ error: "signin" }, { status: 401 });
    return NextResponse.json({ error: "failed", why: String((e as Error).message || e) }, { status: 502 });
  }
}
