// A project's pasteboard (lib/paste.ts), for whoever may write to its repository: the page's
// host in the browser, by its session — and the desktop app, which has no session here, by the
// token of its own sign-in with GitHub (the same GitHub App; the token is asked about once and
// then remembered for a few minutes by its hash, never kept).
//
//   GET  ?rev=<n>&wait=1  what stands there — with wait, only once it is not rev n any more
//                         (or after a while, as it is: the asker asks again)
//   PUT  { text, base }   written, if rev `base` stands there: { rev } — else 409 with what does
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { Refused, writes } from "@/lib/github";
import { changed, MAX, read, write } from "@/lib/paste";
import { fresh } from "@/lib/session";

export const dynamic = "force-dynamic";
const WAIT = Number(process.env.PASTE_WAIT_MS ?? 25_000);
const may = new Map<string, { ok: boolean; until: number }>();
const say = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Who asks, if they may: the name a writing is signed with. null: not signed in; false: not theirs. */
async function who(request: Request, owner: string, repo: string): Promise<string | null | false> {
  const bearer = /^Bearer (\S+)$/.exec(request.headers.get("authorization") || "")?.[1];
  const session = bearer ? null : await fresh();
  const access = bearer || session?.access;
  if (!access) return null;
  const key = createHash("sha256").update(`${access}\n${owner}/${repo}`.toLowerCase()).digest("base64");
  let known = may.get(key);
  if (!known || known.until < Date.now()) {
    known = { ok: await writes(access, owner, repo), until: Date.now() + 5 * 60_000 };
    if (may.size > 5000) may.clear();
    may.set(key, known);
  }
  return known.ok ? session?.login || "" : false;
}
async function guarded(request: Request, params: Promise<{ owner: string; repo: string }>, then: (owner: string, repo: string, by: string) => Promise<NextResponse>) {
  const { owner, repo } = await params;
  try {
    const by = await who(request, owner, repo);
    if (by === null) return say({ error: "signin" }, 401);
    if (by === false) return say({ error: "missing" }, 404);
    return await then(owner, repo, by);
  } catch (e) {
    if (e instanceof Refused) return say({ error: "signin" }, 401);
    return say({ error: "unreachable" }, 502);
  }
}

export function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  return guarded(request, params, async (owner, repo) => {
    const asked = new URL(request.url).searchParams, rev = Number(asked.get("rev"));
    let now = await read(owner, repo);
    if (asked.get("wait") && now.rev === rev) {
      await changed(owner, repo, rev, WAIT, request.signal);
      now = await read(owner, repo);
    }
    return say(now);
  });
}

export function PUT(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  return guarded(request, params, async (owner, repo, by) => {
    const said = (await request.json().catch(() => null)) as { text?: unknown; base?: unknown; by?: unknown } | null;
    if (!said || typeof said.text !== "string" || !Number.isInteger(said.base)) return say({ error: "bad" }, 400);
    if (said.text.length > MAX) return say({ error: "large", max: MAX }, 413);
    const name = [by, typeof said.by === "string" ? said.by.slice(0, 80) : ""].filter(Boolean).join(" · ");
    const { done, now } = await write(owner, repo, said.text, said.base as number, name);
    return done ? say({ rev: now.rev, at: now.at, by: now.by }) : say(now, 409);
  });
}
