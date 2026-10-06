// A note that was shared: read by anyone who has its link, signed in or not — and never anything
// else of the repository.
//
// What is shared stands in the repository itself, in .mdview/shares.json:
//   { "version": 1, "shares": { "<id>": { "path": "docs/Note.md", "created": "…",
//       "password": null | { "salt": "<base64>", "hash": "<base64>", "iterations": 600000 } } } }
// The id is short — a letter or digit, then two (freeId) — so that the link is easy to pass on:
// it can be guessed, and what must not be read by whoever tries has a password. A password is
// kept as PBKDF2-SHA256 of it
// (what a browser and the desktop app can both work out). Taking an entry out ends the link.
// The server keeps nothing: it reads the file, as the app (lib/app.ts), whenever the link is used.
//
// With the note go the files it shows — its pictures, the notes and PDFs it embeds, and theirs —
// and nothing it merely links to.
import "../public/host/core.js"; // (the host's own working out, the same the browser runs: sets globalThis.MdWebCore)
import { createHmac, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { appRepos, repoToken } from "./app";
import { raw, state, texts } from "./github";
import { countShares, dropShare, getShare, putShare, repoKey, reserve, sharesOf } from "./store";

type Core = {
  isMd(p: string): boolean; kindOf(p: string): string; dirOf(p: string): string; nameOf(p: string): string;
  wikiTargets(text: string): { target: string; embed: boolean }[];
  resolver(base: string, paths: string[], noteDir: string): { vault: string | null; resolve(target: string): string | null };
};
const C = (globalThis as unknown as { MdWebCore: Core }).MdWebCore;

export const SHARES = ".mdview/shares.json";
export const ID = /^[A-Za-z0-9_-]{1,64}$/; // (as short as there is room for, see freeId; longer ones from before)
const EMBED_LIMIT = 256 * 1024, FILES_MOST = 400, KEEP = Number(process.env.SHARE_KEEP_MS ?? 30 * 1000); // (KEEP: the tests want none)

export type Password = { salt: string; hash: string; iterations: number };
export type Link = { path: string; url: string; kind: string; text?: string };
export type Shared = {
  token: string; head: string; path: string; password: Password | null;
  text: string; links: Record<string, Link | null>; vault: boolean;
  files: Set<string>; // the paths in the repository that go with the note
};

const seen = new Map<string, { at: number; shared: Promise<Shared | null> }>(); // (a link used again within half a minute is not read anew)

/** What a link shows, or null: no such link (any more), the note is gone, or sharing is not set
 * up. `at`: the address its files are served under ("/s/<owner>/<repo>/<id>/file"). */
export function shared(owner: string, repo: string, id: string, at: string): Promise<Shared | null> {
  const key = `${owner}/${repo}/${id}`.toLowerCase() + " " + at, had = seen.get(key);
  if (had && Date.now() - had.at < KEEP) return had.shared;
  const going = read(owner, repo, id, at).catch((e) => { seen.delete(key); throw e; });
  seen.set(key, { at: Date.now(), shared: going });
  if (seen.size > 500) for (const [k, v] of seen) if (Date.now() - v.at >= KEEP) seen.delete(k);
  return going;
}

async function read(owner: string, repo: string, id: string, at: string): Promise<Shared | null> {
  if (!ID.test(id)) return null;
  const token = await repoToken(owner, repo);
  if (!token) return null;
  const now = await state(token, owner, repo);
  if (!now || now.empty) return null;
  const sha = new Map(now.tree.map((e) => [e.path, e.sha]));
  const list = sha.get(SHARES);
  if (!list) return null;
  let entry: { path?: unknown; password?: unknown } | undefined;
  try { entry = (JSON.parse((await texts(token, owner, repo, [list]))[list] || "{}").shares || {})[id]; } catch { return null; }
  if (!entry || typeof entry.path !== "string" || !sha.has(entry.path) || !C.isMd(entry.path)) {
    void dropShare(id).catch(() => {}); // (the repository names it no more: neither does the server)
    where.delete(id);
    return null;
  }
  const p = entry.password as Partial<Password> | null | undefined;
  const password = p && typeof p.salt === "string" && typeof p.hash === "string" && Number.isInteger(p.iterations) ? { salt: p.salt, hash: p.hash, iterations: p.iterations as number } : null;
  if (entry.password && !password) return null; // (a password that cannot be read: closed, not open)

  // the note, and what it shows: looked up as the host in the browser does, but here — the
  // visitor is told only where these lead, and can fetch only these
  const base = `/${owner}/${repo}`, paths = [...sha.keys()].map((f) => base + "/" + f), rel = (path: string) => path.slice(base.length + 1);
  const url = (path: string) => at + "/" + rel(path).split("/").map(encodeURIComponent).join("/");
  const textOf = async (r: string) => { const s = sha.get(r) as string; return (await texts(token, owner, repo, [s]))[s] ?? ""; };
  const files = new Set<string>([entry.path]), links: Record<string, Link | null> = {};
  const text = await textOf(entry.path), note = base + "/" + entry.path;
  let vault = false;
  const queue: [string, string][] = [[text, C.dirOf(note)]];
  while (queue.length) {
    const [body, dir] = queue.pop() as [string, string];
    const r = C.resolver(base, paths, dir);
    if (dir === C.dirOf(note)) vault = !!r.vault;
    for (const { target, embed } of C.wikiTargets(body)) {
      if (target in links || target.startsWith("#")) continue;
      const to = r.resolve(target);
      if (!to) { links[target] = null; continue; }
      const info: Link = { path: to, url: url(to), kind: C.kindOf(to) };
      if (embed && files.size < FILES_MOST) {
        files.add(rel(to));
        if (info.kind === "md") { info.text = (await textOf(rel(to))).slice(0, EMBED_LIMIT); queue.push([info.text, C.dirOf(to)]); }
      }
      links[target] = info;
    }
    // pictures the Markdown way, and in HTML: addresses beside the note — and a file block: a
    // line that is nothing but a link to a file (the note hands that file out, so it goes with it)
    for (const m of body.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)|<(?:img|source|video|audio)\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']|^[ \t]*\[(?:[^\]\\\n]|\\.)*\]\(<?([^)\s>]+\.[A-Za-z0-9]{1,8})>?\)[ \t]*$/gim)) {
      const href = (m[1] || m[2] || m[3] || "").split(/[#?]/)[0];
      if (m[3] && /\.(md|markdown|mdown)$/i.test(href)) continue; // (a link to a note is a link, not a file handed out)
      if (!href || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) || href.startsWith("/")) continue;
      let name = href;
      try { name = decodeURIComponent(href); } catch { /* (as it stands) */ }
      const out = dir.split("/");
      for (const part of name.split("/")) { if (part === "..") out.pop(); else if (part && part !== ".") out.push(part); }
      const to = out.join("/");
      if (to.startsWith(base + "/") && sha.has(rel(to)) && files.size < FILES_MOST) files.add(rel(to));
    }
  }
  void noted(owner, repo, id, entry).catch(() => {}); // (as it stands now: where it is, whether it has a password)
  return { token, head: now.head, path: entry.path, password, text, links, vault, files };
}

// ------------------------------------------------------------ which repository an id belongs to

// The link names only the id. Where it belongs is written down (lib/store.ts) whenever a note is
// shared, a link is opened or a repository's list is looked at. An id that is not written down
// is looked for the long way — the list of shares of every repository the app is installed on —
// but not more often than every few seconds, however many ids are tried.
const where = new Map<string, { owner: string; repo: string; at: number }>(); // (what was asked a moment ago is not asked again)
let looking: Promise<void> | null = null, looked = 0;
const AGAIN = Number(process.env.SHARE_LOOK_MS ?? 5000), REMEMBER = Number(process.env.SHARE_KEEP_MS ?? 60 * 1000);
type Listed = { path?: unknown; password?: unknown; created?: unknown };
const entries = (text: string): [string, Listed][] => { try { return Object.entries((JSON.parse(text).shares || {}) as Record<string, Listed>).filter(([id, e]) => ID.test(id) && e && typeof e.path === "string"); } catch { return []; } };
const noted = (owner: string, repo: string, id: string, e: Listed) => putShare(id, { owner, name: repo, path: e.path as string, password: !!e.password, created: typeof e.created === "string" ? e.created : "" });

/** A repository's list of shares, written down as it stands: what it names is known, what it
 * names no more is forgotten. token: one that reads the repository. */
export async function syncRepo(owner: string, repo: string, token: string): Promise<number> {
  const res = await raw(token, owner, repo, SHARES);
  if (!res.ok && res.status !== 404) throw new Error(`GitHub: ${res.status} for the shares`);
  const listed = res.ok ? entries(await res.text()) : [], ids = new Set(listed.map(([id]) => id));
  for (const [id, e] of listed) await noted(owner, repo, id, e);
  for (const [id] of await sharesOf([repoKey(owner, repo)])) if (!ids.has(id)) { await dropShare(id); where.delete(id); }
  return listed.length;
}
async function lookAbout(): Promise<void> {
  const repos = (await appRepos()).slice(0, 500);
  for (let i = 0; i < repos.length; i += 8) await Promise.all(repos.slice(i, i + 8).map(({ owner, repo, token }) => syncRepo(owner, repo, token).catch(() => 0)));
  looked = Date.now();
}

/** The repository a shared note's id belongs to, or null. */
export async function whereIs(id: string): Promise<{ owner: string; repo: string } | null> {
  const had = where.get(id);
  if (had && Date.now() - had.at < REMEMBER) return had;
  let s = await getShare(id);
  if ((!s || s.state !== "shared") && (looking || Date.now() - looked >= AGAIN)) {
    looking = looking || lookAbout().finally(() => { looking = null; });
    await looking;
    s = await getShare(id);
  }
  if (!s || s.state !== "shared") return null;
  const at = { owner: s.owner, repo: s.name, at: Date.now() };
  where.set(id, at);
  if (where.size > 2000) where.clear();
  return at;
}

const LETTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** An id no shared note has, as short as there is room for: one letter or digit while fewer than
 * 30 notes are shared, then two — and a length more whenever half of those are taken. It is kept
 * for the one who asked (lib/store.ts: reserve), so that no two get the same. */
export async function freeId(): Promise<string> {
  const used = await countShares();
  let length = 1;
  while (used >= (length === 1 ? 30 : 62 ** length / 2)) length++;
  for (;; length++) {
    for (let tries = 0; tries < 40; tries++) {
      const id = Array.from(randomBytes(length), (b) => LETTERS[b % 62]).join("");
      if (await reserve(id)) return id;
    }
  }
}

// ------------------------------------------------------------ a password

const secret = () => { const s = process.env.SESSION_SECRET; if (!s || s.length < 32) throw new Error("SESSION_SECRET is not set (32 characters or more)"); return s; };

/** Whether this is the password. (Slow on purpose: a guess costs what the one who set it chose.) */
export function matches(password: string, p: Password): Promise<boolean> {
  return new Promise((done) => {
    let want: Buffer, salt: Buffer;
    try { want = Buffer.from(p.hash, "base64"); salt = Buffer.from(p.salt, "base64"); } catch { return done(false); }
    if (want.length < 16 || p.iterations < 1 || p.iterations > 5_000_000) return done(false);
    pbkdf2(password, salt, p.iterations, want.length, "sha256", (err, got) => done(!err && got.length === want.length && timingSafeEqual(got, want)));
  });
}

/** What a browser carries once the password was given: good for this link and this password only
 * — a password changed, or a link made anew, and it is asked for again. */
export const pass = (owner: string, repo: string, id: string, p: Password) => createHmac("sha256", secret()).update(`share\n${owner}/${repo}/${id}\n${p.hash}`.toLowerCase()).digest("base64url");
export const cookieName = (id: string) => `mdshare-${id.slice(0, 16)}`;

// Guessing is slowed: after a few wrong passwords for a link, none is looked at for a while.
const wrong = new Map<string, { n: number; until: number }>();
export function mayTry(key: string): boolean { const w = wrong.get(key); return !w || Date.now() >= w.until; }
export function tried(key: string, right: boolean): void {
  if (right) return void wrong.delete(key);
  const w = wrong.get(key) || { n: 0, until: 0 };
  w.n++;
  w.until = w.n < 5 ? 0 : Date.now() + Math.min(15 * 60, 30 * 2 ** (w.n - 5)) * 1000;
  wrong.set(key, w);
  if (wrong.size > 2000) wrong.clear();
}
