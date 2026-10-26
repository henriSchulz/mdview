// Bugs reported and features asked for: a form anyone may send, signed in or not (app/feedback),
// and a list only Henri sees (app/feedback/inbox). Kept by the server, beside the shared notes'
// links and the pasteboards — and each also an issue of the app's repository on GitHub (FEEDBACK_REPO),
// opened by the GitHub App: GitHub e-mails Henri about it, and Claude's action sorts it
// (.github/workflows/claude.yml). That repository is public: the issue has the kind, the title, the
// description, the platform and the version — never the e-mail, the user agent or the account.
//
//   feedback/<id>  { kind: "bug" | "feature", title, body (Markdown, kept and shown as plain text),
//                    email, platform, version, agent (the browser's user agent), login (the GitHub
//                    account, where the sender was signed in), status: "open" | "done", created,
//                    issue (the issue's number; 0 while there is none) }
//
// What keeps it from being a bin for spam: a field no person sees (whoever fills it in is told
// thanks and nothing is kept), lengths, a check of every field here on the server, and a few
// sendings an hour from one address. Those counts are kept in memory: the app runs as one
// instance (apphosting.yaml), so they are the whole truth — a restart forgets them, which costs
// nothing.
//
// On Firebase it is Firestore (lib/firestore.ts); elsewhere a Map in memory.
import { randomBytes } from "node:crypto";
import { repoToken } from "./app";
import * as fs from "./firestore";

export const KINDS = ["bug", "feature"] as const;
export const PLATFORMS = ["Web", "iPad", "Desktop Linux", "Desktop Windows", "Desktop macOS"] as const;
export const LIMITS = { title: 120, body: 8000, email: 200, version: 120, agent: 400 };
export const MIN = { title: 3, body: 10 };
export type Kind = (typeof KINDS)[number];
export type Entry = { kind: Kind; title: string; body: string; email: string; platform: string; version: string; agent: string; login: string; status: "open" | "done"; created: string; issue?: number };

const COLLECTION = "feedback";
const OWNER = Number(process.env.FEEDBACK_OWNER_ID || 89314140); // GitHub's id of @henriSchulz (an id stays when a login is renamed — and a login given up can be taken by someone else)
const PER_HOUR = Number(process.env.FEEDBACK_PER_HOUR || 5); // from one address
const ALL_PER_HOUR = Number(process.env.FEEDBACK_ALL_PER_HOUR || 60); // from everyone together: what is left when addresses are made up
const HOUR = 60 * 60_000;
const ISSUES = (process.env.FEEDBACK_REPO || "henriSchulz/mdview").split("/"); // where each one is also an issue
const API = process.env.GITHUB_API || "https://api.github.com";

type Kept = { memory: Map<string, Entry>; sent: Map<string, number[]>; all: number[] };
// (one for the whole server: its routes are built apart, and each would have its own)
const kept: Kept = ((globalThis as unknown as { __mdviewFeedback?: Kept }).__mdviewFeedback ??= { memory: new Map(), sent: new Map(), all: [] });

/** Whether this is the one who reads what was sent. */
export const isOwner = (who: { id?: number } | null | undefined) => !!who && Number(who.id) === OWNER;

// ------------------------------------------------------------ what was sent, checked

// (control characters out — a line break and a tab stay where text may have lines)
const clean = (v: unknown, lines: boolean) => (typeof v === "string" ? v.replace(lines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim() : "");
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export type Checked = { ok: true; entry: Omit<Entry, "login" | "status" | "created" | "agent"> } | { ok: false; field: string; error: string };

/** A sending as the form makes it, checked field by field. */
export function check(said: Record<string, unknown>): Checked {
  const kind = said.kind;
  if (kind !== "bug" && kind !== "feature") return { ok: false, field: "kind", error: "Choose Bug or Feature." };
  const title = clean(said.title, false), body = clean(said.body, true), email = clean(said.email, false), version = clean(said.version, false);
  const platform = typeof said.platform === "string" && (PLATFORMS as readonly string[]).includes(said.platform) ? said.platform : "";
  if (said.platform && !platform) return { ok: false, field: "platform", error: "Choose a platform from the list." };
  if (title.length < MIN.title) return { ok: false, field: "title", error: "Give it a title." };
  if (title.length > LIMITS.title) return { ok: false, field: "title", error: `The title is longer than ${LIMITS.title} characters.` };
  if (body.length < MIN.body) return { ok: false, field: "body", error: kind === "bug" ? "Say what happened, in a sentence or two." : "Say what you would like, in a sentence or two." };
  if (body.length > LIMITS.body) return { ok: false, field: "body", error: `The description is longer than ${LIMITS.body} characters.` };
  if (email && (email.length > LIMITS.email || !EMAIL.test(email))) return { ok: false, field: "email", error: "That is not an e-mail address." };
  if (version.length > LIMITS.version) return { ok: false, field: "version", error: `Version and browser: at most ${LIMITS.version} characters.` };
  return { ok: true, entry: { kind, title, body, email, platform, version } };
}

/** Whether one more may be sent from this address now — counted if so. */
export function allowed(address: string): boolean {
  const now = Date.now(), fresh = (list: number[]) => list.filter((t) => now - t < HOUR);
  kept.all = fresh(kept.all);
  const mine = fresh(kept.sent.get(address) || []);
  if (mine.length >= PER_HOUR || kept.all.length >= ALL_PER_HOUR) { kept.sent.set(address, mine); return false; }
  mine.push(now);
  kept.all.push(now);
  kept.sent.set(address, mine);
  if (kept.sent.size > 5000) for (const [a, l] of kept.sent) if (!fresh(l).length) kept.sent.delete(a);
  return true;
}

/** Who sends, as the address the request came from (the first the proxies in front name). */
export function addressOf(request: Request): string {
  const h = request.headers;
  return (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

// ------------------------------------------------------------ kept

const asEntry = (p: fs.Plain): Entry => ({ kind: p.kind === "feature" ? "feature" : "bug", title: String(p.title ?? ""), body: String(p.body ?? ""), email: String(p.email ?? ""), platform: String(p.platform ?? ""), version: String(p.version ?? ""), agent: String(p.agent ?? ""), login: String(p.login ?? ""), status: p.status === "done" ? "done" : "open", created: String(p.created ?? ""), issue: Number(p.issue) || 0 });

export async function add(entry: Entry): Promise<string> {
  const id = `${Date.now().toString(36)}-${randomBytes(6).toString("base64url")}`;
  if (fs.here()) await fs.create(COLLECTION, id, entry);
  else kept.memory.set(id, entry);
  return id;
}
/** Everything sent, newest first (at most 500). */
export async function list(): Promise<[string, Entry][]> {
  if (fs.here()) return (await fs.newest(COLLECTION, "created", 500)).map(([id, p]) => [id, asEntry(p)]);
  return [...kept.memory].reverse().sort((a, b) => b[1].created.localeCompare(a[1].created));
}
export async function mark(id: string, status: "open" | "done"): Promise<boolean> {
  if (fs.here()) { if (!(await fs.get(COLLECTION, id))) return false; await fs.set(COLLECTION, id, { status }); return true; }
  const had = kept.memory.get(id);
  if (!had) return false;
  kept.memory.set(id, { ...had, status });
  return true;
}
export async function drop(id: string): Promise<void> {
  if (fs.here()) return fs.remove(COLLECTION, id);
  kept.memory.delete(id);
}

// ------------------------------------------------------------ as an issue on GitHub

/** The issue a sending becomes: what may be public of it, the description as it was written —
 * in a fence longer than any run of backticks in it, so that it is shown as text, as the inbox
 * shows it (no picture loaded from elsewhere, no one named with an @ told of it). */
export function asIssue(entry: Pick<Entry, "kind" | "title" | "body" | "platform" | "version">): { title: string; body: string; labels: string[] } {
  const fence = "`".repeat(Math.max(3, ...[...entry.body.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  const about = [entry.kind === "bug" ? "Bug" : "Feature", entry.platform, entry.version].filter(Boolean).map((v) => v.replace(/[`*_[\]<>@#|\\]/g, (c) => "\\" + c)).join(" · ");
  return {
    title: entry.title,
    body: `${about}\n\n${fence}text\n${entry.body}\n${fence}\n\n<sub>Sent with the feedback form of the web app.</sub>\n`,
    labels: [entry.kind === "bug" ? "bug" : "enhancement", "feedback"],
  };
}

/** Opens the issue for a sending kept under `id`, as the GitHub App, and keeps its number with it.
 * The number, or 0 where the app has no key here or may not open issues there (it is kept all the
 * same: the inbox has it). */
export async function file(id: string, entry: Entry): Promise<number> {
  const [owner, repo] = ISSUES;
  const token = await repoToken(owner, repo, { issues: "write" }).catch(() => null);
  if (!token) return 0;
  const res = await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
    method: "POST", cache: "no-store", body: JSON.stringify(asIssue(entry)),
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "mdview-web", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`GitHub: ${res.status} for the issue`);
  const issue = Number(((await res.json()) as { number?: number }).number) || 0;
  if (fs.here()) await fs.set(COLLECTION, id, { issue });
  else { const had = kept.memory.get(id); if (had) kept.memory.set(id, { ...had, issue }); }
  return issue;
}
/** The issue's address on GitHub. */
export const issueAt = (n: number) => `https://github.com/${ISSUES[0]}/${ISSUES[1]}/issues/${n}`;
