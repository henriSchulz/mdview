// Bugs reported and features asked for: a form anyone may send, signed in or not (app/feedback),
// and a list only Henri sees (app/feedback/inbox). Kept by the server, beside the shared notes'
// links and the pasteboards — never in a repository, never on GitHub.
//
//   feedback/<id>  { kind: "bug" | "feature", title, body (Markdown, kept and shown as plain text),
//                    email, platform, version, agent (the browser's user agent), login (the GitHub
//                    account, where the sender was signed in), status: "open" | "done", created }
//
// What keeps it from being a bin for spam: a field no person sees (whoever fills it in is told
// thanks and nothing is kept), lengths, a check of every field here on the server, and a few
// sendings an hour from one address. Those counts are kept in memory: the app runs as one
// instance (apphosting.yaml), so they are the whole truth — a restart forgets them, which costs
// nothing.
//
// On Firebase it is Firestore (lib/firestore.ts); elsewhere a Map in memory.
import { randomBytes } from "node:crypto";
import * as fs from "./firestore";

export const KINDS = ["bug", "feature"] as const;
export const PLATFORMS = ["Web", "iPad", "Desktop Linux", "Desktop Windows", "Desktop macOS"] as const;
export const LIMITS = { title: 120, body: 8000, email: 200, version: 120, agent: 400 };
export const MIN = { title: 3, body: 10 };
export type Kind = (typeof KINDS)[number];
export type Entry = { kind: Kind; title: string; body: string; email: string; platform: string; version: string; agent: string; login: string; status: "open" | "done"; created: string };

const COLLECTION = "feedback";
const OWNER = Number(process.env.FEEDBACK_OWNER_ID || 89314140); // GitHub's id of @henriSchulz (an id stays when a login is renamed — and a login given up can be taken by someone else)
const PER_HOUR = Number(process.env.FEEDBACK_PER_HOUR || 5); // from one address
const ALL_PER_HOUR = Number(process.env.FEEDBACK_ALL_PER_HOUR || 60); // from everyone together: what is left when addresses are made up
const HOUR = 60 * 60_000;

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

const asEntry = (p: fs.Plain): Entry => ({ kind: p.kind === "feature" ? "feature" : "bug", title: String(p.title ?? ""), body: String(p.body ?? ""), email: String(p.email ?? ""), platform: String(p.platform ?? ""), version: String(p.version ?? ""), agent: String(p.agent ?? ""), login: String(p.login ?? ""), status: p.status === "done" ? "done" : "open", created: String(p.created ?? "") });

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
