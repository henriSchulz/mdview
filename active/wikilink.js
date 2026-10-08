/* mdview active mode — a link to another note, made while it is typed. "[["
 * puts the closing brackets in at once (edit.js), the caret between them; from
 * then on the folder's notes are offered under the caret, narrowed by what is
 * typed — in the text itself, the caret never leaves it. Enter (or a click)
 * takes the one marked and the link stands, whole; "]" ends it with the name
 * as typed; Esc puts the offers away and leaves what was typed. "![[" does the
 * same for what is shown in the note itself. */
"use strict";
(() => {
  const A = window.MdActive;
  const core = window.MdView.core;
  const T = window.MdStrings.t;
  const { Plugin, PluginKey, TextSelection } = PM.state;
  const N = A.schema.nodes, M = A.schema.marks;
  const MOST = 40;

  /* The notes a link can lead to, as they are written in one: by name, in the folder's own order
   * (what was opened last comes first); a name that two notes have, with its folders. PDFs by
   * their file name — and for what is shown in the note (embed), every other file listed too.
   * → [[name, note], …] */
  function names(embed) {
    const f = core.folder, all = [];
    if (!f) return [];
    const walk = (n) => { all.push(...n.notes); n.dirs.forEach(walk); };
    walk(f.all || f.tree);
    const here = core.current && core.current.path, stem = (n) => (n.pdf ? n.name : n.path.split("/").pop().replace(/\.[^.]+$/, ""));
    const list = [...core.sortNotes(all.filter((n) => !n.pdf)), ...all.filter((n) => n.pdf && (embed || n.kind === "pdf"))].filter((n) => n.real !== here && n.path !== here);
    const times = new Map();
    for (const n of list) times.set(stem(n).toLowerCase(), (times.get(stem(n).toLowerCase()) || 0) + 1);
    return list.map((n) => [times.get(stem(n).toLowerCase()) > 1 ? n.path.slice(f.root.length + 1).replace(n.pdf ? /$^/ : /\.[^./]+$/, "") : stem(n), n]);
  }

  // the link being typed, the caret inside its brackets: { from, to, query, embed } — from the "[[" (or "![[") to behind the "]]"
  function typed(state) {
    const { $from, empty } = state.selection, p = $from.parent;
    if (!empty || !p.isTextblock || p.type === N.code_block || M.code.isInSet($from.marks())) return null;
    const before = p.textBetween(0, $from.parentOffset, null, "￼"), after = p.textBetween($from.parentOffset, p.content.size, null, "￼");
    const m = /(!?)\[\[([^\[\]\n￼]*)$/.exec(before);
    if (!m || !after.startsWith("]]")) return null;
    return { from: $from.pos - m[0].length, to: $from.pos + 2, query: m[2], embed: !!m[1] };
  }
  // the link, whole, in the brackets' place
  function put(view, target) {
    const t = typed(view.state);
    target = String(target || "").trim();
    if (!t || !target) return false;
    const raw = "[[" + target + "]]", name = target.split("|")[0].split("#")[0].trim().toLowerCase();
    if (t.embed) {
      view.dispatch(view.state.tr.delete(t.from, t.to).setMeta("step", true));
      A.clip.insertMarkdown(view, "!" + raw);
      return true;
    }
    // (a note of the folder's: the link leads somewhere, and shows it — the application says where when the note is read again)
    const links = A.view.store && A.view.store.env.links, known = names(false).find(([n]) => n.toLowerCase() === name);
    if (links && known && !links[target.split("|")[0].trim()]) links[target.split("|")[0].trim()] = { path: known[1].real || known[1].path, kind: known[1].kind || "md" };
    const html = core.md.renderInline(raw, { links: links || {}, depth: 0 });
    const tr = view.state.tr.replaceWith(t.from, t.to, N.iatom.create({ kind: "wikilink", raw, html }));
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, t.from + 1)).setMeta("step", true).scrollIntoView());
    return true;
  }
  function items(view, t) {
    const q = t.query.split("|")[0].trim().toLowerCase(), all = names(t.embed).map(([n]) => n);
    const hits = q ? [...all.filter((n) => n.toLowerCase().startsWith(q)), ...all.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q))] : all;
    const out = hits.slice(0, MOST).map((n) => ({ label: n, icon: core.rowIcon(/\.[A-Za-z0-9]{1,8}$/.test(n) ? n : n + ".md"), run: () => put(view, n + (t.query.includes("|") ? t.query.slice(t.query.indexOf("|")) : "")) }));
    // a name of one's own: a link to a note that is still to be written
    if (q && !all.some((n) => n.toLowerCase() === q)) out.push(...(out.length ? [null] : []), { label: T("link.toNew", t.query.split("|")[0].trim()), icon: core.UI.plus, run: () => put(view, t.query) });
    return out;
  }

  let openFor = null; // where the link the offers are for begins
  let closedAt = null; // { doc, pos }: a link was just ended by "]" there
  const key = new PluginKey("wikilink");
  const plugin = new Plugin({
    key,
    props: {
      // "]" at the brackets that close it: the link ends there, with the name as typed (nothing named: the caret steps over them)
      handleTextInput(view, _from, _to, text) {
        if (text !== "]") return false;
        // (the second of the two, typed out of habit right behind the link the first one ended: it is there already)
        if (closedAt && closedAt.doc === view.state.doc && closedAt.pos === view.state.selection.from) { closedAt = null; return true; }
        closedAt = null;
        const t = typed(view.state);
        if (!t) return false;
        if (openFor != null) { openFor = null; A.menu.close(true); }
        if (put(view, t.query)) closedAt = { doc: view.state.doc, pos: view.state.selection.from };
        else view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, t.to)));
        return true;
      },
      // Backspace right behind the "[[" with nothing named yet: the bracket goes, and the two that were put in for it
      handleKeyDown(view, e) {
        if (e.key !== "Backspace" || e.ctrlKey || e.metaKey || e.altKey) return false;
        const t = typed(view.state);
        if (!t || t.query) return false;
        view.dispatch(view.state.tr.delete(t.to - 3, t.to).setMeta("step", true));
        return true;
      },
    },
    view: () => ({
      update(view, prev) {
        const t = view.editable ? typed(view.state) : null;
        if (!t) { if (openFor != null) { openFor = null; A.menu.close(); } return; }
        if (openFor === t.from) { if (view.state.doc !== prev.doc) A.menu.refill(items(view, t)); return; }
        // opens only as the brackets are typed, not when the caret comes back between two
        if (view.state.doc === prev.doc || t.query) return;
        openFor = t.from;
        const c = view.coordsAtPos(t.from);
        A.menu.open({ x: c.left, y: c.bottom + 4, above: c.top - 4, items: items(view, t), typing: true, steady: true, closed: () => { openFor = null; } });
      },
      destroy() { if (openFor != null) A.menu.close(); },
    }),
  });

  A.wikilink = { plugin, typed, names, put };
})();
