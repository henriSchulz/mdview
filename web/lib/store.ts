// What the server keeps about shared notes — the one thing it keeps at all. Not the notes: those
// stay in their repositories. Only which link belongs where, and how it is used:
//
//   shares/<id>  { state: "shared" | "reserved", repo: "<owner>/<repo>" (lower case), owner, name,
//                  path, password: whether one is set, created, seen: when it was last opened,
//                  opens: how often }
//
// It answers three things: where a link's id belongs (without reading every repository's list),
// which ids are free (one id is one note, across everyone's repositories), and — for the one who
// shares — what is shared and whether anyone looks at it (app/shares).
//
// On Firebase it is Firestore (lib/firestore.ts); elsewhere a Map in memory, which is all the
// tests and a developer's machine need.
import * as fs from "./firestore";

export type Share = { state: string; repo: string; owner: string; name: string; path: string; password: boolean; created: string; seen: string; opens: number };
const COLLECTION = "shares";
// (one Map for the whole server: its pages and routes are built apart, and each would have its own)
const memory: Map<string, Share> = ((globalThis as unknown as { __mdviewShares?: Map<string, Share> }).__mdviewShares ??= new Map());
const blank: Share = { state: "shared", repo: "", owner: "", name: "", path: "", password: false, created: "", seen: "", opens: 0 };
const asShare = (p: fs.Plain | null): Share | null => (p ? { ...blank, ...(p as Partial<Share>) } : null);
export const repoKey = (owner: string, repo: string) => `${owner}/${repo}`.toLowerCase();

export async function getShare(id: string): Promise<Share | null> {
  return fs.here() ? asShare(await fs.get(COLLECTION, id)) : memory.get(id) || null;
}
/** What is known of a share written down: made if it is new (its count of openings kept if not). */
export async function putShare(id: string, s: Pick<Share, "owner" | "name" | "path" | "password" | "created">): Promise<void> {
  const data = { state: "shared", repo: repoKey(s.owner, s.name), owner: s.owner, name: s.name, path: s.path, password: s.password, created: s.created };
  // (an id is one note's: a repository that names an id another one shares under does not take the link over)
  const had = await getShare(id);
  if (had && had.state === "shared" && had.repo && had.repo !== data.repo) return;
  if (fs.here()) return fs.set(COLLECTION, id, data);
  memory.set(id, { ...blank, ...(memory.get(id) || {}), ...data });
}
export async function dropShare(id: string): Promise<void> {
  if (fs.here()) return fs.remove(COLLECTION, id);
  memory.delete(id);
}
/** An id kept for a share that is about to be made — only if nothing has it. → whether it is this caller's now. */
export async function reserve(id: string): Promise<boolean> {
  const data = { state: "reserved", created: new Date().toISOString() };
  if (fs.here()) return fs.create(COLLECTION, id, data);
  if (memory.has(id)) return false;
  memory.set(id, { ...blank, ...data });
  return true;
}
/** The shares of some repositories ("owner/repo"): [id, share]. */
export async function sharesOf(repos: string[]): Promise<[string, Share][]> {
  const keys = [...new Set(repos.map((r) => r.toLowerCase()))];
  if (!fs.here()) return [...memory].filter(([, s]) => s.state === "shared" && keys.includes(s.repo));
  const out: [string, Share][] = [];
  for (let i = 0; i < keys.length; i += 30) for (const [id, p] of await fs.where(COLLECTION, "repo", keys.slice(i, i + 30))) { const s = asShare(p); if (s && s.state === "shared") out.push([id, s]); }
  return out;
}
/** How many notes are shared, everyone's together. */
export async function countShares(): Promise<number> {
  return fs.here() ? fs.count(COLLECTION, "state", "shared") : [...memory.values()].filter((s) => s.state === "shared").length;
}
/** A link was opened: counted, and when. */
export async function opened(id: string): Promise<void> {
  const seen = new Date().toISOString();
  if (fs.here()) return fs.bump(COLLECTION, id, "opens", { seen });
  const s = memory.get(id);
  if (s) memory.set(id, { ...s, seen, opens: s.opens + 1 });
}
