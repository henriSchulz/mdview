/* mdview on the web — what the page's host works out, apart from asking and telling: the
 * repository as the tree the sidebar shows, a note's title, where a [[wikilink]] or a link leads,
 * the tabs. As the desktop's shell does it (src-tauri/src/scan.rs, shell.rs), so that a note
 * looks and links the same in both. No browser in here: the tests run it as it is. */
"use strict";
(function (root) {
  const MD_EXT = ["md", "markdown", "mdown", "mkd", "mkdn", "mdx"];
  const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"];
  const AUDIO_EXT = ["mp3", "wav", "ogg", "m4a", "flac", "opus", "webm"];
  const VIDEO_EXT = ["mp4", "mkv", "mov", "ogv"];
  const SKIP_DIRS = ["node_modules", "__pycache__", "target", "venv", ".venv", "dist", "build"];
  const DEPTH = 12, NOTE_LIMIT = 5000;

  const nameOf = (path) => path.slice(path.lastIndexOf("/") + 1);
  const dirOf = (path) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
  const extOf = (path) => { const n = nameOf(path), i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
  const stemOf = (path) => { const n = nameOf(path), i = n.lastIndexOf("."); return i > 0 ? n.slice(0, i) : n; };
  function kindOf(path) {
    const ext = extOf(path);
    return MD_EXT.includes(ext) ? "md" : IMG_EXT.includes(ext) ? "image" : AUDIO_EXT.includes(ext) ? "audio" : VIDEO_EXT.includes(ext) ? "video" : ext === "pdf" ? "pdf" : "file";
  }
  const isMd = (path) => kindOf(path) === "md";

  /* Names as a person sorts them: digits by their number, letters without regard to case. */
  function naturalCmp(a, b) {
    const parts = (s) => s.toLowerCase().match(/\d+|\D+/g) || [];
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const [p, q] = [x[i], y[i]], [n, m] = [/^\d/.test(p), /^\d/.test(q)];
      if (n && m) { const d = Number(p) - Number(q); if (d) return d; } else if (p !== q) return p < q ? -1 : 1;
    }
    return x.length - y.length || (a < b ? -1 : a > b ? 1 : 0);
  }

  /* What of a repository the app shows: nothing hidden (a name beginning with a dot, at any
   * level), nothing in the folders tools make. */
  const shown = (rel) => { const parts = rel.split("/"); return parts.length <= DEPTH + 1 && !parts.some((p, i) => p.startsWith(".") || (i < parts.length - 1 && SKIP_DIRS.includes(p))); };

  /* The repository's files (paths relative to it) as the tree the sidebar is told:
   * { name, path, dirs: [same], notes: [{ name, path, real, title, mtime, pdf?, kind?, opened }] }.
   * base: the path the repository stands at ("/owner/repo"). show: which kinds beside notes
   * ("pdf", "image", "media", "other"). titles: path → a note's title, where they are wanted.
   * opened: path → when it was last opened. changed: path → when it was last changed (a Map),
   * where that is known. A folder with nothing to show is left out. */
  function buildTree(base, files, { show = ["pdf"], titles = null, opened = {}, changed = null, keep = [] } = {}) {
    const node = (path) => ({ name: nameOf(path), path, dirs: [], notes: [] });
    const top = node(base), dirs = new Map([[base, top]]);
    const dir = (path) => {
      let d = dirs.get(path);
      if (!d) { d = node(path); dirs.set(path, d); dir(dirOf(path)).dirs.push(d); }
      return d;
    };
    let count = 0;
    for (const rel of [...files].sort(naturalCmp)) {
      if (!shown(rel) || count >= NOTE_LIMIT) continue;
      const path = base + "/" + rel, kind = kindOf(rel);
      if (kind === "md") {
        dir(dirOf(path)).notes.push({ name: stemOf(rel), path, real: path, title: titles ? titles.get(path) ?? null : null, mtime: (changed && changed.get(path)) || 0, opened: opened[path] || 0 });
      } else {
        const group = kind === "pdf" ? "pdf" : kind === "image" ? "image" : kind === "audio" || kind === "video" ? "media" : "other";
        if (!show.includes(group)) continue;
        dir(dirOf(path)).notes.push({ name: nameOf(rel), path, real: path, title: null, pdf: true, kind, opened: opened[path] || 0 });
      }
      count++;
    }
    for (const k of keep) if (k.startsWith(base + "/") && shown(k.slice(base.length + 1) + "/x")) dir(k); // (folders made here, still empty)
    const kept = new Set(keep);
    const prune = (n) => { n.dirs = n.dirs.filter((d) => { prune(d); return d.dirs.length || d.notes.length || kept.has(d.path); }); n.dirs.sort((a, b) => naturalCmp(a.name, b.name)); };
    prune(top);
    return top;
  }
  const notesOf = (node) => [...node.notes, ...node.dirs.flatMap(notesOf)];

  /* A note's title: its first heading of the first level, outside the properties at its head and
   * outside code; with what marks it up taken away. */
  function noteTitle(text) {
    const lines = text.slice(0, 16 * 1024).split(/\r?\n/);
    let start = 0;
    if (lines[0] !== undefined && lines[0].trim() === "---") {
      const end = lines.findIndex((l, i) => i > 0 && (l.trim() === "---" || l.trim() === "..."));
      if (end > 0) start = end + 1;
    }
    let fence = null;
    for (const line of lines.slice(start)) {
      const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) fence = null; continue; }
      if (m) { fence = m[1]; continue; }
      const h = /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
      if (h) {
        const t = h[1].replace(/!?\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|~~|==|[*`])/g, "").trim();
        return t || null;
      }
    }
    return null;
  }

  /* Where a note's [[wikilinks]] lead, as Obsidian finds them: beside the note, at the vault's
   * root (the nearest folder above with a .obsidian in it), then anywhere by the file's name —
   * the nearest first. paths: every file of the repository, as it stands under `base`. */
  function resolver(base, paths, noteDir) {
    const all = new Set(paths);
    let vault = null;
    for (let d = noteDir; d.length >= base.length; d = dirOf(d)) {
      if (paths.some((p) => p.startsWith(d + "/.obsidian/"))) { vault = d; break; }
      if (d === base) break;
    }
    let index = null;
    const build = () => {
      index = new Map();
      const under = (vault || noteDir) + "/";
      for (const p of paths) {
        if (!p.startsWith(under) || !shown(p.slice(under.length))) continue;
        const key = nameOf(p).toLowerCase();
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(p);
      }
    };
    const join = (dir, rel) => { // (a path made of both, with . and .. worked out; null if it leaves the repository)
      const out = dir.split("/");
      for (const part of rel.split("/")) { if (part === "..") out.pop(); else if (part && part !== ".") out.push(part); }
      const p = out.join("/");
      return p.startsWith(base + "/") ? p : null;
    };
    function resolve(target) {
      const name = target.split(/[#^]/)[0].trim();
      if (!name) return null;
      const cands = isMd(name) ? [name] : [name + ".md", name];
      const bases = vault && vault !== noteDir ? [noteDir, vault] : [noteDir];
      for (const c of cands) for (const b of bases) { const p = join(b, c); if (p && all.has(p)) return p; }
      if (!index) build();
      for (const c of cands) {
        let hits = index.get(nameOf(c).toLowerCase());
        if (!hits) continue;
        if (c.includes("/")) { const tail = "/" + c.toLowerCase(), narrowed = hits.filter((h) => h.toLowerCase().endsWith(tail)); if (narrowed.length) hits = narrowed; }
        const depth = (h) => h.split("/").length;
        return [...hits].sort((a, b) => (a.startsWith(noteDir) ? 0 : 1) - (b.startsWith(noteDir) ? 0 : 1) || depth(a) - depth(b) || (a < b ? -1 : 1))[0];
      }
      return null;
    }
    return { vault, resolve };
  }

  /* The wikilink targets a text names: [[target]], [[target|shown]], ![[embedded]] → [{ target, embed }]. */
  function wikiTargets(text) {
    const out = [];
    for (const m of text.matchAll(/!?\[\[([^\[\]\n]+?)\]\]/g)) out.push({ target: m[1].split("|")[0].trim(), embed: m[0].startsWith("!") });
    return out;
  }

  /* The links to a PDF in the notes ([path, text] each) — what the PDF viewer shows as
   * highlights: a link to a selection is the annotation. (scan.rs: pdf_backlinks) */
  const PDF_LINK = /!?\[\[([^\]\[|#]+\.pdf)(?:#([^\]\[|]*))?(?:\|[^\]\[]*)?\]\]|\]\(<?([^)\s#>]+\.pdf)(?:#([^)\s>]*))?>?\)/gi;
  const unquote = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  function pdfBacklinks(pdf, notes) {
    const name = nameOf(pdf).toLowerCase(), quoted = encodeURIComponent(nameOf(pdf)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16)).toLowerCase(), out = [];
    for (const [path, text] of notes) {
      if (out.length >= 2000) break;
      if (typeof text !== "string" || text.length > 2000000) continue;
      const lower = text.toLowerCase();
      if (!lower.includes(name) && !lower.includes(quoted)) continue;
      const lines = text.split("\n");
      lines.forEach((line, n) => {
        for (const m of line.matchAll(PDF_LINK)) {
          const target = m[1] != null ? m[1] : unquote(m[3]), frag = m[1] != null ? m[2] || "" : unquote(m[4] || "");
          if (nameOf(target.trim()).toLowerCase() !== name || !frag || out.length >= 2000) continue;
          let shown = line.replace(/\s*!?\[\[[^\]]*\]\]/g, "").replace(/^\s*(?:>\s*)*(?:\[![^\]]*\]\s*)?/, "").trim();
          if (!shown) shown = (lines[n + 1] || "").replace(/^\s*(?:>\s*)*/, "").trim(); // (the quote of a callout stands in the line below its link)
          out.push({ path, name: nameOf(path), line: n, frag, text: [...shown].slice(0, 240).join("") });
        }
      });
    }
    return out;
  }

  /* An address the page was about to go to, as the path of a file here (and the place in it), or
   * null where it is an address elsewhere. files: where the app serves a repository's files
   * ("https://…/file"). */
  function linkPath(href, files) {
    let u;
    try { u = new URL(href); } catch { return null; }
    if (!href.startsWith(files + "/")) return null;
    const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
    return { path: dec(u.pathname.slice(new URL(files).pathname.length)), fragment: u.hash.length > 1 ? dec(u.hash.slice(1)) : null };
  }

  /* The tabs of a repository's window, as the shell keeps them: each a note (or none) with the way
   * back and forward of its own. Every change answers what is to be shown now:
   * { show: path | null, fragment?, push? } — or null where nothing changes on screen. */
  function tabs(kept) {
    let seq = 0, at = 0, closed = [];
    const make = (path) => ({ id: ++seq, path: path || null, back: [], fwd: [] });
    let list = (kept && kept.paths ? kept.paths : []).map((p) => make(p || null));
    if (!list.length) list = [make(null)];
    at = Math.max(0, Math.min(list.length - 1, (kept && kept.active) || 0));
    const cur = () => list[at], index = (id) => list.findIndex((t) => t.id === Number(id));
    const show = (i, fragment) => { at = i; return { show: cur().path, fragment: fragment || null }; };
    return {
      get list() { return list; }, get current() { return cur(); }, get closed() { return closed.length > 0; },
      kept: () => ({ paths: list.map((t) => t.path || ""), active: at }),
      told: () => ({ tabs: list.map((t) => ({ id: t.id, path: t.path, name: t.path ? nameOf(t.path) : "" })), active: cur().id, closed: closed.length > 0 }),
      /* the note shown in the tab on screen is another one now (push: the one before can be gone back to) */
      open(path, push) {
        const t = cur();
        if (push && t.path && t.path !== path) { t.back.push(t.path); t.fwd = []; }
        t.path = path;
      },
      find: (path) => list.findIndex((t, k) => k !== at && t.path === path),
      select(id) { const i = index(id); return i < 0 || i === at ? null : show(i); },
      selectAt: (i) => show(i),
      add(path, fragment, where) { const i = Math.min(list.length, where ?? at + 1); list.splice(i, 0, make(path)); return show(i, fragment); },
      close(id) {
        const i = index(id);
        if (i < 0) return null;
        if (list.length === 1) return { last: true };
        const [gone] = list.splice(i, 1);
        if (gone.path) { closed.push([gone.path, i]); closed = closed.slice(-20); }
        if (i === at) return show(Math.min(i, list.length - 1));
        if (i < at) at--;
        return { same: true };
      },
      others(id) {
        const i = index(id);
        if (i < 0 || list.length < 2) return null;
        const was = i === at;
        list.forEach((t, k) => { if (k !== i && t.path) closed.push([t.path, k]); });
        closed = closed.slice(-20);
        list = [list[i]];
        at = 0;
        return was ? { same: true } : show(0);
      },
      reopen(exists) {
        while (closed.length) { const [path, where] = closed.pop(); if (exists(path)) return this.add(path, null, where); }
        return { same: true };
      },
      move(id, to) {
        const i = index(id);
        if (i < 0) return null;
        const shownId = cur().id, [t] = list.splice(i, 1);
        list.splice(Math.max(0, Math.min(list.length, to)), 0, t);
        at = Math.max(0, index(shownId));
        return { same: true };
      },
      go(back) {
        const t = cur(), to = back ? t.back.pop() : t.fwd.pop();
        if (to === undefined) return null;
        if (t.path) (back ? t.fwd : t.back).push(t.path);
        t.path = to;
        return { show: to, fragment: null };
      },
      /* a note has another name: every tab and every way back knows it by the new one */
      rename(old, now) { const swap = (p) => (p === old ? now : p); for (const t of list) { t.path = t.path && swap(t.path); t.back = t.back.map(swap); t.fwd = t.fwd.map(swap); } closed = closed.map(([p, i]) => [swap(p), i]); },
      /* a note was deleted here: the tabs that showed it go — but for the one on screen, which is given another note */
      drop(path) {
        const shownId = cur().id;
        for (const t of list) { t.back = t.back.filter((p) => p !== path); t.fwd = t.fwd.filter((p) => p !== path); }
        list = list.filter((t) => t.id === shownId || t.path !== path);
        closed = closed.filter(([p]) => p !== path);
        at = Math.max(0, index(shownId));
        if (cur().path === path) cur().path = null;
      },
      /* a note is gone (deleted elsewhere): no tab shows it, no way leads back to it */
      forget(exists) { for (const t of list) { if (t.path && !exists(t.path)) t.path = null; t.back = t.back.filter(exists); t.fwd = t.fwd.filter(exists); } },
    };
  }

  /* A name typed for a note or folder, as a file's name: nothing that parts paths, not hidden. */
  const cleanName = (name) => String(name || "").replace(/[/\\\x00-\x1f]/g, " ").trim().replace(/^[. ]+/, "");

  /* A task's box ticked or cleared in a note's text, at a line (counted from 0). null: no task there. */
  function toggleTask(text, line, checked) {
    const lines = text.split("\n"), old = lines[line];
    const m = old === undefined ? null : /^([\s>]*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/.exec(old);
    if (!m) return null;
    lines[line] = m[1] + (checked ? "x" : " ") + old.slice(m[1].length + 1);
    return lines.join("\n");
  }

  /* What a commit is called: the file that changed, or how many and the first of them (as the desktop names its own). */
  function subject(changed) {
    const names = changed.map(nameOf);
    return names.length === 1 ? names[0] : `${names.length} files: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}`;
  }

  // ------------------------------------------------------------ three versions of a text, joined
  const linesOf = (text) => (text === "" ? [] : text.split(/(?<=\n)/));
  /* What turns a into b, as replacements of ranges of a's lines: [{ from, to, lines }] (to exclusive).
   * null: too large to work out here. */
  function changes(a, b) {
    let start = 0, endA = a.length, endB = b.length;
    while (start < endA && start < endB && a[start] === b[start]) start++;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    const n = endA - start, m = endB - start;
    if (n * m > 6e6) return null;
    // the longest run of lines both have, in order
    const w = m + 1, len = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i * w + j] = a[start + i] === b[start + j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    const out = [];
    let i = 0, j = 0, open = null;
    const close = () => { if (open) { out.push(open); open = null; } };
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) { close(); i++; j++; continue; }
      if (!open) open = { from: start + i, to: start + i, lines: [] };
      if (j < m && (i >= n || len[i * w + j + 1] >= len[(i + 1) * w + j])) open.lines.push(b[start + j++]); else { i++; open.to = start + i; }
    }
    close();
    return out;
  }
  /* A text two sides changed from the same beginning, joined: { text } where no place was
   * changed by both — else { parts }, cut as the conflicts' window wants them: { same } where it
   * is settled, { mine, base, theirs } for every place both changed (or that touch). */
  function merge3(base, mine, theirs) {
    if (mine === theirs) return { text: mine };
    if (mine === base) return { text: theirs };
    if (theirs === base) return { text: mine };
    const b = linesOf(base), mineC = changes(b, linesOf(mine)), theirC = changes(b, linesOf(theirs));
    if (!mineC || !theirC) return { parts: [{ mine, base, theirs }] };
    const parts = [];
    let same = "", at = 0, i = 0, j = 0;
    const text = (lines) => lines.join("");
    while (i < mineC.length || j < theirC.length) {
      // the next place anyone changed, with every change of either side that reaches or touches it
      const first = Math.min(i < mineC.length ? mineC[i].from : Infinity, j < theirC.length ? theirC[j].from : Infinity);
      let from = first, to = first, ms = [], ts = [], grew = true;
      while (grew) {
        grew = false;
        while (i < mineC.length && mineC[i].from <= to) { ms.push(mineC[i]); to = Math.max(to, mineC[i].to); i++; grew = true; }
        while (j < theirC.length && theirC[j].from <= to) { ts.push(theirC[j]); to = Math.max(to, theirC[j].to); j++; grew = true; }
      }
      same += text(b.slice(at, from));
      // each side's version of that stretch of the base
      const side = (cs) => { let out = "", p = from; for (const c of cs) { out += text(b.slice(p, c.from)) + text(c.lines); p = c.to; } return out + text(b.slice(p, to)); };
      const m = side(ms), t = side(ts), was = text(b.slice(from, to));
      if (!ts.length || m === t) same += m; else if (!ms.length) same += t;
      else { if (same) parts.push({ same }); same = ""; parts.push({ mine: m, base: was, theirs: t }); }
      at = to;
    }
    same += text(b.slice(at));
    if (!parts.length) return { text: same };
    if (same) parts.push({ same });
    return { parts };
  }

  root.MdWebCore = { cleanName, toggleTask, subject, merge3, MD_EXT, nameOf, dirOf, extOf, stemOf, kindOf, isMd, naturalCmp, shown, buildTree, notesOf, noteTitle, resolver, wikiTargets, pdfBacklinks, linkPath, tabs };
})(typeof window !== "undefined" ? window : globalThis);
