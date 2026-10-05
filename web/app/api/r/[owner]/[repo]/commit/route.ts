// What was written in the browser, kept as one commit: { branch, expect, headline, body,
// additions: [{ path, text | base64 }], deletions: [path] } → { head }. Only if the branch still
// stands at `expect` — else 409, and the browser looks at what was written meanwhile first.
import { NextResponse } from "next/server";
import { commit, Moved, Refused } from "@/lib/github";
import { fresh, origin } from "@/lib/session";

export const dynamic = "force-dynamic";
const MOST = 20 * 1024 * 1024; // bytes in one commit (base64)
const FILES = 500;

// a path of the repository: no way out of it, nothing of Git's own
const good = (p: unknown): p is string => typeof p === "string" && p.length > 0 && p.length < 1000 && !p.startsWith("/") && !p.split("/").some((part) => part === "" || part === "." || part === ".." || part === ".git");

export async function POST(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  // (only the app's own pages write: a form on another site cannot send this for the signed-in user)
  if (request.headers.get("origin") !== origin(request)) return NextResponse.json({ error: "origin" }, { status: 403 });
  try {
    const session = await fresh();
    if (!session) return NextResponse.json({ error: "signin" }, { status: 401 });
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const additions = Array.isArray(b?.additions) ? (b.additions as Record<string, unknown>[]) : [], deletions = Array.isArray(b?.deletions) ? b.deletions : [];
    if (!b || typeof b.branch !== "string" || typeof b.expect !== "string" || !/^[0-9a-f]{40,64}$/.test(b.expect) || typeof b.headline !== "string" || !b.headline.trim()) return NextResponse.json({ error: "malformed" }, { status: 400 });
    if (additions.length + deletions.length === 0 || additions.length + deletions.length > FILES || !additions.every((a) => good(a.path) && (typeof a.text === "string" || typeof a.base64 === "string")) || !deletions.every(good)) return NextResponse.json({ error: "malformed" }, { status: 400 });
    const files = additions.map((a) => ({ path: a.path as string, contents: typeof a.text === "string" ? Buffer.from(a.text, "utf8").toString("base64") : (a.base64 as string) }));
    if (files.reduce((n, f) => n + f.contents.length, 0) > MOST) return NextResponse.json({ error: "large" }, { status: 413 });
    const head = await commit(session.access, owner, repo, b.branch, b.expect, b.headline.slice(0, 200), typeof b.body === "string" ? b.body.slice(0, 2000) : "", { additions: files, deletions: deletions as string[] });
    return NextResponse.json({ head }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof Moved) return NextResponse.json({ error: "moved" }, { status: 409 });
    if (e instanceof Refused) return NextResponse.json({ error: "signin" }, { status: 401 });
    return NextResponse.json({ error: "unreachable", why: String((e as Error).message || e) }, { status: 502 });
  }
}
