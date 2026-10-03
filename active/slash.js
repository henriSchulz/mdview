/* mdview active mode — the insert menu: "/" at the start of an empty line
 * (when the settings have it). Typing on filters it; ↑ ↓ and Enter choose;
 * Esc closes it and leaves the "/" as it is. */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const { Plugin, PluginKey } = PM.state;
  const N = A.schema.nodes;

  // [label key, words it is found by, what it does]
  const ENTRIES = [
    ["menu.heading", "h1 heading title überschrift", (v) => A.context.run(v, A.context.PARAGRAPH.h1), 1],
    ["menu.heading", "h2 heading überschrift", (v) => A.context.run(v, A.context.PARAGRAPH.h2), 2],
    ["menu.heading", "h3 heading überschrift", (v) => A.context.run(v, A.context.PARAGRAPH.h3), 3],
    ["menu.bullet", "list bullet aufzählung liste", (v) => A.context.run(v, A.context.PARAGRAPH.bullet)],
    ["menu.ordered", "numbered ordered nummeriert liste", (v) => A.context.run(v, A.context.PARAGRAPH.ordered)],
    ["menu.task", "task todo checkbox aufgabe", (v) => A.context.run(v, A.context.PARAGRAPH.task)],
    ["menu.quote", "quote blockquote zitat", (v) => A.context.run(v, A.context.PARAGRAPH.quote)],
    ["menu.codeBlock", "code codeblock", (v) => A.context.INSERT.code(v)],
    ["menu.formula", "formula math latex equation formel", (v) => A.context.INSERT.math(v)],
    ["menu.table", "table tabelle", (v) => A.context.INSERT.table(v)],
    ["menu.rule", "divider rule line hr trennlinie", (v) => A.context.INSERT.rule(v)],
    ["menu.image", "image picture bild", (v) => A.context.INSERT.image(v)],
    ["menu.footnote", "footnote note fußnote", (v) => A.context.INSERT.footnote(v)],
  ];
  // the "/…" being typed: { from, to, query } — in an otherwise empty paragraph, the caret at its end
  function typed(state) {
    const { $from, empty } = state.selection, p = $from.parent;
    if (!empty || p.type !== N.paragraph || $from.parentOffset !== p.content.size || p.childCount !== 1 || !p.firstChild.isText) return null;
    const m = /^\/(\S{0,24})$/.exec(p.textContent);
    return m ? { from: $from.start(), to: $from.end(), query: m[1].toLowerCase() } : null;
  }
  function items(view, q) {
    return ENTRIES.filter(([key, words, , n]) => !q || (T(key, n).toLowerCase() + " " + words).split(/\s+/).some((w) => w.startsWith(q)))
      .map(([key, , act, n]) => ({
        label: T(key, n),
        run() {
          const t = typed(view.state); // the "/…" goes, what was chosen comes in its place
          if (t) view.dispatch(view.state.tr.delete(t.from, t.to));
          act(view);
        },
      }));
  }
  let openFor = null; // the paragraph's start the menu is open for
  const key = new PluginKey("slash");
  const plugin = new Plugin({
    key,
    view: () => ({
      update(view, prev) {
        const t = view.editable && A.prefs.get().slash ? typed(view.state) : null;
        if (!t) { if (openFor != null) { openFor = null; A.menu.close(); } return; }
        if (openFor === t.from) { if (view.state.doc !== prev.doc) A.menu.refill(items(view, t.query)); return; }
        // opens only right after the "/" was typed, not when the caret comes back to one
        if (view.state.doc === prev.doc || t.query) return;
        openFor = t.from;
        const c = view.coordsAtPos(t.to);
        A.menu.open({ x: c.left, y: c.bottom + 4, above: c.top - 4, items: items(view, ""), typing: true, closed: () => { openFor = null; } });
      },
      destroy() { if (openFor != null) A.menu.close(); },
    }),
  });

  A.slash = { plugin, typed };
})();
