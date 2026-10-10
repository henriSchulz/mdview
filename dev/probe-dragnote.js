/* Development probe (dev/rig.sh dragnote): blocks moved with a REAL pointer (dev/vptr) — by the handle, and a picture by
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

    // every block of the note, also those in columns: [{ pos, node, dom }]
    const blocksAll = () => { const out = []; view.state.doc.descendants((n, p) => { if (n.type.name === "island" || n.type.name === "paragraph" || n.type.name === "heading") { out.push({ pos: p, node: n }); return false; } return true; }); return out; };
    const find = (text) => blocksAll().find((b) => (b.node.attrs.raw || b.node.textContent || "").includes(text));
    const domOf = (b) => view.nodeDOM(b.pos);
    o.kinds = []; view.state.doc.forEach((n) => o.kinds.push(n.type.name + (n.type.name === "columns" ? "(" + n.childCount + ")" : "")));
    const selInfo = () => { const s = view.state.selection, b = A.blocks.selection(view.state); return { kind: s.node ? "node:" + s.node.type.name : s.empty ? "caret" : "range", from: s.from, to: s.to, size: view.state.doc.content.size, blocks: b && [b.from, b.to], dom: String(getSelection()).length, ranges: getSelection().rangeCount, collapsed: getSelection().isCollapsed }; };
    const trial = async (name, what, toText, how, where = "above") => {
      const src = find(what), dst = find(toText);
      if (!src || !dst) { ok(name + ": blocks found", false, [!!src, !!dst]); return; }
      domOf(src).scrollIntoView({ block: "center" }); await sleep(600);
      const sr = (domOf(src).querySelector("svg, .katex, img") || domOf(src)).getBoundingClientRect(), dr = domOf(dst).getBoundingClientRect(), before = md(), w = watch();
      const end = where === "right" ? [dr.right - 6, dr.top + dr.height / 2] : [dr.left + Math.min(60, dr.width / 2), dr.top + 3];
      let from;
      if (how === "handle") {
        await run(`g ${G(sr.left + sr.width / 2, sr.top + Math.min(20, sr.height / 2))} 6 20`, [sr.left + sr.width / 2, sr.top + Math.min(20, sr.height / 2)], 200);
        for (let i = 0; i < 20 && h.dataset.on == null; i++) await sleep(50);
        const hr = h.getBoundingClientRect();
        from = [Math.max(3, hr.left + hr.width / 2), hr.top + hr.height / 2];
        await run(`m ${G(...from)}`, from, 150);
      } else {
        from = [sr.left + sr.width / 2, sr.top + sr.height / 2];
        await run(`g ${G(...from)} 5 20`, from, 150);
      }
      await run(`d s 200 g ${G(from[0] + 8, from[1] - 12)} 5 30 g ${G(...end)} 24 25 s 350 u s 150 g ${G(end[0] + 30, end[1] + 30)} 3 30`, [end[0] + 30, end[1] + 30], 2200);
      w.stop();
      const s = selInfo();
      o[name] = { s, text: w.text, drift: w.drift, changed: md() !== before, heard: { ...heard } };
      for (const k of Object.keys(heard)) delete heard[k];
      ok(name + ": the block was moved", md() !== before, s);
      ok("… no text was selected on the way, and none is after", w.text === 0 && s.dom === 0, [w.text, s]);
      ok("… what is selected after is the moved block and no more", !!s.blocks && s.kind !== "range" && s.to - s.from < s.size / 2, s);
      out("shot-" + name.replace(/\W+/g, "-").slice(0, 30), {});
      await sleep(900);
    };
    // ---- what it looks like when the row of columns itself is the editor's selection, and one block in it is selected as a block
    {
      let colsAt = -1; view.state.doc.forEach((n, p) => { if (n.type.name === "columns") colsAt = p; });
      const mux = find('viewBox="40 56');
      A.blocks.select(view, mux.pos, false);
      await sleep(200);
      o.selectable = PM.state.NodeSelection.isSelectable(view.state.doc.nodeAt(colsAt));
      try { view.dispatch(view.state.tr.setSelection(PM.state.NodeSelection.create(view.state.doc, colsAt))); } catch (e) { o.forceError = String(e); }
      view.focus();
      view.nodeDOM(colsAt).scrollIntoView({ block: "center" });
      await sleep(600);
      o.forced = selInfo();
      out("shot-forced", {}); await sleep(900);
    }
  } catch (e) { o.error = String(e && e.stack || e); }
  out("dragnote", o);
})();
