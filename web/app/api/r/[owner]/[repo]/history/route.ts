// The versions of a file, for the history's window: ?path=<path in the repository> →
// { versions: [{ id, time, device, subject, path }] }, newest first.
import { NextResponse } from "next/server";
import { Refused, versions } from "@/lib/github";
import { fresh } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const path = new URL(request.url).searchParams.get("path") || "";
  try {
    const session = await fresh();
    if (!session) return NextResponse.json({ error: "signin" }, { status: 401 });
    return NextResponse.json({ versions: path ? await versions(session.access, owner, repo, path) : [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return e instanceof Refused ? NextResponse.json({ error: "signin" }, { status: 401 }) : NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
