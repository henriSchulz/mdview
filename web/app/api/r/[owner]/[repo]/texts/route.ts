// The text of notes, by the ids of their blobs: { shas: [...] } → { texts: { sha: text | null } }.
// A blob never changes, so what is answered can be kept by the browser for good.
import { NextResponse } from "next/server";
import { Refused, texts } from "@/lib/github";
import { fresh } from "@/lib/session";

export const dynamic = "force-dynamic";
const MOST = 400; // blobs in one request

export async function POST(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  try {
    const session = await fresh();
    if (!session) return NextResponse.json({ error: "signin" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { shas?: unknown } | null;
    const shas = Array.isArray(body?.shas) ? body.shas.filter((s): s is string => typeof s === "string").slice(0, MOST) : [];
    return NextResponse.json({ texts: await texts(session.access, owner, repo, shas) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof Refused) return NextResponse.json({ error: "signin" }, { status: 401 });
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
