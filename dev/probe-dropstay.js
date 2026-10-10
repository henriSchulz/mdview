/* Development probe (dev/rig.sh dropstay): a block moved by its handle — in a long note, far from where the caret stood —
 * leaves the note where it is on screen, and selects what was moved and nothing else. */
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
    const send = (type, target, x, y, dt) => { const ev = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y }); Object.defineProperty(ev, "dataTransfer", { value: dt }); target.dispatchEvent(ev); return ev; };
    const hover = (el) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window, clientX: r.left + 20, clientY: r.top + 8 })); };
    /* what: the text of the block taken by its handle; to: the block it is dropped before */
    const moveBlock = async (what, to) => {
      const from = view.nodeDOM(posOf(what)), dest = view.nodeDOM(posOf(to));
      for (let i = 0; i < 8 && h.dataset.on == null; i++) { hover(from); await sleep(150); }
      o.on = [h.dataset.on, Math.round(h.getBoundingClientRect().top), Math.round(from.getBoundingClientRect().top)];
      const hr = h.getBoundingClientRect(), dt = new DataTransfer();
      const began = send("dragstart", h, hr.left + 6, hr.top + 6, dt);
      const dr = dest.getBoundingClientRect(), x = dr.left + 60, y = dr.top + 3;
      for (let i = 0; i < 3; i++) { send("dragover", document.elementFromPoint(x, y) || dest, x, y, dt); await sleep(40); }
      send("drop", document.elementFromPoint(x, y) || dest, x, y, dt);
      send("dragend", h, x, y, dt);
      await sleep(700);
      return began.defaultPrevented;
    };
    const state = () => { const s = view.state.selection, b = A.blocks.selection(view.state); return { y: Math.round(scrollY), kind: s.node ? "node" : s.empty ? "caret" : "range", from: s.from, to: s.to, blocks: b && [b.from, b.to], dom: String(getSelection()).slice(0, 60) }; };
    for (const [name, what, to, caretAt] of [
      ["a paragraph moved up three, the caret far above at the note's start", "Filler paragraph 24 ", "Filler paragraph 21 ", "top"],
      ["the picture of svg moved up two, the caret far below at the note's end", "<svg", "Filler paragraph 28 ", "end"],
      ["a paragraph moved down, the caret in a block that is out of sight", "Filler paragraph 22 ", "Filler paragraph 26 ", "top"],
    ]) {
      view.dispatch(view.state.tr.setSelection(caretAt === "top" ? PM.state.Selection.atStart(view.state.doc) : PM.state.Selection.atEnd(view.state.doc)));
      view.nodeDOM(posOf(what)).scrollIntoView({ block: "center" }); await sleep(600);
      const y0 = Math.round(scrollY), before = md();
      const refused = await moveBlock(what, to);
      const s = state(), at = posOf(what), node = view.state.doc.nodeAt(at);
      o[name] = { y0, s, refused };
      ok(name + ": it stands at its new place", !refused && md() !== before && md().indexOf(what) < md().indexOf(to) && md().length === before.length, [refused, md().indexOf(what), md().indexOf(to)]);
      ok("… the note stays where it was on screen", Math.abs(s.y - y0) <= 2, [y0, s.y]);
      ok("… what was moved is what is selected, as a block — nothing else, no text", !!s.blocks && s.blocks[0] === at && s.blocks[1] === at + node.nodeSize && (s.dom === "" || what.startsWith(s.dom.slice(0, 20))), s);
    }
  } catch (e) { o.error = String(e && e.stack || e); }
  out("dropstay", o);
})();
