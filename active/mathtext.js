/* mdview active mode — LaTeX Suite while a formula is still being typed in
 * the text: with the caret between dollars ("$x|$", "$x|", "$$x|$$"), before
 * the formula has become one. The same snippets, auto-fraction, tabstops and
 * tabout as in the formula dialog (latexsuite.js is the machinery):
 *   a character   snippets; with a selection inside the dollars, visual snippets
 *   /             auto-fraction
 *   Tab           a snippet that waits for Tab · the next tabstop · in a matrix " & " ·
 *                 behind the next closing bracket · at the end: out of the formula
 *                 (the closing dollar is written if it is not there) — it becomes a formula
 *   Shift+Tab     the tabstop before
 * In a formula in the text nothing else is rewritten as one types (no *italics*, no quotes). */
"use strict";
(() => {
  const A = window.MdActive;
  const { Plugin, PluginKey, TextSelection } = PM.state;
  const { Decoration, DecorationSet } = PM.view;
  const C = A.latexsuite.core;
  const prefs = () => ({ latexSnippets: true, latexFraction: true, latexMatrix: true, latexTabout: true, latexEnlarge: true, ...(window.MdPrefs || {}) });
  const key = new PluginKey("mathtext");

  /* The formula the selection is in, if it is in one:
   * { base (position of the block's content), start, end (offsets of the formula's text in the
   *   block), dbl ($$), closed, text, from, to (the selection, as offsets in the formula) } */
  function mathAt(state) {
    const { $from, $to } = state.selection;
    const block = $from.parent;
    if (!block.isTextblock || block.type.spec.code || !$from.sameParent($to)) return null;
    if ($from.marks().some((m) => m.type.name === "code")) return null;
    const text = block.textBetween(0, block.content.size, null, "￼");
    const off = $from.parentOffset, offTo = $to.parentOffset;
    let open = -1, dbl = false, code = false;
    for (let i = 0; i < off; ) {
      const ch = text[i];
      if (ch === "\\") { i += 2; continue; }
      if (ch === "`") { code = !code; i++; continue; }
      if (ch === "$" && !code) {
        const two = text[i + 1] === "$";
        if (open < 0) {
          const next = text[i + (two ? 2 : 1)];
          // ("5 $ and" opens nothing, and neither does a price: "$5 and $10")
          if (two || (next === undefined ? i + 1 === off : next !== " " && !/\d/.test(next))) { open = i; dbl = two; }
          i += two ? 2 : 1;
        } else if (!dbl || two) { open = -1; i += dbl ? 2 : 1; } else i++;
        continue;
      }
      i++;
    }
    if (open < 0 || code) return null;
    const start = open + (dbl ? 2 : 1);
    if (off < start) return null;
    let end = text.length, closed = false;
    for (let i = offTo; i < text.length; i++) {
      if (text[i] === "\\") { i++; continue; }
      if (text[i] === "$" && (!dbl || text[i + 1] === "$")) { end = i; closed = true; break; }
    }
    return { base: $from.start(), start, end, dbl, closed, text: text.slice(start, end), from: off - start, to: offTo - start };
  }

  // state: tabstops as positions in the document — groups of ranges, and the group the caret is in
  const stopsOf = (state) => key.getState(state);
  function mapStops(value, tr) {
    if (!value.groups.length || !tr.docChanged) return value;
    const groups = value.groups.map((g, gi) => g.map((r) => {
      const from = tr.mapping.map(r.from, -1);
      // (text typed at the end of the tabstop the caret is in belongs to it; any other change at a
      // tabstop's edge leaves it where it is)
      const to = Math.max(from, tr.mapping.map(r.to, gi === value.cur ? 1 : -1));
      return { from, to };
    }));
    return { groups, cur: value.cur };
  }
  const NONE = { groups: [], cur: -1 };

  /* Put a result of the machinery into the document: the text, larger brackets, its tabstops. */
  function apply(view, m, r) {
    const state = view.state, at = m.base + m.start;
    const text = r.text.replace(/\s*\n\s*/g, " "); // (a formula in a line has no lines of its own)
    const shift = (n) => r.text.slice(0, n).replace(/\s*\n\s*/g, " ").length; // offsets, after that
    const tr = state.tr.insertText(text, at + r.from, at + r.to);
    const list = r.stops.length ? r.stops : [{ n: 0, from: r.text.length, to: r.text.length }];
    let groups = [...new Set(list.map((t) => t.n))].sort((x, y) => x - y)
      .map((n) => list.filter((t) => t.n === n).map((t) => ({ from: at + r.from + shift(t.from), to: at + r.from + shift(t.to) })));
    const old = stopsOf(state);
    groups = [...groups, ...mapStops({ groups: old.groups.slice(old.cur + 1), cur: -1 }, tr).groups];
    let value = { groups, cur: 0 };
    if (r.enlarge && prefs().latexEnlarge) {
      const now = m.text.slice(0, r.from) + text + m.text.slice(r.to);
      for (const e of C.enlarge(now)) {
        const before = tr.steps.length;
        tr.insertText(e.insert, at + e.from, at + e.to);
        const step = { mapping: { map: (pos, assoc) => tr.steps.slice(before).reduce((p, s) => s.getMap().map(p, assoc), pos) }, docChanged: true };
        value = { groups: value.groups.map((g) => g.map((x) => ({ from: step.mapping.map(x.from, -1), to: Math.max(step.mapping.map(x.from, -1), step.mapping.map(x.to, -1)) }))), cur: 0 };
      }
    }
    const first = value.groups[0][0];
    tr.setSelection(TextSelection.create(tr.doc, first.from, first.to));
    // (nothing to come back to: a lone place at the caret is no tabstop)
    if (value.groups.length === 1 && value.groups[0].length === 1 && first.from === first.to) value = NONE;
    view.dispatch(tr.setMeta(key, value).setMeta("mathtext", true).scrollIntoView());
    return true;
  }
  const go = (view, value, i) => {
    const r = value.groups[i][0];
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, r.from, r.to)).setMeta(key, { groups: value.groups, cur: i }).scrollIntoView());
    return true;
  };
  // out of the formula: behind its closing dollar (written, if it is not there) — it becomes a formula
  function leave(view, m) {
    const end = m.base + m.end, mark = m.dbl ? "$$" : "$";
    if (m.closed) {
      const pos = end + mark.length;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).setMeta(key, NONE));
      view.someProp("handleTextInput", (f) => f(view, pos, pos, ""));
      return true;
    }
    let tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, end)).setMeta(key, NONE);
    if (m.dbl) tr = tr.insertText("$", end).setMeta("mathtext", true);
    view.dispatch(tr);
    const pos = view.state.selection.from;
    if (!view.someProp("handleTextInput", (f) => f(view, pos, pos, "$"))) view.dispatch(view.state.tr.insertText("$").setMeta("mathtext", true));
    return true;
  }
  const mstate = (m) => ({ text: m.text, from: m.from, to: m.to, block: false });

  const plugin = new Plugin({
    key,
    state: {
      init: () => NONE,
      apply(tr, value, _old, state) {
        const set = tr.getMeta(key);
        if (set) return set;
        if (!value.groups.length) return value;
        const next = mapStops(value, tr);
        // the caret outside everything that is left of the snippet: its tabstops are gone
        const rs = next.groups.slice(Math.max(next.cur, 0)).flat(), c = state.selection.from;
        if (!rs.length || c < Math.min(...rs.map((r) => r.from)) || c > Math.max(...rs.map((r) => r.to))) return NONE;
        return next;
      },
    },
    props: {
      decorations(state) {
        const v = stopsOf(state);
        if (!v.groups.length) return null;
        const decos = [];
        v.groups.forEach((g, i) => {
          if (i === v.cur) return;
          for (const r of g) {
            if (r.to > r.from) decos.push(Decoration.inline(r.from, r.to, { class: "ls-stop" }));
            else decos.push(Decoration.widget(r.from, () => { const s = document.createElement("span"); s.className = "ls-stop none"; s.setAttribute("aria-hidden", "true"); return s; }, { side: -1, key: "ls" + i }));
          }
        });
        return DecorationSet.create(state.doc, decos);
      },
      handleTextInput(view, from, to, text) {
        if (!text || view.composing) return false;
        const m = mathAt(view.state);
        if (!m) return false;
        if (text === "$") return false; // (closing it: the formula rules take over)
        const p = prefs(), st = mstate(m);
        if (text.length === 1) {
          if (p.latexSnippets) {
            const r = C.run(A.latexsuite.snippets(), st, text, true);
            if (r && !r.pass) return apply(view, m, r);
          }
          if (p.latexFraction && text === "/") {
            const r = C.autofraction(st);
            if (r) return apply(view, m, r);
          }
        }
        // plain typing in a formula: as typed (nothing else may make italics or quotes of it)
        view.dispatch(view.state.tr.insertText(text, from, to).setMeta("mathtext", true).scrollIntoView());
        return true;
      },
      handleKeyDown(view, e) {
        if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
        const m = mathAt(view.state);
        if (!m) return false;
        const p = prefs(), v = stopsOf(view.state), st = mstate(m);
        const done = (x) => { if (x) e.preventDefault(); return x; };
        if (e.shiftKey) return done(v.groups.length && v.cur > 0 ? go(view, v, v.cur - 1) : false);
        if (p.latexSnippets) {
          const r = C.run(A.latexsuite.snippets(), st, "", false);
          if (r && !r.pass) return done(apply(view, m, r));
          if (v.groups.length && v.cur >= 0 && v.cur < v.groups.length - 1) return done(go(view, v, v.cur + 1));
          if (v.groups.length) view.dispatch(view.state.tr.setMeta(key, NONE));
        }
        if (m.from !== m.to) return false;
        const at = m.base + m.start;
        const ctx = C.contextAt(m.text, m.to, false), matrix = p.latexMatrix && C.inMatrix(ctx);
        if (matrix && p.latexTabout) {
          const end = C.closingIn(m.text.slice(m.to));
          if (end != null) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at + m.to + end))); return done(true); }
        }
        if (matrix) { view.dispatch(view.state.tr.insertText(" & ").setMeta("mathtext", true)); return done(true); }
        if (p.latexTabout) {
          const t = C.tabout(m.text, m.to);
          if (t && t.pos != null) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at + t.pos))); return done(true); }
          if (t && t.exit) return done(leave(view, m));
        }
        return false;
      },
    },
  });

  A.mathtext = { plugin, at: mathAt, stops: stopsOf };
})();
