// A file as a version has it: ?path=<path in the repository>&id=<commit> → { text }.
import { NextResponse } from "next/server";
import { raw, Refused } from "@/lib/github";
import { fresh } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const q = new URL(request.url).searchParams, path = q.get("path") || "", id = q.get("id") || "";
  if (!path || !/^[0-9a-f]{40,64}$/.test(id)) return NextResponse.json({ error: "malformed" }, { status: 400 });
  try {
    const session = await fresh();
    if (!session) return NextResponse.json({ error: "signin" }, { status: 401 });
    const res = await raw(session.access, owner, repo, path, null, id);
    if (!res.ok) return NextResponse.json({ text: null }, { status: res.status === 404 ? 200 : 502 });
    // (a commit never changes: what it has can be kept by the browser for good)
    return NextResponse.json({ text: await res.text() }, { headers: { "Cache-Control": "private, max-age=31536000, immutable" } });
  } catch (e) {
    return e instanceof Refused ? NextResponse.json({ error: "signin" }, { status: 401 }) : NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
