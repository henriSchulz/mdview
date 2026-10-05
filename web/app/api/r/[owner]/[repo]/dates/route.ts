// When files were last changed: { head, paths: [...] } → { dates: { path: seconds } } — for each
// path the time of the last commit, up to `head`, that changed it. Git keeps no date for a file;
// this is what stands in for one. (A path with no such commit is left out.)
import { NextResponse } from "next/server";
import { dates, Refused } from "@/lib/github";
import { fresh } from "@/lib/session";

export const dynamic = "force-dynamic";
const MOST = 200; // paths in one request

export async function POST(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  try {
    const session = await fresh();
    if (!session) return NextResponse.json({ error: "signin" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { head?: unknown; paths?: unknown } | null;
    if (!body || typeof body.head !== "string" || !/^[0-9a-f]{40,64}$/.test(body.head)) return NextResponse.json({ error: "malformed" }, { status: 400 });
    const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length < 1000).slice(0, MOST) : [];
    return NextResponse.json({ dates: await dates(session.access, owner, repo, body.head, paths) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof Refused) return NextResponse.json({ error: "signin" }, { status: 401 });
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
