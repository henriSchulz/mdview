/* Development probe (dev/rig.sh dragreal): blocks moved with a REAL pointer (dev/vptr) — by the handle, and a picture by
 * itself. What the browser does on its own with a held button is in this check: nothing but the moved block may end up
 * selected, no text may be selected on the way, and the note may not jump. The probe says where the pointer is to go
 * (plan N), the rig moves it, the probe looks at what happened. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(900); MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(400);
    const A = MdActive, view = A.view.pm, md = () => A.view.serialize(false), h = document.querySelector(".blk-h");
    const posOf = (text) => { let at = -1; view.state.doc.forEach((n, p) => { if (at < 0 && (n.textContent.includes(text) || (n.attrs.raw || "").includes(text))) at = p; }); return at; };
    // where the pointer is, as the page hears it; and how the compositor's coordinates lie to the page's
    let seenAt = null, plans = 0;
    addEventListener("mousemove", (e) => { seenAt = [e.clientX, e.clientY, performance.now()]; }, true);
    const act = async (cmd, wait = 400) => { const t = performance.now(); out("plan" + ++plans, { cmd }); for (let i = 0; i < 400 && !(window.__ran >= plans); i++) { await sleep(50); if (performance.now() - t > 15000) break; } await sleep(wait); };
    // (the rig cannot call in: it is done when the pointer has been heard at the plan's last place, or after its time)
    const run = async (cmd, last, ms) => { out("plan" + ++plans, { cmd }); const t = performance.now(); while (performance.now() - t < ms + 6000) { await sleep(40); if (seenAt && Math.hypot(seenAt[0] - last[0], seenAt[1] - last[1]) < 3 && performance.now() - t > ms) break; } await sleep(500); };
    const heard = {}; for (const t of ["dragstart", "dragover", "drop", "dragend", "mousedown", "mouseup", "pointercancel", "selectstart"]) document.addEventListener(t, (e) => { heard[t] = (heard[t] || 0) + 1; if (t === "mousedown" || t === "dragstart") heard[t + "On"] = (e.target.className || e.target.tagName) + ""; }, true);
    // (what the browser itself selects — a selection that reaches outside the note's text is none the editor made)
    const strays = []; document.addEventListener("selectstart", (e) => { heard.selectstartKept = (heard.selectstartKept || 0) + (e.defaultPrevented ? 0 : 1); });
    document.addEventListener("selectionchange", () => { const sl = getSelection(); if (sl.rangeCount && !sl.isCollapsed && (!view.dom.contains(sl.anchorNode) || !view.dom.contains(sl.focusNode))) strays.push([(sl.anchorNode.parentElement || sl.anchorNode).className || sl.anchorNode.nodeName, String(sl).length]); });
    let off = [0, 0];
    seenAt = null;
    out("plan" + ++plans, { cmd: "m 200 300 s 80 m 210 310" });
    for (let i = 0; i < 200 && !seenAt; i++) await sleep(50);
    await sleep(300);
    if (!seenAt) throw new Error("the pointer was not heard");
    off = [210 - seenAt[0], 310 - seenAt[1]];
    o.off = off;
    const G = (x, y) => `${Math.round(x + off[0])} ${Math.round(y + off[1])}`;
    // what is watched while the pointer works: the most text ever selected, how far the note ever was from where it stood
    const watch = () => { const y0 = scrollY, w = { text: 0, drift: 0, y0 }; const s = () => { const t = String(getSelection()).length; if (t > w.text) w.text = t; }, sc = () => { w.drift = Math.max(w.drift, Math.abs(scrollY - y0)); }; document.addEventListener("selectionchange", s); addEventListener("scroll", sc, true); w.stop = () => { document.removeEventListener("selectionchange", s); removeEventListener("scroll", sc, true); }; return w; };
    const state = () => { const s = view.state.selection, b = A.blocks.selection(view.state); return { kind: s.node ? "node" : s.empty ? "caret" : "range", from: s.from, to: s.to, blocks: b && [b.from, b.to], dom: String(getSelection()).length }; };

    // ---- by the handle: a paragraph taken three blocks up
    {
      const what = "Filler paragraph 14 ", to = "Filler paragraph 11 ";
      view.dispatch(view.state.tr.setSelection(PM.state.Selection.atStart(view.state.doc)));
      view.nodeDOM(posOf(what)).scrollIntoView({ block: "center" }); await sleep(600);
      const fr = view.nodeDOM(posOf(what)).getBoundingClientRect();
      await run(`g ${G(fr.left + 40, fr.top + 10)} 6 20`, [fr.left + 40, fr.top + 10], 200);
      for (let i = 0; i < 20 && h.dataset.on == null; i++) await sleep(50);
      const hr = h.getBoundingClientRect(), tr = view.nodeDOM(posOf(to)).getBoundingClientRect(), before = md(), w = watch();
      o.handle = { on: h.dataset.on != null, rect: [hr.left, hr.top, hr.width, hr.height] };
      const end = [tr.left + 80, tr.top + 3], grip = [Math.max(3, hr.left + hr.width / 2), hr.top + hr.height / 2];
      await run(`m ${G(...grip)}`, grip, 150);
      o.handle.under = (document.elementFromPoint(...grip) || {}).className;
      await run(`d s 200 g ${G(grip[0] + 30, grip[1] - 12)} 5 30 g ${G(...end)} 20 25 s 300 u s 100 g ${G(end[0] + 40, end[1] + 40)} 3 30`, [end[0] + 40, end[1] + 40], 1900);
      w.stop();
      const s = state(), at = posOf(what), node = view.state.doc.nodeAt(at);
      o.byHandle = { s, w: { text: w.text, drift: w.drift }, y: [w.y0, scrollY], heard: { ...heard } };
      ok("a paragraph taken by its handle with the pointer: it stands three blocks up", md() !== before && md().indexOf(what) < md().indexOf(to) && md().length === before.length, [md().indexOf(what), md().indexOf(to)]);
      ok("… on the way no text was selected", w.text === 0 || w.text <= what.length + 60, w.text);
      ok("… the note did not jump (it was in sight all along)", w.drift <= 4 && Math.abs(scrollY - w.y0) <= 4, [w.y0, scrollY, w.drift]);
      ok("… what was moved is selected as a block, and nothing else", !!s.blocks && s.blocks[0] === at && s.blocks[1] === at + node.nodeSize, s);
      ok("… the press on the handle began no selection of the browser's own, and none ever reached outside the note's text", !heard.selectstartKept && !strays.length, [heard, strays.slice(0, 4)]);
    }
    // ---- a picture of svg pressed and pulled itself, two blocks up
    {
      const what = "<svg", to = "Filler paragraph 29 ";
      view.dispatch(view.state.tr.setSelection(PM.state.Selection.atEnd(view.state.doc)));
      view.nodeDOM(posOf(what)).scrollIntoView({ block: "center" }); await sleep(600);
      const pr = view.nodeDOM(posOf(what)).querySelector("svg").getBoundingClientRect(), tr = view.nodeDOM(posOf(to)).getBoundingClientRect(), before = md(), w = watch();
      const from = [pr.left + pr.width / 2, pr.top + pr.height / 2], end = [tr.left + 80, tr.top + 3];
      await run(`g ${G(...from)} 5 20 s 150 d s 150 g ${G(from[0] + 6, from[1] - 14)} 4 30 g ${G(...end)} 20 25 s 300 u s 100 g ${G(end[0] + 40, end[1] + 40)} 3 30`, [end[0] + 40, end[1] + 40], 1900);
      w.stop();
      const s = state(), at = posOf(what), node = view.state.doc.nodeAt(at);
      o.byPicture = { s, w: { text: w.text, drift: w.drift }, y: [w.y0, scrollY] };
      ok("a picture of svg pressed and pulled with the pointer: it stands above that paragraph", md() !== before && md().indexOf(what) < md().indexOf(to) && md().length === before.length && (md().match(/<svg/g) || []).length === 1, [md().indexOf(what), md().indexOf(to)]);
      ok("… on the way no text was selected", w.text === 0, w.text);
      ok("… the note did not jump", w.drift <= 4 && Math.abs(scrollY - w.y0) <= 4, [w.y0, scrollY, w.drift]);
      ok("… the picture is what is selected, as a block", !!s.blocks && s.blocks[0] === at && s.blocks[1] === at + node.nodeSize && s.dom === 0, s);
    }
    // ---- a picture only clicked: nothing moves, nothing of the text is selected
    {
      const pr = view.nodeDOM(posOf("<svg")).querySelector("svg").getBoundingClientRect(), before = md(), w = watch(), p = [pr.left + pr.width / 2, pr.top + pr.height / 2];
      await run(`g ${G(...p)} 4 20 s 100 d s 80 u s 100 g ${G(p[0] + 200, p[1] + 60)} 3 30`, [p[0] + 200, p[1] + 60], 500);
      w.stop();
      ok("a picture only clicked with the pointer: nothing moves, no text is selected", md() === before && w.text === 0, [w.text]);
      const dlg = document.getElementById("dlg");
      await sleep(400);
      o.afterClick = { dlg: dlg && dlg.hasAttribute("data-open"), s: state() };
      ok("… and the click opens it: its code, in the dialog", !!o.afterClick.dlg && dlg.dataset.kind !== "ai", o.afterClick);
      if (dlg && dlg.hasAttribute("data-open")) dlg.querySelector('[data-do="cancel"]').click();
    }
  } catch (e) { o.error = String(e && e.stack || e); }
  out("dragreal", o);
})();
