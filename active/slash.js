/* mdview active mode — the "/" menu (when the settings have it): "/" at the
 * start of a line or after a space, in an empty line or in one with text.
 * What is chosen applies to the block the caret is in (a heading, a list, a
 * quote) or is put in there (a code block, a table, … below the block).
 * Typing on filters it; ↑ ↓ and Enter choose; Esc closes it and leaves the
 * "/" as it is. */
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
    ["menu.graphic", "graphic figure diagram svg ai claude circuit schematic logic rtl grafik schaltung schaltplan zeichnung ki", (v) => A.context.INSERT.graphic(v)],
    ["menu.footnote", "footnote note fußnote", (v) => A.context.INSERT.footnote(v)],
  ];
  // the "/…" being typed, right before the caret: { from, to, query }. Not inside a word or an address ("a/b", "http://").
  function typed(state) {
    const { $from, empty } = state.selection, p = $from.parent;
    if (!empty || (p.type !== N.paragraph && p.type !== N.heading) || A.schema.marks.code.isInSet($from.marks())) return null;
    const before = p.textBetween(0, $from.parentOffset, null, "\ufffc");
    const m = /(?:^|\s)\/([^\s/]{0,24})$/.exec(before);
    if (!m || (before.match(/`/g) || []).length % 2) return null;
    return { from: $from.pos - m[1].length - 1, to: $from.pos, query: m[1].toLowerCase() };
  }
  function items(view, q) {
    return ENTRIES.filter(([key, words, , n]) => !q || (T(key, n).toLowerCase() + " " + words).split(/\s+/).some((w) => w.startsWith(q)))
      .map(([key, , act, n]) => ({
        label: T(key, n),
        run() {
          const t = typed(view.state); // the "/…" goes (with the space that stood before it at the end of the text)
          if (t) {
            const $t = view.state.doc.resolve(t.from), atEnd = t.to === $t.end();
            const space = atEnd && t.from > $t.start() && /\s/.test(view.state.doc.textBetween(t.from - 1, t.from)) ? 1 : 0;
            view.dispatch(view.state.tr.delete(t.from - space, t.to));
          }
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
