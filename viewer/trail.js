/* mdview, the page — one history for a note across the modes (undo and redo beyond what
 * a mode did itself). */
"use strict";
(() => {
  const P = window.MdPage;
  const { post, T, motionMs } = P; // viewer/base.js
  const { draw, captureAnchor } = P; // viewer/render.js
  const { findInput, toast, findOpen, closeOutline, runFind } = P; // viewer/chrome.js
  const { edInput, edBack, READING, showMode, setEditorText, revealCaret, captureEditAnchor, dirty,
    sourceIs, flushSave } = P; // viewer/editor.js

  /* One history for a note across the modes: the texts it was saved as, in
   * order. The source editor gets the steps made elsewhere replayed into its
   * own undo history; the active mode steps back along them once its own
   * history is used up (trailStep). */
  const TRAIL_MAX = 60, REPLAY_MAX = 20;
  const LARGE_LINES = 20000; // from here on the active mode says that it may be slow
  let trail = { path: null, texts: [], at: -1 };
  let trailFloor = 0, trailRedo = [], trailStepping = false, edReplay = null, edCaret = null, activeBuilt = -1;
  function trailPush(path, text) {
    if (trail.path !== path) { trail = { path, texts: [text], at: 0 }; trailFloor = 0; trailRedo = []; return; }
    if (text === trail.texts[trail.at]) return;
    trail.texts.length = trail.at + 1;
    trail.texts.push(text);
    if (trail.texts.length > TRAIL_MAX) { trail.texts.shift(); trailFloor = Math.max(0, trailFloor - 1); }
    trail.at = trail.texts.length - 1;
  }
  function trailShow(text) {
    const a = captureAnchor();
    P.current.text = text;
    P.current.raw = /\r\n/.test(P.current.raw || "") ? text.replace(/\n/g, "\r\n") : text;
    trailStepping = true;
    P.showActive(P.current, a);
    MdActive.view.touch();
    P.activeChanged();
    trailStepping = false;
    MdActive.view.focus();
  }
  function trailStep(dir) {
    if (P.mode !== "active" || !P.current || trail.path !== P.current.path) return false;
    if (MdActive.view.dirty) flushSave(); // (the step before this one, not saved yet)
    if (dir < 0) {
      if (trailFloor < 1) return false;
      trailRedo.push(P.current.text);
      trail.at = trailFloor - 1;
      trailShow(trail.texts[trail.at]);
    } else {
      if (!trailRedo.length) return false;
      const text = trailRedo.pop();
      trailPush(P.current.path, text);
      trailShow(text);
    }
    trailFloor = trail.at;
    return true;
  }
  // a text into the source editor as one step of its own undo history
  function edStep(text) {
    const v = edInput.value;
    if (v === text) return;
    let a = 0;
    const max = Math.min(v.length, text.length);
    while (a < max && v.charCodeAt(a) === text.charCodeAt(a)) a++;
    let b = 0;
    while (b < max - a && v.charCodeAt(v.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
    P.edReplace(a, v.length - b, text.slice(a, text.length - b));
  }
  function saveFailed(msg) {
    // still dirty: the next edit or mode switch tries again — the mode's own text: after a save from
    // the active mode failed, the source editor's (older) text is not what is written next
    if (P.mode === "active") MdActive.view.failed(); else P.savedText = null;
    toast(T("Couldn't save: {0}", msg));
  }
  // The file changed on disk while it is open in the editor.
  function adoptDisk(p) {
    if (p.text === edInput.value) { P.savedText = p.text; return; }
    if (dirty()) {
      sourceIs(p, edInput.value);
      toast(T("File changed on disk — keeping your edits"));
      return;
    }
    const pos = edInput.selectionStart;
    setEditorText(p.text);
    P.savedText = p.text;
    edInput.setSelectionRange(pos, pos);
    if (findOpen()) runFind(findInput.value, true);
  }
  addEventListener("blur", flushSave);

  // --- switching between reading and editing: the views crossfade one after
  // the other (they share the page scroll) and stay on the same source line.
  function setMode(next, caret) {
    if (next === P.mode || !P.current) return;
    if (READING && next !== "read") return; // (a host that only shows a note: there is nothing but reading it)
    if (P.current.kind === "pdf") { toast(T("A PDF is read here, not edited")); return; }
    if (next === "active") {
      if (P.current.error) return;
      if (!window.MdActive?.view) { // first use: ProseMirror and active/*.js
        const from = P.mode;
        P.loadActive().then(() => { if (P.mode === from) setMode(next); }, () => toast(T("active.loadFailed")));
        return;
      }
    }
    if (P.inSource(next) && P.current.readonly) { toast(T("Can't edit: {0}", P.current.readonly)); return; }
    edCaret = P.mode === "active" && P.inSource(next) && MdActive.view.pm?.hasFocus() ? MdActive.view.caretOffset() : null;
    if (P.mode === "active") { P.leaving = true; flushSave(); P.leaving = false; } // current.text is what the active mode holds
    if (next === "active" && !P.current.toldLarge && P.current.text.length > 400000 && P.current.text.split("\n").length > LARGE_LINES) {
      P.current.toldLarge = true;
      toast(T("active.large"));
    }
    if (P.inSource(next)) {
      if (P.edPath !== P.current.path || (!dirty() && edInput.value !== P.current.text)) {
        // What was done in the active mode since the source editor last had the note goes into
        // its undo history step by step (once it is on screen: swapView).
        const from = trail.path !== P.current.path || trail.texts[trail.at] !== P.current.text ? -1
          : P.edPath === P.current.path ? trail.texts.lastIndexOf(edInput.value, trail.at) : Math.max(0, trail.at - REPLAY_MAX);
        if (from >= 0 && from < trail.at && trail.at - from <= REPLAY_MAX) {
          if (P.edPath !== P.current.path) setEditorText(trail.texts[from]);
          edReplay = trail.texts.slice(from + 1, trail.at + 1);
        } else {
          setEditorText(P.current.text);
          edReplay = null;
        }
        P.savedText = P.current.text;
        P.edPath = P.current.path;
        P.edFresh = true;
      }
      if (caret === "end") { edInput.setSelectionRange(edInput.value.length, edInput.value.length); P.edFresh = false; P.edReveal = true; }
    } else {
      flushSave();
    }
    const prev = P.mode;
    P.mode = next;
    post("mode", { edit: P.mode !== "read", name: P.mode });
    showMode();
    closeOutline();
    // Reading <-> active: the same document in the same place, nothing to fade; the source alone <-> the source beside its
    // reading: the same source, which makes room (viewer/twin.js).
    if (P.inSource(prev) === P.inSource(next)) { clearTimeout(P.swapTimer); swapView(); return; }
    document.body.classList.add("swapping", "swapped");
    clearTimeout(P.swapTimer);
    P.swapTimer = setTimeout(swapView, motionMs("--dur-fast", 160) * 0.7);
  }
  function swapView() {
    P.swapTimer = 0;
    const body = document.body, from = body.dataset.view || "read", to = P.inSource() ? "edit" : P.mode; // (the view: the source's in both its modes)
    if (from !== to) {
      if (to === "edit") {
        const a = window.scrollY < 4 ? { line: null } : captureAnchor(undefined, from === "active");
        body.dataset.view = "edit";
        if (edReplay) { for (const text of edReplay) edStep(text); edReplay = null; P.savedText = edInput.value; }
        // (a block cut by the window's top edge: the source line that far into the block's lines)
        const deep = a.line != null && a.into > 0 ? a.into * a.lines : 0;
        const at = a.line == null ? 0 : Math.min(a.line + Math.floor(deep), edBack.children.length - 1);
        const el = a.line == null ? null : edBack.children[at];
        if (el) { const r = el.getBoundingClientRect(); window.scrollBy({ top: deep ? r.top + (deep - Math.floor(deep)) * r.height : r.top - a.top, behavior: "instant" }); }
        else window.scrollTo(0, 0);
        if (edCaret != null) { // the caret where it was in the active mode
          edInput.setSelectionRange(edCaret, edCaret);
          P.edFresh = false;
        } else if (P.edFresh) {
          const pos = el ? P.lineStarts[Math.min(at, P.lineStarts.length - 1)] : 0;
          edInput.setSelectionRange(pos, pos);
          P.edFresh = false;
        }
        edCaret = null;
      } else {
        const a = from === "edit" ? captureEditAnchor() : { line: null, y: window.scrollY };
        if (from === "edit" && P.mode === "active") a.source = true;
        const caret = from === "edit" && P.mode === "active" ? edInput.selectionStart : null;
        if (from === "edit") {
          edInput.blur();
          sourceIs(P.current, edInput.value);
          trailPush(P.current.path, P.current.text);
        }
        if (P.mode === "active" && from === "read") MdActive.view.arriving(); // while the reading view can still be measured
        body.dataset.view = P.mode;
        if (P.mode === "active") { P.showActive(P.current, a); if (caret != null) MdActive.view.caretAt(caret); }
        else if (from === "edit" || !P.drawn || P.drawn.p !== P.current || P.drawn.text !== P.current.text) draw(P.current, a);
        if (P.mode === "read" && window.MdActive?.view) MdActive.view.leave();
        // links were resolved for the text as it was before editing
        if (from === "edit" && P.current.text.includes("[[")) post("reload");
      }
      if (window.MdActive && MdActive.panel) MdActive.panel.sync(); // (the panel at the right: where it stands depends on the mode)
      if (findOpen()) runFind(findInput.value);
    }
    void body.offsetWidth;
    body.classList.remove("swapping");
    if (P.inSource() && !findOpen()) edInput.focus({ preventScroll: true });
    if (P.mode === "active" && !findOpen()) { MdActive.view.caretHere(); MdActive.view.focus(); }
    if (P.inSource() && P.edReveal) revealCaret();
    P.edReveal = false;
  }

  // what the page's other files use of this one
  Object.assign(P, { trailPush, trailShow, trailStep, saveFailed, adoptDisk, setMode });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    trail: [() => trail],
    trailFloor: [() => trailFloor, (v) => { trailFloor = v; }],
    trailRedo: [() => trailRedo, (v) => { trailRedo = v; }],
    trailStepping: [() => trailStepping],
    activeBuilt: [() => activeBuilt, (v) => { activeBuilt = v; }],
  });
})();
