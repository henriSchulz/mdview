// The same, asked for by the desktop app, which has no session here: "this repository's list of
// shares has changed". The server reads the list itself, as the GitHub App — so nothing can be
// told to it that the repository does not say — and not more often than every few seconds a
// repository.
import { NextResponse } from "next/server";
import { repoToken, sharing } from "@/lib/app";
import { syncRepo } from "@/lib/share";

export const dynamic = "force-dynamic";
const asked = new Map<string, number>();

export async function POST(_: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  if (!sharing()) return NextResponse.json({ error: "off" }, { status: 404 });
  const key = `${owner}/${repo}`.toLowerCase(), now = Date.now();
  if (now - (asked.get(key) || 0) < Number(process.env.SHARE_LOOK_MS ?? 5000)) return NextResponse.json({ error: "soon" }, { status: 429 });
  asked.set(key, now);
  if (asked.size > 5000) asked.clear();
  try {
    const token = await repoToken(owner, repo);
    if (!token) return NextResponse.json({ error: "gone" }, { status: 404 });
    return NextResponse.json({ shared: await syncRepo(owner, repo, token) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
