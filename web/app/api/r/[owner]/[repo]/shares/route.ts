// A repository's list of shares was changed from here: the server writes down how it stands now
// (lib/store.ts) — where each link belongs, for opening it, and for the overview of what is shared.
import { NextResponse } from "next/server";
import { Refused } from "@/lib/github";
import { fresh, origin } from "@/lib/session";
import { syncRepo } from "@/lib/share";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  if (request.headers.get("origin") !== origin(request)) return NextResponse.json({ error: "origin" }, { status: 403 });
  try {
    const session = await fresh();
    if (!session) return NextResponse.json({ error: "signin" }, { status: 401 });
    return NextResponse.json({ shared: await syncRepo(owner, repo, session.access) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return e instanceof Refused ? NextResponse.json({ error: "signin" }, { status: 401 }) : NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
