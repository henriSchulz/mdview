/* mdview active mode — the "/" menu (when the settings have it): "/" at the
 * start of a line or after a space, in an empty line or in one with text.
 * Open, it shows groups (a text style, a list, a format, what can be done with
 * the block), each with a menu beside it, and what can be put in. Typing on
 * filters all of it into one list; ↑ ↓ and Enter choose, → opens a group,
 * ← leaves it; Esc closes it and leaves the "/" as it is.
 * What is chosen applies to the block the caret is in (a heading, a list, a
 * quote) or is put in there (a code block, a table, … below the block). What
 * it offers follows where the caret is: a task can be ticked, a table's cell
 * gets its rows and columns. */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const { Plugin, PluginKey, Selection } = PM.state;
  const N = A.schema.nodes, M = A.schema.marks;
  const { ICON, copy } = window.MdView.core;

  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    style: svg('<path d="M3 18 7.5 6 12 18M4.5 14h6"/><circle cx="17.5" cy="14.5" r="3"/><path d="M20.5 11v7"/>'),
    text: svg('<path d="M4 7h16M4 12h16M4 17h10"/>'),
    heading: svg('<path d="M6 5v14M18 5v14M6 12h12"/>'),
    list: ICON.list,
    ordered: svg('<path d="M10 6h11M10 12h11M10 18h11M3.5 5 5 4v5M3.5 15.5c0-1.8 3-1.8 3 0 0 1.2-3 2-3 3.5h3"/>'),
    task: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    quote: ICON.quote,
    format: svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
    italic: svg('<path d="M10 5h8M6 19h8M14 5l-4 14"/>'),
    strike: svg('<path d="M4 12h16M16 7.5C15.5 6 14 5 12 5 9.5 5 8 6.3 8 8c0 1.2.7 2 2 2.5M8 16.5c.5 1.5 2 2.5 4 2.5 2.5 0 4-1.3 4-3"/>'),
    code: svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>'),
    codeBlock: ICON.source,
    formula: svg('<path d="M17 6V5H7l6 7-6 7h10v-1"/>'),
    table: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M3 14.5h18M10 5v14"/>'),
    rule: svg('<path d="M3 12h18M8 6.5h8M8 17.5h8"/>'),
    image: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-4.5-4.5L8 19"/>'),
    graphic: svg('<path d="m11 4 1.9 4.9 4.9 1.9-4.9 1.9L11 17.6l-1.9-4.9-4.9-1.9 4.9-1.9ZM18.5 15.5v4M16.5 17.5h4"/>'),
    footnote: svg('<path d="m4 19 8-11M4 8l8 11M16 6c0-2 3.5-2 3.5 0 0 1.5-3.5 2.5-3.5 4.5h3.5"/>'),
    actions: ICON.zap,
    duplicate: svg('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
    remove: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
    moveUp: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    moveDown: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    select: svg('<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 3.4"/>'),
    copy: ICON.clip,
    check: ICON.check,
    row: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 12h18"/>'),
    column: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M12 5v14"/>'),
  };

  // ------------------------------------------------------------ the block the caret is in
  // (an item of a list, or what stands in the document itself)
  const usable = (node) => !!node && node.type !== N.hidden && !(node.type === N.island && node.attrs.virtual);
  function blockAt(state) {
    const { $from } = state.selection, item = A.edit.itemAt($from), d = item ? item.depth : 1;
    if ($from.depth < d) return null;
    const parent = $from.node(d - 1), index = $from.index(d - 1), node = $from.node(d);
    return { node, pos: $from.before(d), parent, index, before: index > 0 ? parent.child(index - 1) : null, after: index < parent.childCount - 1 ? parent.child(index + 1) : null };
  }
  const step = (view, tr) => { view.dispatch(tr.scrollIntoView().setMeta("step", true)); view.focus(); };
  const BLOCK = {
    // the copy is made of the block's Markdown, as a pasted one would be
    duplicate(view) {
      const b = blockAt(view.state);
      if (!b) return;
      const at = b.pos + b.node.nodeSize;
      let made = A.clip.blocksOf(view.state, A.clip.markdownOf(view.state, view.state.doc.slice(b.pos, at)));
      if (b.node.type === N.list_item && made.length === 1 && made[0].type !== N.list_item) made = made[0].content.content;
      if (!made.length || !b.parent.canReplaceWith(b.index + 1, b.index + 1, made[0].type)) return;
      const tr = view.state.tr.insert(at, made);
      step(view, tr.setSelection(Selection.near(tr.doc.resolve(at + 1), 1)));
    },
    remove(view) {
      const b = blockAt(view.state);
      if (!b) return;
      const tr = view.state.tr.deleteRange(b.pos, b.pos + b.node.nodeSize);
      if (!tr.doc.content.size) tr.insert(0, N.paragraph.create());
      step(view, tr.setSelection(Selection.near(tr.doc.resolve(Math.min(b.pos, tr.doc.content.size)), -1)));
    },
    // it changes places with the block above / below, the caret stays in it
    move(view, dir) {
      const b = blockAt(view.state), other = b && (dir < 0 ? b.before : b.after);
      if (!usable(other)) return;
      const inBlock = view.state.selection.from - b.pos, to = dir < 0 ? b.pos - other.nodeSize : b.pos + other.nodeSize;
      const tr = view.state.tr.delete(b.pos, b.pos + b.node.nodeSize).insert(to, b.node);
      step(view, tr.setSelection(Selection.near(tr.doc.resolve(to + inBlock), 1)));
    },
    select(view) { const b = blockAt(view.state); if (b) A.blocks.select(view, b.pos); },
    copy(view) { const b = blockAt(view.state); if (b) { copy(A.clip.markdownOf(view.state, view.state.doc.slice(b.pos, b.pos + b.node.nodeSize))); view.focus(); } },
  };

  // ------------------------------------------------------------ what it offers
  /* An entry: { key, n, words, icon, act(view) } with more words it is found by, or { key, icon, items }
   * for a group. null: a rule. */
  function entries(view) {
    const state = view.state, k = A.context.blockKind(state), b = blockAt(state);
    const para = (kind) => (v) => A.context.run(v, A.context.PARAGRAPH[kind]);
    const leaf = (key, words, icon, act, more) => ({ key, words, icon, act, ...more });
    const format = { key: "menu.format", icon: I.format, items: [
      leaf("menu.bold", "bold strong fett", I.format, (v) => A.context.toggle(v, "strong"), { checked: A.context.markActive(state, M.strong) }),
      leaf("menu.italic", "italic emphasis kursiv", I.italic, (v) => A.context.toggle(v, "em"), { checked: A.context.markActive(state, M.em) }),
      leaf("menu.strike", "strikethrough durchgestrichen", I.strike, (v) => A.context.toggle(v, "s"), { checked: A.context.markActive(state, M.s) }),
      leaf("menu.code", "code inline", I.code, (v) => A.context.toggle(v, "code")),
    ] };
    if (k.cell) { // in a table: its rows and columns
      const cell = A.tableui.cellAt(state.selection.$from);
      const own = (items) => items.map((it) => it && { label: it.label, words: "", act: it.run, disabled: it.disabled, checked: it.checked, danger: it.danger });
      return [
        { key: "table.row", icon: I.row, items: own(A.tableui.rowItems(view, cell)) },
        { key: "table.column", icon: I.column, items: own(A.tableui.colItems(view, cell)) },
        format,
        null,
        leaf("table.delete", "table tabelle", I.remove, (v) => A.tableui.change(v, cell.tablePos, A.tableui.ops.remove()), { danger: true }),
      ];
    }
    const task = b && b.node.type === N.list_item && b.node.attrs.task != null ? b.node.attrs.task : null;
    return [
      ...(task == null ? [] : [leaf(task === " " ? "slash.check" : "slash.uncheck", "check done tick task todo erledigt abhaken", I.check, (v) => A.context.run(v, A.edit.commands.toggleTask)), null]),
      { key: "slash.style", icon: I.style, items: [
        leaf("menu.text", "text body paragraph absatz", I.text, para("text"), { checked: k.kind === "text" }),
        ...[1, 2, 3, 4].map((n) => leaf("menu.heading", n === 1 ? "h1 heading title überschrift titel" : "h" + n + " heading überschrift", I.heading, para("h" + n), { n, checked: k.kind === "h" + n })),
      ] },
      { key: "slash.list", icon: I.list, items: [
        leaf("menu.bullet", "list bullet aufzählung liste", I.list, para("bullet"), { checked: k.kind === "bullet" }),
        leaf("menu.ordered", "numbered ordered nummeriert liste", I.ordered, para("ordered"), { checked: k.kind === "ordered" }),
        leaf("menu.task", "task todo checkbox aufgabe", I.task, para("task"), { checked: k.kind === "task" }),
      ] },
      format,
      leaf("menu.quote", "quote blockquote zitat", I.quote, para("quote")),
      null,
      leaf("menu.codeBlock", "code codeblock", I.codeBlock, (v) => A.context.INSERT.code(v)),
      leaf("menu.formula", "formula math latex equation formel", I.formula, (v) => A.context.INSERT.math(v)),
      leaf("menu.table", "table tabelle", I.table, (v) => A.context.INSERT.table(v)),
      leaf("menu.rule", "divider rule line hr separator trennlinie", I.rule, (v) => A.context.INSERT.rule(v)),
      leaf("menu.image", "image picture bild", I.image, (v) => A.context.INSERT.image(v)),
      leaf("menu.graphic", "graphic figure diagram svg ai claude circuit schematic logic rtl grafik schaltung schaltplan zeichnung ki", I.graphic, (v) => A.context.INSERT.graphic(v)),
      leaf("menu.footnote", "footnote note fußnote", I.footnote, (v) => A.context.INSERT.footnote(v)),
      null,
      { key: "slash.actions", icon: I.actions, items: [
        leaf("slash.duplicate", "duplicate copy duplizieren verdoppeln", I.duplicate, BLOCK.duplicate),
        leaf("slash.moveUp", "move up nach oben bewegen", I.moveUp, (v) => BLOCK.move(v, -1), { disabled: !b || !usable(b.before) }),
        leaf("slash.moveDown", "move down nach unten bewegen", I.moveDown, (v) => BLOCK.move(v, 1), { disabled: !b || !usable(b.after) }),
        leaf("slash.select", "select block auswählen", I.select, BLOCK.select),
        leaf("menu.copyMarkdown", "copy markdown kopieren", I.copy, BLOCK.copy),
        null,
        leaf("slash.delete", "delete remove block löschen", I.remove, BLOCK.remove, { danger: true }),
      ] },
    ];
  }

  // the "/…" being typed, right before the caret: { from, to, query }. Not inside a word or an address ("a/b", "http://").
  function typed(state) {
    const { $from, empty } = state.selection, p = $from.parent;
    if (!empty || (p.type !== N.paragraph && p.type !== N.heading && p.type !== N.table_cell) || M.code.isInSet($from.marks())) return null;
    const before = p.textBetween(0, $from.parentOffset, null, "￼");
    const m = /(?:^|\s)\/([^\s/]{0,24})$/.exec(before);
    if (!m || (before.match(/`/g) || []).length % 2) return null;
    return { from: $from.pos - m[1].length - 1, to: $from.pos, query: m[1].toLowerCase() };
  }
  const labelOf = (e) => e.label || T(e.key, e.n);
  function items(view, q) {
    // the "/…" goes (with the space that stood before it at the end of the text), then the entry does its work
    const run = (e) => () => {
      const t = typed(view.state);
      if (t) {
        const $t = view.state.doc.resolve(t.from), atEnd = t.to === $t.end();
        const space = atEnd && t.from > $t.start() && /\s/.test(view.state.doc.textBetween(t.from - 1, t.from)) ? 1 : 0;
        view.dispatch(view.state.tr.delete(t.from - space, t.to));
      }
      e.act(view);
    };
    const item = (e) => e && (e.items
      ? { label: labelOf(e), icon: e.icon, items: e.items.map(item) }
      : { label: labelOf(e), icon: e.icon, run: run(e), disabled: e.disabled, checked: e.checked, danger: e.danger });
    const all = entries(view);
    if (!q) return all.map(item);
    // filtered: one list of what the groups hold, no rules
    const flat = all.flatMap((e) => (!e ? [] : e.items ? e.items.filter(Boolean).map((x) => ({ icon: e.icon, ...x })) : [e]));
    return flat.filter((e) => !e.disabled && (labelOf(e).toLowerCase() + " " + e.words).split(/\s+/).some((w) => w.startsWith(q)))
      .map((e) => item({ ...e, checked: undefined }));
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
        A.menu.open({ x: c.left, y: c.bottom + 4, above: c.top - 4, items: items(view, ""), typing: true, steady: true, closed: () => { openFor = null; } });
      },
      destroy() { if (openFor != null) A.menu.close(); },
    }),
  });

  A.slash = { plugin, typed, entries, BLOCK };
})();
