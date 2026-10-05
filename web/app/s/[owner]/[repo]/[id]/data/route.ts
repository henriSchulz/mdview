// What a shared note's page shows: its text, and where its links and embeds lead — only those
// that go with it have an address.
import { NextResponse } from "next/server";
import { gate } from "../gate";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ owner: string; repo: string; id: string }> }) {
  const { owner, repo, id } = await params;
  const g = await gate(owner, repo, id);
  if (!g.shared) return NextResponse.json({ error: g.why }, { status: g.why === "unreachable" ? 502 : 404 });
  if (!g.open) return NextResponse.json({ error: "password" }, { status: 401 });
  const s = g.shared;
  // (a link to a file that does not go with the note is told as leading nowhere to be fetched)
  const links = Object.fromEntries(Object.entries(s.links).map(([k, l]) => [k, l && { ...l, shared: s.files.has(l.path.split("/").slice(3).join("/")) }]));
  return NextResponse.json({ path: `/${owner}/${repo}/${s.path}`, text: s.text, links, vault: s.vault }, { headers: { "Cache-Control": "no-store" } });
}
