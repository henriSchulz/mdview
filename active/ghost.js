/* mdview active mode — a continuation offered while one writes ("ghost text",
 * as GitHub Copilot shows it): in a pause, the next words appear in grey
 * behind the caret. They are not part of the document.
 *   Tab       take all of it          Ctrl+→   take the next word
 *   Esc       away with it            typing what it says keeps it, shortened
 * The text around the caret goes to the application, which asks the model
 * (the page itself reaches no network, and never sees the key). Off unless
 * switched on in the settings.
 * Asked the way GitHub Copilot asks: a few ms after each key, several questions
 * may be under way at once, and an answer that comes after more was written
 * still counts when what was written is how it begins. In a formula being typed
 * ("$x + |") and in code in a line as well; the dialogs' editor (code blocks,
 * formulas) asks through request() and shows the answer itself. */
"use strict";
(() => {
  const A = window.MdActive;
  const { Plugin, PluginKey } = PM.state;
  const { Decoration, DecorationSet } = PM.view;
  const post = (type, data = {}) => window.MdHost?.post(JSON.stringify({ type, ...data }));
  const on = () => !!(window.MdPrefs || {}).aiComplete;
  const PAUSE = 75;       // ms without a key before the model is asked (Copilot: the same)
  const BEFORE = 2400, AFTER = 400, MAX = 120; // characters of context, and of a suggestion

  const key = new PluginKey("ghost");
  // state: { text, pos } — what is offered and where; typed: counts plain typing (a reason to ask)
  const stateOf = (state) => key.getState(state);
  let view = null, timer = 0, asked = 0, told = false;
  const waiting = new Map(); // id → { pos, doc }: the questions under way

  // text typed at the caret: the one step of the transaction, or null
  function typedIn(tr) {
    if (!tr.docChanged || tr.steps.length !== 1) return null;
    const st = tr.steps[0], sl = st.slice;
    if (!sl || st.from !== st.to || sl.openStart || sl.openEnd || sl.content.childCount !== 1 || !sl.content.firstChild.isText) return null;
    const $c = tr.selection.$cursor;
    return $c && $c.pos === st.from + sl.content.size ? { at: st.from, text: sl.content.firstChild.text } : null;
  }
  // may a suggestion stand here: a caret at the end of a block of text (a formula or code being
  // typed there as well — the model continues in LaTeX or in the code's language)
  function place(state) {
    const $c = state.selection.$cursor;
    if (!$c || !$c.parent.isTextblock || $c.parent.type.spec.code || $c.parentOffset !== $c.parent.content.size || !$c.parent.content.size) return null;
    return $c.pos;
  }
  /* The answer, made to fit: its first line, not said again what is there already (`before`:
   * the text in front of the place asked about), a word not glued to the one before it, and
   * without `since` — what was typed at that place while the answer was on its way, which has to
   * be how the answer begins. The rest, or null. */
  function fit(before, text, since = "") {
    let t = String(text).replace(/\r/g, "").split("\n")[0].slice(0, MAX);
    if (/\s$/.test(before) || before === "") t = t.replace(/^\s+/, "");
    else if (/^[\p{L}\p{N}]/u.test(t) && /[.,;:!?)\]]$/.test(before)) t = " " + t;
    if (since && (!t.startsWith(since) || t.length === since.length)) return null;
    t = t.slice(since.length);
    return t.trim() ? t : null;
  }
  // a question of someone else's (the dialogs' editor): the answer goes to `cb(text)`; the id
  function request(before, after, cb) {
    const id = ++asked;
    waiting.set(id, { cb });
    post("complete", { id, before, after });
    return id;
  }
  function ask() {
    if (!view || !on() || view.composing || A.dialog.open || A.menu.isOpen) return;
    const state = view.state, pos = place(state);
    if (pos == null || stateOf(state).text) return;
    const before = state.doc.textBetween(Math.max(0, pos - BEFORE), pos, "\n", " ");
    if (before.trim().length < 12) return;
    const after = state.doc.textBetween(pos, Math.min(state.doc.content.size, pos + AFTER), "\n", " ");
    const id = ++asked;
    waiting.set(id, { pos, doc: state.doc });
    post("complete", { id, before, after });
  }
  // the model's answer (from the application)
  function result(id, text, error) {
    if (error && !told) { told = true; window.MdView.core.toast(error); }
    const w = waiting.get(id);
    waiting.delete(id);
    if (!w || !text || !on()) return;
    if (w.cb) return w.cb(text);
    if (!view || stateOf(view.state).text) return;
    // still at the place asked about — or further along it, having written what the answer begins with
    const cur = view.state.doc, pos = place(view.state);
    if (pos == null || pos < w.pos) return;
    if (cur !== w.doc && !(cur.slice(0, w.pos).eq(w.doc.slice(0, w.pos)) && cur.slice(pos).eq(w.doc.slice(w.pos)))) return;
    const t = fit(cur.textBetween(Math.max(0, w.pos - 60), w.pos, "\n", " "), text, cur.textBetween(w.pos, pos, "\n", " "));
    if (!t) return;
    view.dispatch(view.state.tr.setMeta(key, { text: t, pos }).setMeta("addToHistory", false));
  }
  function take(v, part) {
    const s = stateOf(v.state);
    if (!s.text) return false;
    let text = s.text;
    if (part === "word") { const m = /^\s*\S+/.exec(text); text = m ? m[0] : text; }
    const rest = s.text.slice(text.length);
    const tr = v.state.tr.insertText(text, s.pos).setMeta("step", true);
    tr.setMeta(key, rest ? { text: rest, pos: s.pos + text.length } : { text: "", pos: 0 });
    v.dispatch(tr);
    return true;
  }
  const plugin = new Plugin({
    key,
    state: {
      init: () => ({ text: "", pos: 0, typed: 0 }),
      apply(tr, value) {
        const typed = typedIn(tr);
        let next = value;
        if (typed) next = { ...next, typed: next.typed + 1 }; // (Tab's text too: the next continuation is asked for at once)
        const set = tr.getMeta(key);
        if (set) return { ...next, text: set.text, pos: set.pos };
        if (!value.text) return next;
        // typing what the suggestion says keeps it, shortened by what was typed
        if (typed && typed.at === value.pos && value.text.startsWith(typed.text) && value.text.length > typed.text.length) return { ...next, text: value.text.slice(typed.text.length), pos: value.pos + typed.text.length };
        if (tr.docChanged || tr.selectionSet) return { ...next, text: "", pos: 0 };
        return next;
      },
    },
    view(v) {
      view = v;
      return {
        update(now, prev) {
          const a = stateOf(now.state), b = stateOf(prev);
          clearTimeout(timer);
          if (!on() || a.text) return;
          if (a.typed !== b.typed) timer = setTimeout(ask, PAUSE);
        },
        destroy() { clearTimeout(timer); if (view === v) view = null; },
      };
    },
    props: {
      /* Shown without putting anything into the text: the block the caret is in gets an attribute,
       * and CSS writes it behind the block's last line. (An element beside the caret — as it was
       * at first — made the caret jump: the browser may set the caret into or behind it, and an
       * input method loses its place when the elements around it change.) */
      decorations(state) {
        const s = stateOf(state);
        if (!s.text || place(state) !== s.pos || (view && view.composing)) return null;
        const $c = state.selection.$cursor;
        return DecorationSet.create(state.doc, [Decoration.node($c.before(), $c.after(), { "data-ghost": s.text })]);
      },
      handleKeyDown(v, e) {
        if (!stateOf(v.state).text || e.isComposing) return false;
        if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); return take(v, "all"); }
        if (e.key === "ArrowRight" && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); return take(v, "word"); }
        if (e.key === "Escape") { e.preventDefault(); v.dispatch(v.state.tr.setMeta(key, { text: "", pos: 0 }).setMeta("addToHistory", false)); return true; }
        return false;
      },
      handleDOMEvents: {
        // an input method at work: nothing is offered, and nothing shown changes under it
        compositionstart(v) { clearTimeout(timer); waiting.clear(); if (stateOf(v.state).text) v.dispatch(v.state.tr.setMeta(key, { text: "", pos: 0 }).setMeta("addToHistory", false)); return false; },
        blur(v) { clearTimeout(timer); waiting.clear(); if (stateOf(v.state).text) v.dispatch(v.state.tr.setMeta(key, { text: "", pos: 0 }).setMeta("addToHistory", false)); return false; } },
    },
  });

  A.ghost = { plugin, result, shown: (state) => stateOf(state).text, take, request, forget: (id) => waiting.delete(id), fit, on, PAUSE };
})();
