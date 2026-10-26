// What a client of the Model Context Protocol may do with the user's notes: the repositories the
// app was given on GitHub, and in each its notes (Markdown), whiteboards (*.board.svg) and PDFs —
// listed, read, searched; notes written, changed and moved, each as one commit, as the browser
// makes them (app/api/r/…/commit). With the user's own GitHub token: nothing the app was not given
// there is reached.
import { extractText, getDocumentProxy } from "unpdf";
import { commit, Denied, Moved, projects, raw, repositories, state, texts, type Entry } from "../github";
import { boardText } from "./board";

export type Tool = { name: string; title: string; description: string; inputSchema: object; annotations: Record<string, boolean | string> };
export type Said = { content: { type: "text"; text: string }[]; isError?: boolean };

const MD = /\.(md|markdown|mdown|mkd|mkdn|mdx)$/i, BOARD = /\.board\.svg$/i, PDF = /\.pdf$/i;
const SKIP = new Set(["node_modules", "__pycache__", "target", "venv", ".venv", "dist", "build"]); // (as the desktop's scan: scan.rs SKIP_DIRS)
const HIDDEN = ".mdview/hidden.json"; // what the user put out of sight (hidden.rs)
const LISTED = 2000, SEARCHED = 3000, HITS = 60, READ = 400_000; // files listed, notes searched, hits shown, characters read at most
const DEVICE = "Device: Claude (MCP)\nClient: mcp";

const kindOf = (p: string) => (BOARD.test(p) ? "whiteboard" : MD.test(p) ? "note" : PDF.test(p) ? "pdf" : "file");
const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
// a path of the repository: no way out of it, nothing of Git's own (as app/api/r/…/commit)
const good = (p: unknown): p is string => typeof p === "string" && p.length > 0 && p.length < 1000 && !p.startsWith("/") && !p.split("/").some((part) => part === "" || part === "." || part === ".." || part === ".git");

class Said400 extends Error {}
const no = (why: string): never => { throw new Said400(why); };
const text = (s: string): Said => ({ content: [{ type: "text", text: s }] });

const REPO = { type: "string", description: 'The repository, "owner/name", as list_repositories names it.' };
const PATH = { type: "string", description: "A file's path in the repository, with /." };

export const TOOLS: Tool[] = [
  { name: "list_repositories", title: "List notebooks", description: "The user's spaces (notebooks): the GitHub repositories the Markdown Notes app was given that hold its .mdview folder. Every other tool takes one of them.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "list_files", title: "List files", description: "The notes (Markdown), whiteboards and PDFs in a repository, or in one folder of it, with their sizes. Files the user hid in the app are left out.", inputSchema: { type: "object", properties: { repo: REPO, folder: { type: "string", description: "Only what is in this folder (and below)." }, all: { type: "boolean", description: "Every file, not only notes, whiteboards and PDFs." } }, required: ["repo"] }, annotations: { readOnlyHint: true } },
  { name: "read_file", title: "Read a file", description: "A note's Markdown as it is; a whiteboard as the text on it (sticky notes, text, tables, links, with where they stand); a PDF's text, page by page.", inputSchema: { type: "object", properties: { repo: REPO, path: PATH, pages: { type: "string", description: 'A PDF only: which pages, as "3" or "2-5". All when left out.' } }, required: ["repo", "path"] }, annotations: { readOnlyHint: true } },
  { name: "search_notes", title: "Search notes", description: "The lines of the notes (and of the text on whiteboards) that hold a text, case not minded; also notes whose name holds it.", inputSchema: { type: "object", properties: { repo: REPO, query: { type: "string" }, folder: { type: "string", description: "Only in this folder (and below)." } }, required: ["repo", "query"] }, annotations: { readOnlyHint: true } },
  { name: "write_note", title: "Write a note", description: "A note written whole: made where there is none, replaced where there is one (only with replace: true). One commit.", inputSchema: { type: "object", properties: { repo: REPO, path: { type: "string", description: "The note's path, ending in .md." }, content: { type: "string", description: "The whole note, in Markdown." }, replace: { type: "boolean", description: "Replace a note that is there already." } }, required: ["repo", "path", "content"] }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } },
  { name: "edit_note", title: "Change a note", description: "A part of a note replaced: old_text must stand in it exactly once (give more of what is around it if not). One commit.", inputSchema: { type: "object", properties: { repo: REPO, path: PATH, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["repo", "path", "old_text", "new_text"] }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: "move_note", title: "Move or rename", description: "A note, whiteboard or PDF moved or renamed — never onto a file that is there. Links to it in other notes stay as they are. One commit.", inputSchema: { type: "object", properties: { repo: REPO, from: PATH, to: PATH }, required: ["repo", "from", "to"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
];

async function repoOf(access: string, name: unknown) {
  if (typeof name !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(name)) no('repo: "owner/name"');
  const [owner, repo] = (name as string).split("/");
  const st = await state(access, owner, repo);
  if (!st) no(`${name} is not there, or not given to the app. list_repositories names those that are.`);
  return { owner, repo, st: st! };
}

/** The files a user sees in the app: none of Git's or the app's own, no hidden ones, none in folders of tools. */
async function shown(access: string, owner: string, repo: string, tree: Entry[]): Promise<Entry[]> {
  const hid = tree.find((e) => e.path === HIDDEN);
  let hidden: string[] = [];
  if (hid) try { hidden = (JSON.parse((await texts(access, owner, repo, [hid.sha]))[hid.sha] || "{}").hidden || []).filter((h: unknown) => typeof h === "string"); } catch { /* (unreadable: nothing hidden) */ }
  return tree.filter((e) => !e.path.split("/").some((part, i, all) => part.startsWith(".") || (i < all.length - 1 && SKIP.has(part))) && !hidden.some((h) => e.path === h || e.path.startsWith(h + "/")));
}

const inFolder = (folder: unknown) => {
  const f = typeof folder === "string" ? folder.replace(/^\/+|\/+$/g, "") : "";
  return (p: string) => !f || p.startsWith(f + "/");
};

/** A file's text: by its blob, else (too large for that) as the repository hands it out. */
async function textOf(access: string, owner: string, repo: string, e: Entry): Promise<string> {
  const t = (await texts(access, owner, repo, [e.sha]))[e.sha];
  if (t != null) return t;
  const res = await raw(access, owner, repo, e.path);
  if (!res.ok) no(`GitHub: ${res.status} for ${e.path}`);
  return res.text();
}

function pagesOf(spec: unknown, total: number): number[] {
  if (spec === undefined || spec === "") return Array.from({ length: total }, (_, i) => i + 1);
  const m = typeof spec === "string" ? /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(spec) : null;
  if (!m) no('pages: "3" or "2-5"');
  const a = Math.max(1, Number(m![1])), b = Math.min(total, Number(m![2] || m![1]));
  if (a > b) no(`The PDF has ${total} pages.`);
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const cut = (s: string) => (s.length > READ ? `${s.slice(0, READ)}\n\n[… cut off: ${s.length - READ} more characters]` : s);

/** One commit; if someone wrote meanwhile, once more on what is there now. */
async function commitOnce(access: string, owner: string, repo: string, headline: string, make: (st: { branch: string; head: string; tree: Entry[] }) => Promise<Parameters<typeof commit>[7]>) {
  for (let turn = 0; ; turn++) {
    const st = await state(access, owner, repo);
    if (!st) no(`${owner}/${repo} is not reachable any more.`);
    const at = st!.empty ? { branch: "main", head: "", tree: [] } : { branch: st!.branch, head: st!.head, tree: st!.tree };
    try {
      return await commit(access, owner, repo, at.branch, at.head, headline, DEVICE, await make(at));
    } catch (e) {
      if (e instanceof Moved && turn === 0) continue;
      if (e instanceof Denied) no("GitHub does not let this account write to the repository.");
      throw e;
    }
  }
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

export async function call(access: string, name: string, a: Record<string, unknown>): Promise<Said> {
  try {
    if (name === "list_repositories") {
      const all = await repositories(access);
      if (!all.length) return text("The app was given no repository yet: on GitHub, https://github.com/settings/installations → mdview-notes → the repositories.");
      // (a space is a repository the app made its own: its folder .mdview with the marker in it — not every repository it was given)
      const spaces = await projects(access, all);
      if (!spaces) no("GitHub did not say which repositories are spaces. Try again in a moment.");
      const mine = all.filter((r) => spaces!.has(r.name));
      if (!mine.length) return text("None of the repositories the app was given is a space yet: a space is made in the app (New Space), or a folder's history is turned on in the desktop app.");
      return text(mine.map((r) => `- ${r.name}${r.private ? " (private)" : ""}${r.about ? ` — ${r.about}` : ""}`).join("\n"));
    }
    const { owner, repo, st } = await repoOf(access, a.repo);
    if (st.empty) return name === "write_note" ? await write(access, owner, repo, a) : text(`${owner}/${repo} is empty.`);
    const files = await shown(access, owner, repo, st.tree);
    if (name === "list_files") {
      const here = files.filter((e) => inFolder(a.folder)(e.path) && (a.all === true || kindOf(e.path) !== "file"));
      const out = here.slice(0, LISTED).map((e) => `${e.path}\t${kindOf(e.path)}\t${e.size} B`);
      return text(out.length ? `${out.join("\n")}${here.length > LISTED ? `\n[… and ${here.length - LISTED} more: name a folder]` : ""}${st.truncated ? "\n[GitHub listed only part of this repository]" : ""}` : "Nothing here.");
    }
    if (name === "read_file") {
      if (!good(a.path)) no("path: a path in the repository");
      const e = st.tree.find((f) => f.path === a.path) || no(`${a.path} is not there. list_files names what is.`);
      if (PDF.test(e.path)) {
        const res = await raw(access, owner, repo, e.path);
        if (!res.ok) no(`GitHub: ${res.status} for ${e.path}`);
        const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
        const want = pagesOf(a.pages, pdf.numPages), { text: pages } = await extractText(pdf, { mergePages: false });
        return text(cut(`${e.path}: ${pdf.numPages} pages.\n\n${want.map((n) => `--- page ${n} ---\n${(pages[n - 1] || "").trim() || "(no text on this page: a picture, or a scan)"}`).join("\n\n")}`));
      }
      if (kindOf(e.path) === "file") no(`${e.path} is no note, whiteboard or PDF.`);
      const body = await textOf(access, owner, repo, e);
      return text(cut(BOARD.test(e.path) ? boardText(body) ?? "This file is no whiteboard the app can read." : body));
    }
    if (name === "search_notes") {
      const q = typeof a.query === "string" ? a.query.trim().toLowerCase() : "";
      if (!q) no("query: a text to look for");
      const here = files.filter((e) => inFolder(a.folder)(e.path) && (MD.test(e.path) || BOARD.test(e.path))).slice(0, SEARCHED);
      const got = await texts(access, owner, repo, here.map((e) => e.sha));
      const hits: string[] = [], named = here.filter((e) => nameOf(e.path).toLowerCase().includes(q)).map((e) => e.path);
      for (const e of here) {
        let t = got[e.sha];
        if (t == null) continue;
        if (BOARD.test(e.path)) t = boardText(t) || "";
        t.split("\n").forEach((line, i) => { if (hits.length < HITS && line.toLowerCase().includes(q)) hits.push(`${e.path}:${i + 1}: ${line.trim().slice(0, 240)}`); });
        if (hits.length >= HITS) break;
      }
      const parts = [named.length ? `Names:\n${named.slice(0, HITS).map((p) => `- ${p}`).join("\n")}` : "", hits.length ? `Lines:\n${hits.join("\n")}${hits.length >= HITS ? "\n[… more: say more of what is looked for, or name a folder]" : ""}` : ""].filter(Boolean);
      return text(parts.length ? parts.join("\n\n") : `"${a.query}" is in no note.`);
    }
    if (name === "write_note") return await write(access, owner, repo, a);
    if (name === "edit_note") {
      if (!good(a.path) || !MD.test(a.path)) no("path: a note's path, ending in .md");
      if (typeof a.old_text !== "string" || !a.old_text || typeof a.new_text !== "string") no("old_text and new_text: texts");
      const head = await commitOnce(access, owner, repo, nameOf(a.path as string), async (at) => {
        const e = at.tree.find((f) => f.path === a.path) || no(`${a.path} is not there.`);
        const was = await textOf(access, owner, repo, e), n = was.split(a.old_text as string).length - 1;
        if (n !== 1) no(n ? `old_text stands ${n} times in the note: give more of what is around it.` : "old_text is not in the note (exactly as given). read_file shows the note as it is.");
        return { additions: [{ path: e.path, contents: b64(was.replace(a.old_text as string, () => a.new_text as string)) }], deletions: [] };
      });
      return text(`Changed ${a.path} (commit ${head.slice(0, 7)}).`);
    }
    if (name === "move_note") {
      if (!good(a.from) || !good(a.to)) no("from and to: paths in the repository");
      if (a.from === a.to) no("from and to are the same.");
      if (kindOf(a.from as string) !== kindOf(a.to as string)) no("A move keeps what kind of file it is: the same ending.");
      const head = await commitOnce(access, owner, repo, nameOf(a.to as string), async (at) => {
        const e = at.tree.find((f) => f.path === a.from) || no(`${a.from} is not there.`);
        if (at.tree.some((f) => f.path === a.to)) no(`${a.to} is there already.`);
        return { additions: [], deletions: [e.path], links: [{ path: a.to as string, sha: e.sha }] };
      });
      return text(`Moved ${a.from} to ${a.to} (commit ${head.slice(0, 7)}).`);
    }
    return { ...text(`No tool ${name}.`), isError: true };
  } catch (e) {
    if (e instanceof Said400) return { ...text(e.message), isError: true };
    throw e;
  }
}

async function write(access: string, owner: string, repo: string, a: Record<string, unknown>): Promise<Said> {
  if (!good(a.path) || !MD.test(a.path)) no("path: a note's path, ending in .md");
  if (typeof a.content !== "string") no("content: the note's text");
  let made = true;
  const head = await commitOnce(access, owner, repo, nameOf(a.path as string), async (at) => {
    const there = at.tree.some((f) => f.path === a.path);
    if (there && a.replace !== true) no(`${a.path} is there already: replace: true replaces it, edit_note changes a part of it.`);
    made = !there;
    return { additions: [{ path: a.path as string, contents: b64(a.content as string) }], deletions: [] };
  });
  return text(`${made ? "Made" : "Replaced"} ${a.path} (commit ${head.slice(0, 7)}).`);
}
