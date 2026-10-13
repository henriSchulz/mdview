// A project's pasteboard: one text for a repository, to carry something from one device to
// another — typed or pasted on one, there on every other that shows it, at once. It is no note
// and in no commit: the server keeps it, the one thing it keeps beside the shared notes' links
// (lib/store.ts).
//
//   pasteboards/<owner>:<repo>  { text, rev: counted up with every writing, at: when, by: who }
//
// Written only by who knows what stands there: a writing names the rev it began from, and one
// that began from another is told what stands there instead (the page joins the two and writes
// again — overview.js). Who shows the pasteboard waits here for the next rev (`changed`): told at
// once what was written through this server, and within a moment what was written through another.
//
// On Firebase it is Firestore (lib/firestore.ts); elsewhere a Map in memory.
import * as fs from "./firestore";

export type Paste = { text: string; rev: number; at: string; by: string };
export const MAX = 200_000; // letters: a pasteboard, not a store (a Firestore document takes 1 MiB)
const COLLECTION = "pasteboards";
const LOOK = Number(process.env.PASTE_LOOK_MS ?? 1500); // how often Firestore is asked while someone waits
const blank: Paste = { text: "", rev: 0, at: "", by: "" };
const keyOf = (owner: string, repo: string) => `${owner}:${repo}`.toLowerCase();

type Kept = { memory: Map<string, Paste>; last: Map<string, Paste>; waiting: Map<string, Set<() => void>>; looking: Map<string, ReturnType<typeof setInterval>> };
// (one for the whole server: its routes are built apart, and each would have its own)
const kept: Kept = ((globalThis as unknown as { __mdviewPaste?: Kept }).__mdviewPaste ??= { memory: new Map(), last: new Map(), waiting: new Map(), looking: new Map() });

const asPaste = (p: fs.Plain | null): Paste => ({ ...blank, ...((p || {}) as Partial<Paste>) });
/** What was read or written just now: who waits for it is told. */
function seen(key: string, now: Paste): Paste {
  const had = kept.last.get(key);
  kept.last.set(key, now);
  if (kept.last.size > 2000) kept.last.delete(kept.last.keys().next().value!);
  if (!had || had.rev !== now.rev) for (const tell of [...(kept.waiting.get(key) || [])]) tell();
  return now;
}

export async function read(owner: string, repo: string): Promise<Paste> {
  const key = keyOf(owner, repo);
  return seen(key, fs.here() ? asPaste(await fs.get(COLLECTION, key)) : kept.memory.get(key) || blank);
}

/** Written, if `base` is the rev that stands there. → what stands there now, and whether it is this writing. */
export async function write(owner: string, repo: string, text: string, base: number, by: string): Promise<{ done: boolean; now: Paste }> {
  const key = keyOf(owner, repo), next: Paste = { text, rev: base + 1, at: new Date().toISOString(), by };
  if (!fs.here()) {
    const had = kept.memory.get(key) || blank;
    if (had.rev !== base) return { done: false, now: had };
    kept.memory.set(key, next);
    return { done: true, now: seen(key, next) };
  }
  const had = await fs.getAt(COLLECTION, key), was = asPaste(had && had.data);
  if (was.rev !== base) return { done: false, now: seen(key, was) };
  if (await fs.swap(COLLECTION, key, next, had ? had.at : null)) return { done: true, now: seen(key, next) };
  return { done: false, now: await read(owner, repo) }; // (someone wrote between the reading and the writing)
}

/** Waits until the pasteboard is at another rev than `rev`, at most `ms`, or until `gone` (the
 * one who asked left). While anyone waits for a pasteboard, it is looked at every moment — once
 * for all of them. */
export function changed(owner: string, repo: string, rev: number, ms: number, gone: AbortSignal): Promise<void> {
  const key = keyOf(owner, repo);
  return new Promise((resolve) => {
    const all = kept.waiting.get(key) || new Set<() => void>();
    kept.waiting.set(key, all);
    const done = () => {
      clearTimeout(timer);
      gone.removeEventListener("abort", done);
      all.delete(tell);
      if (!all.size) { kept.waiting.delete(key); clearInterval(kept.looking.get(key)); kept.looking.delete(key); }
      resolve();
    };
    const tell = () => { if ((kept.last.get(key) || blank).rev !== rev) done(); };
    const timer = setTimeout(done, ms);
    gone.addEventListener("abort", done);
    all.add(tell);
    if (fs.here() && !kept.looking.has(key)) kept.looking.set(key, setInterval(() => void read(owner, repo).catch(() => {}), LOOK));
    tell();
  });
}
