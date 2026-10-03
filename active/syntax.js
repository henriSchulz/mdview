/* mdview active mode — "Show Markdown at the caret" (a setting, off at
 * first): around the caret the marks of the formatting it is in show as they
 * are written — **, *, ~~, `, [ ](…), ==, and a heading's #. They are
 * decorations: nothing of them is in the document. */
"use strict";
(() => {
  const A = window.MdActive;
  const { Plugin, PluginKey } = PM.state;
  const { Decoration, DecorationSet } = PM.view;
  const N = A.schema.nodes, M = A.schema.marks;

  const widget = (pos, text, side) => Decoration.widget(pos, () => {
    const s = document.createElement("span");
    s.className = "syn";
    s.textContent = text;
    return s;
  }, { side, ignoreSelection: true, key: side + text });
  // the extent of a mark around a position in a text block: [from, to] or null
  function extent(parent, start, offset, mark) {
    let from = null, to = null, pos = start;
    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i), end = pos + child.nodeSize;
      const has = mark.isInSet(child.marks) || (mark.type === M.link && child.marks.some((m) => m.type === M.link && m.attrs.href === mark.attrs.href));
      if (has) { if (from == null) from = pos; to = end; } else if (to != null && to < start + offset) { from = null; to = null; } else if (to != null) break;
      pos = end;
    }
    return from != null && from <= start + offset && to >= start + offset ? [from, to] : null;
  }
  function decorations(state) {
    if (!(window.MdPrefs || {}).syntax) return null;
    const { $head } = state.selection;
    const p = $head.parent;
    if (!p.isTextblock) return null;
    const out = [], profile = (A.edit.storeOf(state) || {}).profile || { strong: "**", em: "*" };
    if (p.type === N.heading && !/^[=-]$/.test(p.attrs.markup || "")) out.push(widget($head.start(), "#".repeat(p.attrs.level) + " ", -1));
    // the marks at the caret, and those that end right before it
    const marks = new Set([...$head.marks(), ...($head.nodeBefore ? $head.nodeBefore.marks : []), ...($head.nodeAfter ? $head.nodeAfter.marks : [])]);
    for (const mark of marks) {
      const span = extent(p, $head.start(), $head.parentOffset, mark);
      if (!span) continue;
      const d = { strong: mark.attrs.markup || profile.strong, em: mark.attrs.markup || profile.em, s: "~~", code: "`", mark: "==", link: "[" }[mark.type.name];
      if (!d) continue;
      const close = mark.type === M.link ? "](" + mark.attrs.href + ")" : d;
      out.push(widget(span[0], d, -1), widget(span[1], close, 1));
    }
    return out.length ? DecorationSet.create(state.doc, out) : null;
  }
  const plugin = new Plugin({ key: new PluginKey("syntax"), props: { decorations } });
  A.syntax = { plugin };
})();
