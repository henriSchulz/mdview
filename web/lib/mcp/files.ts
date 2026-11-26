// The files of a repository for a client of the Model Context Protocol: put there, moved, copied,
// deleted — each as one commit. What the app keeps about files beside them (.mdview: shares, folder
// looks, what is hidden, what was put into a note) follows as it does when the browser does the same
// (public/host/host.js: relocate, trash), with the same working out (public/host/core.js).
//
// A file's bytes are not something a model can well write down: a client with a shell asks for a link
// (uploadLink) and sends the file there as it is (app/mcp/upload).
import "../../public/host/core.js"; // (sets globalThis.MdWebCore, as for lib/share.ts)
import { commit, Denied, Gone, Moved, state, texts, type Change, type Entry } from "../github";
import { random } from "../session";
import { syncRepo } from "../share";

/* eslint-disable @typescript-eslint/no-explicit-any */
const C = (globalThis as any).MdWebCore;

export const MD = /\.(md|markdown|mdown|mkd|mkdn|mdx)$/i, BOARD = /\.board\.svg$/i, PDF = /\.pdf$/i;
export const kindOf = (p: string) => (BOARD.test(p) ? "whiteboard" : MD.test(p) ? "note" : PDF.test(p) ? "pdf" : "file");
export const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
// a path of the repository: no way out of it, nothing of Git's own (as app/api/r/…/commit)
export const good = (p: unknown): p is string => typeof p === "string" && p.length > 0 && p.length < 1000 && !p.startsWith("/") && !p.split("/").some((part) => part === "" || part === "." || part === ".." || part === ".git");
// … and one that files may be put at, moved or taken from: nothing hidden by its name — the app's own folder, GitHub's (.github: what runs there)
const open = (p: unknown): p is string => good(p) && !/[\x00-\x1f\\]/.test(p) && !p.split("/").some((part) => part.startsWith("."));
const OPEN = "a path in the repository, no part of it beginning with a dot";

export class Said400 extends Error {}
export const no = (why: string): never => { throw new Said400(why); };

// what no note may hold: refused, so the client writes it again by the rules
const MERMAID = /^\s*(`{3,}|~{3,})\s*mermaid\b/im;
export const noMermaid = (t: unknown) => { if (typeof t === "string" && MERMAID.test(t)) no("A mermaid fence is not allowed in a note: draw the figure as an svg fence (notes_guide, Formulas and figures) or leave it out."); };

export const DEVICE = "Device: Claude (MCP)\nClient: mcp";
export const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
export const UPLOAD_MOST = 20 * 1024 * 1024; // (what one commit takes, as the browser's: app/api/r/…/commit)
const LINK_LIFE = 600, LINKS_MOST = 200;

type At = { branch: string; head: string; tree: Entry[]; truncated: boolean };

/** One commit; if someone wrote meanwhile, once more on what is there now. */
export async function commitOnce(access: string, owner: string, repo: string, headline: string, make: (at: At) => Promise<Change> | Change) {
  for (let turn = 0; ; turn++) {
    const st = await state(access, owner, repo);
    if (!st) no(`${owner}/${repo} is not reachable any more.`);
    const at: At = st!.empty ? { branch: "main", head: "", tree: [], truncated: false } : { branch: st!.branch, head: st!.head, tree: st!.tree, truncated: st!.truncated };
    try {
      return await commit(access, owner, repo, at.branch, at.head, headline, DEVICE, await make(at));
    } catch (e) {
      if ((e instanceof Moved || e instanceof Gone) && turn === 0) continue;
      if (e instanceof Denied) no("GitHub does not let this account write to the repository.");
      throw e;
    }
  }
}

const isFolder = (tree: Entry[], p: string) => tree.some((f) => f.path.startsWith(p + "/"));
/** Nothing may stand in the way of a file at `p`: no folder of that name, no file where one of its folders would be. */
function room(tree: Entry[], p: string) {
  if (isFolder(tree, p)) no(`${p} is a folder.`);
  const parts = p.split("/");
  for (let i = 1; i < parts.length; i++) {
    const up = parts.slice(0, i).join("/");
    if (tree.some((f) => f.path === up)) no(`${up} is a file, not a folder.`);
  }
}

/** What stands at a path: the file, or all that is in the folder. */
function at(now: At, path: string): { folder: boolean; files: Entry[] } {
  const file = now.tree.find((f) => f.path === path);
  if (file) return { folder: false, files: [file] };
  const files = now.tree.filter((f) => f.path.startsWith(path + "/"));
  if (!files.length) no(`${path} is not there. list_files names what is.`);
  if (now.truncated) no("GitHub lists only part of this repository: a whole folder cannot be handled safely. Do it file by file.");
  return { folder: true, files };
}

// ------------------------------------------------------------ putting a file there

export async function put(access: string, owner: string, repo: string, path: string, bytes: Buffer, replace: boolean): Promise<{ made: boolean; head: string }> {
  if (bytes.length > UPLOAD_MOST) no(`Too large: ${UPLOAD_MOST / 1024 / 1024} MB at most.`);
  if (MD.test(path)) noMermaid(bytes.toString("utf8"));
  let made = true;
  const head = await commitOnce(access, owner, repo, nameOf(path), (now) => {
    const there = now.tree.some((f) => f.path === path);
    if (there && !replace) no(`${path} is there already: replace: true replaces it.`);
    room(now.tree, path);
    made = !there;
    return { additions: [{ path, contents: bytes.toString("base64") }], deletions: [] };
  });
  return { made, head: head! };
}

const said = (r: { made: boolean; head: string }, path: string, size: number) => `${r.made ? "Uploaded" : "Replaced"} ${path} (${size} B, commit ${r.head.slice(0, 7)}).`;

export async function uploadFile(access: string, owner: string, repo: string, a: Record<string, unknown>): Promise<string> {
  if (!open(a.path)) no(`path: ${OPEN}`);
  const text = typeof a.content === "string", base64 = typeof a.content_base64 === "string";
  if (text === base64) no("Give one of content (a text) and content_base64 (any other file).");
  const clean = base64 ? (a.content_base64 as string).replace(/\s+/g, "") : "";
  if (base64 && (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4)) no("content_base64 is not base64.");
  const bytes = Buffer.from(text ? (a.content as string) : clean, text ? "utf8" : "base64");
  return said(await put(access, owner, repo, a.path as string, bytes, a.replace === true), a.path as string, bytes.length);
}

type Ticket = { access: string; owner: string; repo: string; path: string; replace: boolean; until: number; busy: boolean };
// (kept in this process: the app runs as one instance, apphosting.yaml — and on globalThis, as two routes ask for it.
// A link lost with a restart is asked for again.)
const tickets: Map<string, Ticket> = ((globalThis as any).mdviewUploads ??= new Map<string, Ticket>());

export function uploadLink(access: string, owner: string, repo: string, a: Record<string, unknown>, origin: string): string {
  if (!open(a.path)) no(`path: ${OPEN}`);
  const now = Date.now();
  for (const [k, t] of tickets) if (t.until < now) tickets.delete(k);
  while (tickets.size >= LINKS_MOST) tickets.delete(tickets.keys().next().value!);
  const id = random(24);
  tickets.set(id, { access, owner, repo, path: a.path as string, replace: a.replace === true, until: now + LINK_LIFE * 1000, busy: false });
  return `Send the file's bytes with PUT, from where the file is:\n\ncurl -sS --fail-with-body -T '<local file>' '${origin}/mcp/upload/${id}'\n\nIt is kept as ${a.path} in ${owner}/${repo}. The link works once, for ${LINK_LIFE / 60} minutes; ${UPLOAD_MOST / 1024 / 1024} MB at most.`;
}

/** The link's ticket, if it still holds and nothing is being sent to it. */
export function ticketOf(id: string): Ticket | null {
  const t = tickets.get(id);
  return t && t.until >= Date.now() && !t.busy ? t : null;
}

/** What was sent to a link, kept. The link is spent once that worked; refused, it can be tried again. */
export async function redeemUpload(id: string, t: Ticket, bytes: Buffer): Promise<string> {
  t.busy = true;
  try {
    const r = await put(t.access, t.owner, t.repo, t.path, bytes, t.replace);
    tickets.delete(id);
    return said(r, t.path, bytes.length);
  } finally {
    t.busy = false;
  }
}

// ------------------------------------------------------------ moving, copying, deleting

/** The app's lists about files, rewritten where a change touches them → what is added to the commit. */
async function lists(access: string, owner: string, repo: string, tree: Entry[], change: [string, (text: string) => string][]) {
  const there = change.flatMap(([path, rewrite]) => { const e = tree.find((f) => f.path === path); return e ? [{ path, sha: e.sha, rewrite }] : []; });
  const got = there.length ? await texts(access, owner, repo, there.map((l) => l.sha)) : {};
  return there.flatMap(({ path, sha, rewrite }) => {
    const was = got[sha];
    if (was == null) return [];
    const now = rewrite(was);
    return now === was ? [] : [{ path, contents: b64(now) }];
  });
}

// (written only where something of it changed: a list the app wrote another way stays as it is)
function changed<T>(text: string, read: (t: string) => T, write: (v: T) => string, rewrite: (v: T) => T): string {
  const was = write(read(text)), now = write(rewrite(read(text)));
  return was === now ? text : now;
}

/** The lists after `from` (a file, or a folder with all in it) went to `to` — or away (to: null). */
function following(from: string, to: string | null): [string, (text: string) => string][] {
  const under = (p: string) => p === from || p.startsWith(from + "/");
  const moved = (p: string) => (under(p) ? (to == null ? null : to + p.slice(from.length)) : p);
  return [
    [".mdview/shares.json", (t) => changed(t, C.sharesOf, C.sharesText, (all: any) => ({ version: 1, shares: Object.fromEntries(Object.entries(all.shares).flatMap(([id, e]: [string, any]) => { const p = moved(e.path); return p == null ? [] : [[id, { ...e, path: p }]]; })) }))],
    [".mdview/folders.json", (t) => changed(t, C.looksOf, C.looksText, (all: any) => Object.fromEntries(Object.entries(all).flatMap(([k, v]) => { const p = moved(k); return p == null ? [] : [[p, v]]; })))],
    [".mdview/hidden.json", (t) => changed(t, C.hiddenOf, C.hiddenText, (all: any) => C.hiddenMoved(all, from, to))],
    [".mdview/attachments.json", (t) => changed(t, C.attachOf, C.attachText, (all: any) => Object.fromEntries(Object.entries(all as Record<string, string>).flatMap(([file, note]) => { const f = moved(file); return f == null ? [] : [[f, moved(note) ?? note]]; })))],
  ];
}

// (the server is told how the shares stand now, as the browser tells it; the move stands without)
async function sharesChanged(access: string, owner: string, repo: string, additions: { path: string }[]) {
  if (additions.some((a) => a.path === ".mdview/shares.json")) await syncRepo(owner, repo, access).catch((e) => console.error("mdview mcp: shares", e));
}

const files = (n: number) => (n === 1 ? "1 file" : `${n} files`);

export async function move(access: string, owner: string, repo: string, a: Record<string, unknown>): Promise<string> {
  if (!open(a.from) || !open(a.to)) no(`from and to: ${OPEN}`);
  const from = a.from as string, to = a.to as string;
  if (from === to) no("from and to are the same.");
  let count = 0, additions: Change["additions"] = [];
  const head = await commitOnce(access, owner, repo, nameOf(to), async (now) => {
    const what = at(now, from);
    if (!what.folder && kindOf(from) !== kindOf(to)) no("A move keeps what kind of file it is: the same ending.");
    if (what.folder && to.startsWith(from + "/")) no("A folder cannot be moved into itself.");
    if (now.tree.some((f) => f.path === to) || isFolder(now.tree, to)) no(`${to} is there already.`);
    room(now.tree, to);
    count = what.files.length;
    additions = await lists(access, owner, repo, now.tree, following(from, to));
    return { additions, deletions: what.files.map((f) => f.path), links: what.files.map((f) => ({ path: to + f.path.slice(from.length), sha: f.sha })) };
  });
  await sharesChanged(access, owner, repo, additions);
  return `Moved ${from} to ${to} (${files(count)}, commit ${head!.slice(0, 7)}).`;
}

export async function copy(access: string, owner: string, repo: string, a: Record<string, unknown>): Promise<string> {
  if (!open(a.from) || !open(a.to)) no(`from and to: ${OPEN}`);
  const from = a.from as string, to = a.to as string;
  let count = 0;
  const head = await commitOnce(access, owner, repo, nameOf(to), (now) => {
    const what = at(now, from);
    if (!what.folder && kindOf(from) !== kindOf(to)) no("A copy keeps what kind of file it is: the same ending.");
    if (what.folder && (to === from || to.startsWith(from + "/"))) no("A folder cannot be copied into itself.");
    if (now.tree.some((f) => f.path === to) || isFolder(now.tree, to)) no(`${to} is there already.`);
    room(now.tree, to);
    count = what.files.length;
    return { additions: [], deletions: [], links: what.files.map((f) => ({ path: to + f.path.slice(from.length), sha: f.sha })) };
  });
  return `Copied ${from} to ${to} (${files(count)}, commit ${head!.slice(0, 7)}).`;
}

export async function remove(access: string, owner: string, repo: string, a: Record<string, unknown>): Promise<string> {
  if (!open(a.path)) no(`path: ${OPEN}`);
  const path = a.path as string;
  let count = 0, additions: Change["additions"] = [];
  const head = await commitOnce(access, owner, repo, nameOf(path), async (now) => {
    const what = at(now, path);
    if (what.folder && a.recursive !== true) no(`${path} is a folder with ${files(what.files.length)}: recursive: true deletes it with all that is in it.`);
    count = what.files.length;
    additions = await lists(access, owner, repo, now.tree, following(path, null));
    return { additions, deletions: what.files.map((f) => f.path) };
  });
  await sharesChanged(access, owner, repo, additions);
  return `Deleted ${path} (${files(count)}, commit ${head!.slice(0, 7)}). Its versions stay in the repository.`;
}
