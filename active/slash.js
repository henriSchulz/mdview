/* mdview active mode — the "/" menu (when the settings have it): "/" at the
 * start of a line or after a space, in an empty line or in one with text.
 * Open, it shows groups (a text style, a list, a format, what can be done with
 * the block), each with a menu beside it, and what can be put in. Typing on
 * filters all of it into one list; ↑ ↓ and Enter choose, → opens a group,
 * ← leaves it; Esc closes it and leaves the "/" as it is.
 * What is chosen applies to the block the caret is in (a heading, a list, a
 * quote) or is put in there (a code block, a table, … below the block). What
 * it offers follows where the caret is: a task can be ticked, a table's cell
 * gets its rows and columns.
 * Decorations put a quote around the block — plain, as a tinted block, with
 * a bar (focus), or both — and Color gives the block or the bar one of the theme's
 * colours; a colour chosen for plain text makes a block of it. Callout puts
 * one of the boxes with a title around it: an info, a warning, an error … */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const { Plugin, PluginKey, Selection } = PM.state;
  const N = A.schema.nodes, M = A.schema.marks;
  const { ICON, DECO_COLORS, callout: CALLOUT, copy } = window.MdView.core;
  const CALLOUTS = ["note", "info", "tip", "success", "question", "warning", "error", "bug", "example", "important"];

  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    style: svg('<path d="M3 18 7.5 6 12 18M4.5 14h6"/><circle cx="17.5" cy="14.5" r="3"/><path d="M20.5 11v7"/>'),
    text: svg('<path d="M4 7h16M4 12h16M4 17h10"/>'),
    heading: svg('<path d="M6 5v14M18 5v14M6 12h12"/>'),
    list: ICON.list,
    ordered: svg('<path d="M10 6h11M10 12h11M10 18h11M3.5 5 5 4v5M3.5 15.5c0-1.8 3-1.8 3 0 0 1.2-3 2-3 3.5h3"/>'),
    task: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    quote: ICON.quote,
    block: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h10M7 14h6"/>'),
    focus: svg('<path d="M5 5v14M10 8h10M10 12h10M10 16h6"/>'),
    color: svg('<path d="M12 3.5c3 3.6 5.5 6.6 5.5 9.8a5.5 5.5 0 0 1-11 0c0-3.2 2.5-6.2 5.5-9.8Z"/>'),
    title: ICON.title,
    noColor: svg('<circle cx="12" cy="12" r="6.5"/>'),
    dot: (c) => svg(`<circle cx="12" cy="12" r="7" style="fill: var(--c-${c}); stroke: none"/>`),
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
    wide: svg('<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>'),
    columns: svg('<rect x="3" y="5" width="7.5" height="14" rx="2"/><rect x="13.5" y="5" width="7.5" height="14" rx="2"/>'),
    left: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
    right: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    row: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 12h18"/>'),
    column: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M12 5v14"/>'),
  };

  // ------------------------------------------------------------ the block the caret is in
  // (an item of a list, or what stands in the document itself)
  const usable = (node) => !!node && node.type !== N.hidden && !(node.type === N.island && node.attrs.virtual);
  function blockAt(state) {
    // (in a column: one of the column's own blocks, not the row of columns around it)
    const { $from } = state.selection, item = A.edit.itemAt($from), col = A.columns.around($from), d = item ? item.depth : col ? $from.sharedDepth(col.colPos + 1) + 1 : 1;
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
      const at = b.pos + b.node.nodeSize, made = A.blocks.copyOf(view.state, b.pos, at);
      if (!made || !b.parent.canReplaceWith(b.index + 1, b.index + 1, made.firstChild.type)) return;
      step(view, view.state.tr.insert(at, made)); // (the caret stays where it is, in the block the copy was made of)
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
    /* Block and focus are switched on and off each by itself (a block can be both); the last one
     * switched off, the quote around the text goes too. Quote: a plain one — chosen again, it goes. */
    const has = (part) => !!k.deco && k.deco.split("-").includes(part);
    const deco = (part) => (v) => {
      if (part === "quote") return A.context.run(v, k.deco === "quote" ? A.context.PARAGRAPH.quote : A.context.setDeco(null));
      const next = ["block", "focus"].filter((p) => (p === part ? !has(p) : has(p))).join("-");
      return A.context.run(v, next ? A.context.setDeco(next, k.color) : A.context.PARAGRAPH.quote);
    };
    const cols = A.columns.at(state), colDo = (command) => (v) => A.context.run(v, command);
    // the caret into the title of the callout around the block (view.js types in it)
    const editTitle = (v) => {
      const q = A.edit.ancestor(v.state.selection.$from, (n) => n.type === N.blockquote && !!n.attrs.callout);
      const el = q && v.nodeDOM && v.nodeDOM(q.pos);
      if (el && el.querySelector) el.querySelector(".callout-title-text")?.focus();
    };
    // a callout: the kind chosen again takes it away
    const callout = (type) => (v) => A.context.run(v, k.callout === type ? A.context.PARAGRAPH.quote : A.context.setCallout(type));
    // a colour needs something to colour: plain text becomes a block, a quote gets a bar
    const color = (c) => (v) => A.context.run(v, A.context.setDeco(!k.deco ? "block" : k.deco === "quote" ? (c ? "focus" : null) : k.deco, c));
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
        leaf("table.wide", "wide width full breite voll", I.wide, (v) => A.tableui.wide(v, A.tableui.cellAt(v.state.selection.$from))),
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
      { key: "slash.deco", icon: I.quote, items: [
        leaf("menu.quote", "quote blockquote zitat", I.quote, deco("quote"), { checked: k.deco === "quote" }),
        leaf("slash.block", "block box callout kasten", I.block, deco("block"), { checked: has("block") }),
        leaf("slash.focus", "focus bar fokus balken", I.focus, deco("focus"), { checked: has("focus") }),
      ] },
      { key: "slash.color", icon: I.color, items: [
        leaf("slash.colorDefault", "color colour default farbe standard", I.noColor, color(null), { checked: !k.color, disabled: !!k.callout }),
        ...DECO_COLORS.map((c) => leaf("color." + c, "color colour farbe", I.dot(c), color(c), { checked: k.color === c, disabled: !!k.callout })), // (a callout has its kind's colour)
      ] },
      { key: "slash.callout", icon: CALLOUT.icon.info, items: CALLOUTS.map((c) =>
        leaf("callout." + c, "callout box kasten hinweis " + c, CALLOUT.icon[CALLOUT.kind(c)], callout(c), { checked: k.callout === c }))
        .concat(k.callout ? [null, leaf("callout.title", "title titel rename umbenennen", I.title, editTitle),
          // one that folds: its title's bar folds it away — folded at first, or open
          leaf("callout.fold", "fold collapse collapsible toggle einklappen ausklappen klappen", I.right, (v) => A.context.run(v, A.context.setFold(k.fold ? null : "-")), { checked: !!k.fold }),
          ...(k.fold ? [leaf("callout.foldOpen", "fold open expanded offen aufgeklappt", I.right, (v) => A.context.run(v, A.context.setFold(k.fold === "+" ? "-" : "+")), { checked: k.fold === "+" })] : [])] : []) },
      // a row of columns: made of the caret's block — or, in one, what can be done with its columns
      { key: "slash.columns", icon: I.columns, items: cols ? [
        leaf("columns.addLeft", "column add left spalte links", I.left, colDo(A.columns.add(-1))),
        leaf("columns.addRight", "column add right spalte rechts", I.right, colDo(A.columns.add(1))),
        leaf("columns.moveLeft", "column move left spalte verschieben", I.left, colDo(A.columns.move(-1)), { disabled: cols.index === 0 }),
        leaf("columns.moveRight", "column move right spalte verschieben", I.right, colDo(A.columns.move(1)), { disabled: cols.index === cols.cols.childCount - 1 }),
        leaf("columns.equal", "column equal widths same gleich breit", I.columns, colDo(A.columns.equal), { disabled: A.columns.alike(cols.cols) && cols.cols.firstChild.attrs.width === 1 }),
        null,
        leaf("columns.unwrap", "column unwrap stack auflösen", I.text, colDo(A.columns.unwrap)),
        leaf("columns.remove", "column remove spalte entfernen", I.remove, colDo(A.columns.remove), { danger: true }),
        leaf("columns.delete", "columns delete row spalten löschen", I.remove, colDo(A.columns.destroy), { danger: true }),
      ] : [2, 3, 4].map((n) => leaf("columns.n", "column columns spalten " + n, I.columns, colDo(A.columns.make(n)), { n })) },
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
    // what is called so comes before what is only found by another word for it
    const byName = (e) => labelOf(e).toLowerCase().split(/\s+/).some((w) => w.startsWith(q));
    const found = flat.filter((e) => !e.disabled && (byName(e) || e.words.split(/\s+/).some((w) => w.startsWith(q))));
    return found.filter(byName).concat(found.filter((e) => !byName(e))).map((e) => item({ ...e, checked: undefined }));
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
