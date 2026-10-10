/* A recorder for a bug that only shows under Henri's own hand: started with the app (MDVIEW_PROBE=dev/probe-trace.js
 * MDVIEW_PROBE_OUT=<folder>), it writes down — for the note on screen, into <note>.trace.json, about once a second —
 * every press, pull and release of the pointer, every drag event, every change of the editor's selection with who made
 * it (the transaction's marks and the call stack), and what the browser itself has selected. Nothing is changed. */
(() => {
  const out = (o) => window.MdHost.post(JSON.stringify({ type: "probe", name: "trace", text: JSON.stringify(o) }));
  const log = [], t0 = performance.now();
  let dirty = false, hooked = null;
  const add = (kind, more) => { log.push({ t: Math.round(performance.now() - t0), kind, ...more }); if (log.length > 1500) log.splice(0, log.length - 1500); dirty = true; };
  const where = (n) => { if (!n) return null; const el = n.nodeType === 1 ? n : n.parentElement; if (!el) return null; const isl = el.closest && el.closest(".isl, p, h1, h2, h3, li, .cols"); return (el.tagName + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")) + (isl && isl !== el ? " in " + isl.tagName + "." + String(isl.className).split(" ")[0] + (isl.dataset && isl.dataset.line ? "@" + isl.dataset.line : "") : ""); };
  const dom = () => { const s = getSelection(); if (!s || !s.rangeCount) return null; return { collapsed: s.isCollapsed, text: String(s).length, a: where(s.anchorNode), ao: s.anchorOffset, f: where(s.focusNode), fo: s.focusOffset }; };
  const pmSel = () => { const A = window.MdActive, v = A && A.view && A.view.pm; if (!v) return null; const s = v.state.selection; return { kind: s.node ? "node:" + s.node.type.name : s.empty ? "caret" : s.constructor.name === "AllSelection" || (s.from === 0 && s.to === v.state.doc.content.size) ? "all" : "range", from: s.from, to: s.to, size: v.state.doc.content.size, blocks: (() => { try { const b = A.blocks.selection(v.state); return b && [b.from, b.to]; } catch (e) { return "?"; } })() }; };
  for (const type of ["mousedown", "mouseup", "click", "dragstart", "dragend", "drop", "selectstart", "pointercancel"]) {
    document.addEventListener(type, (e) => add(type, { x: Math.round(e.clientX || 0), y: Math.round(e.clientY || 0), on: where(e.target), prevented: e.defaultPrevented, buttons: e.buttons, pm: pmSel(), dom: dom(), scroll: Math.round(scrollY) }), true);
    document.addEventListener(type, (e) => add(type + "/after", { prevented: e.defaultPrevented, pm: pmSel(), dom: dom() }));
  }
  let moves = 0;
  document.addEventListener("mousemove", (e) => { if (e.buttons && moves++ % 6 === 0) add("move", { x: Math.round(e.clientX), y: Math.round(e.clientY), dom: dom(), scroll: Math.round(scrollY) }); }, true);
  document.addEventListener("selectionchange", () => add("selectionchange", { dom: dom(), pm: pmSel() }));
  let lastY = scrollY; addEventListener("scroll", () => { if (Math.abs(scrollY - lastY) > 30) { add("scroll", { from: Math.round(lastY), to: Math.round(scrollY), stack: String(new Error().stack || "").split("\n").slice(1, 5).join(" | ") }); lastY = scrollY; } }, true);
  // every transaction of the editor that sets a selection: its marks, and who dispatched it
  setInterval(() => {
    const v = window.MdActive && MdActive.view && MdActive.view.pm;
    if (v && hooked !== v) {
      hooked = v;
      const was = v.dispatch.bind(v);
      v.dispatch = (tr) => {
        try { if (tr.selectionSet || tr.scrolledIntoView) add("dispatch", { sel: tr.selection.node ? "node:" + tr.selection.node.type.name : tr.selection.empty ? "caret" : "range", from: tr.selection.from, to: tr.selection.to, docChanged: tr.docChanged, scroll: !!tr.scrolledIntoView, meta: Object.keys(tr.meta || {}).map((k) => k.replace(/\$\d*$/, "")).join(","), ui: tr.getMeta("uiEvent") || null, pointer: tr.getMeta("pointer") || null, stack: String(new Error().stack || "").split("\n").slice(1, 9).map((l) => l.replace(/md:\/\/localhost\/app\//, "").slice(0, 70)).join(" | ") }); } catch (e) { add("dispatch?", { e: String(e) }); }
        return was(tr);
      };
      add("hooked", { view: document.body.dataset.view });
    }
    if (dirty) { dirty = false; out({ at: new Date().toISOString(), log }); }
  }, 800);
})();
