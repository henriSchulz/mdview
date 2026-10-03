/* mdview active mode — a continuation offered while one writes ("ghost text",
 * as GitHub Copilot shows it): in a pause, the next words appear in grey
 * behind the caret. They are not part of the document.
 *   Tab       take all of it          Ctrl+→   take the next word
 *   Esc       away with it            typing what it says keeps it, shortened
 * The text around the caret goes to the application, which asks the model
 * (the page itself reaches no network, and never sees the key). Off unless
 * switched on in the settings. */
"use strict";
(() => {
  const A = window.MdActive;
  const { Plugin, PluginKey } = PM.state;
  const { Decoration, DecorationSet } = PM.view;
  const post = (type, data = {}) => window.webkit?.messageHandlers?.mdview?.postMessage(JSON.stringify({ type, ...data }));
  const on = () => !!(window.MdPrefs || {}).aiComplete;
  const PAUSE = 300;      // ms without a key before the model is asked
  const BEFORE = 2400, AFTER = 400, MAX = 120; // characters of context, and of a suggestion

  const key = new PluginKey("ghost");
  // state: { text, pos } — what is offered and where; typed: counts plain typing (a reason to ask)
  const stateOf = (state) => key.getState(state);
  let view = null, timer = 0, asked = 0, waiting = null, told = false;

  // text typed at the caret: the one step of the transaction, or null
  function typedIn(tr) {
    if (!tr.docChanged || tr.steps.length !== 1) return null;
    const st = tr.steps[0], sl = st.slice;
    if (!sl || st.from !== st.to || sl.openStart || sl.openEnd || sl.content.childCount !== 1 || !sl.content.firstChild.isText) return null;
    const $c = tr.selection.$cursor;
    return $c && $c.pos === st.from + sl.content.size ? { at: st.from, text: sl.content.firstChild.text } : null;
  }
  // may a suggestion stand here: a caret at the end of a block of text that is not code
  function place(state) {
    const $c = state.selection.$cursor;
    if (!$c || !$c.parent.isTextblock || $c.parent.type.spec.code || $c.parentOffset !== $c.parent.content.size) return null;
    if ($c.marks().some((m) => m.type.name === "code")) return null;
    return $c.pos;
  }
  function ask() {
    if (!view || !on() || view.composing || A.dialog.open || A.menu.isOpen) return;
    const state = view.state, pos = place(state);
    if (pos == null || stateOf(state).text) return;
    const before = state.doc.textBetween(Math.max(0, pos - BEFORE), pos, "\n", " ");
    if (before.trim().length < 12) return;
    const after = state.doc.textBetween(pos, Math.min(state.doc.content.size, pos + AFTER), "\n", " ");
    waiting = { id: ++asked, pos, doc: state.doc };
    post("complete", { id: waiting.id, before, after });
  }
  // the model's answer (from the application)
  function result(id, text, error) {
    if (error && !told) { told = true; window.MdView.core.toast(error); }
    const w = waiting;
    if (!view || !w || w.id !== id || !text) return;
    waiting = null;
    if (view.state.doc !== w.doc || place(view.state) !== w.pos || !on()) return; // (written on meanwhile)
    let t = String(text).replace(/\r/g, "").split("\n")[0].slice(0, MAX);
    // what is there already is not said again; a word is not glued to the one before it
    const before = view.state.doc.textBetween(Math.max(0, w.pos - 60), w.pos, "\n", " ");
    if (/\s$/.test(before) || before === "") t = t.replace(/^\s+/, "");
    else if (/^[\p{L}\p{N}]/u.test(t) && /[.,;:!?)\]]$/.test(before)) t = " " + t;
    if (!t.trim()) return;
    view.dispatch(view.state.tr.setMeta(key, { text: t, pos: w.pos }).setMeta("addToHistory", false));
  }
  function take(v, part) {
    const s = stateOf(v.state);
    if (!s.text) return false;
    let text = s.text;
    if (part === "word") { const m = /^\s*\S+/.exec(text); text = m ? m[0] : text; }
    const rest = s.text.slice(text.length);
    const tr = v.state.tr.insertText(text, s.pos).setMeta("step", true);
    tr.setMeta(key, rest ? { text: rest, pos: s.pos + text.length } : { text: "", pos: 0 });
    v.dispatch(tr.scrollIntoView());
    return true;
  }
  const plugin = new Plugin({
    key,
    state: {
      init: () => ({ text: "", pos: 0, typed: 0 }),
      apply(tr, value) {
        const set = tr.getMeta(key);
        if (set) return { ...value, text: set.text, pos: set.pos };
        const typed = typedIn(tr);
        let next = value;
        if (typed) next = { ...next, typed: next.typed + 1 };
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
          if (a.typed !== b.typed) { waiting = null; timer = setTimeout(ask, PAUSE); }
        },
        destroy() { clearTimeout(timer); if (view === v) view = null; },
      };
    },
    props: {
      decorations(state) {
        const s = stateOf(state);
        if (!s.text || place(state) !== s.pos) return null;
        const span = document.createElement("span");
        span.className = "ghost";
        span.textContent = s.text;
        span.setAttribute("aria-hidden", "true");
        return DecorationSet.create(state.doc, [Decoration.widget(s.pos, span, { side: 1, key: "ghost:" + s.text, ignoreSelection: true })]);
      },
      handleKeyDown(v, e) {
        if (!stateOf(v.state).text || e.isComposing) return false;
        if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); return take(v, "all"); }
        if (e.key === "ArrowRight" && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); return take(v, "word"); }
        if (e.key === "Escape") { e.preventDefault(); v.dispatch(v.state.tr.setMeta(key, { text: "", pos: 0 }).setMeta("addToHistory", false)); return true; }
        return false;
      },
      handleDOMEvents: { blur(v) { clearTimeout(timer); waiting = null; if (stateOf(v.state).text) v.dispatch(v.state.tr.setMeta(key, { text: "", pos: 0 }).setMeta("addToHistory", false)); return false; } },
    },
  });

  A.ghost = { plugin, result, shown: (state) => stateOf(state).text, take };
})();
