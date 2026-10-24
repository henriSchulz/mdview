/* Development probe (dev/rig.sh blockperf): what selecting blocks with a rectangle and dragging a block by its handle cost in
 * a long note. Henri, 2026-10-24: lags "beim Block-Select, Scrollen, Block Drag & Drop". A mouse moves several times a frame
 * (four here, as a mouse of 240 Hz does): the frames meanwhile, and the time the page's handlers take for each move.
 * Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
  const o = { steps: [], numbers: {} }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + "  " + JSON.stringify(detail));
  const stat = (xs) => { const s = [...xs].sort((a, b) => a - b), q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10 / 10 || 0); return { n: s.length, p50: q(0.5), p95: q(0.95), max: Math.round(s[s.length - 1] || 0), long: s.filter((x) => x > 33).length }; };
  try {
    await document.fonts.ready;
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(800);
    const view = MdActive.view.pm, pm = () => view.dom.getBoundingClientRect();
    ok("a long note in the active mode", view.state.doc.childCount > 200, view.state.doc.childCount);
    const MOVES = 4, FRAMES = 120;
    let gaps = [], watching = false, last = 0;
    const tick = (t) => { if (watching && last) gaps.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const mouse = (type, x, y, target) => { const t = target || document.elementFromPoint(x, y) || document.body; const c0 = performance.now(); t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === "mouseup" ? 0 : 1 })); return performance.now() - c0; };
    // --- nothing moving: what a frame costs at rest (the floor the others are read against)
    gaps = []; watching = true;
    for (let f = 0; f < 60; f++) await frame();
    watching = false;
    o.numbers.rest = stat(gaps);
    // --- a rectangle pulled from the margin left of the text, down over the blocks
    {
      const x0 = Math.max(4, pm().left - 24), y0 = 90, costs = [];
      mouse("mousedown", x0, y0);
      gaps = []; watching = true;
      for (let f = 0; f < FRAMES; f++) {
        for (let m = 0; m < MOVES; m++) { const k = f * MOVES + m; costs.push(mouse("mousemove", x0 + 60 + (k % 7), y0 + 10 + k * 1.2)); }
        await frame();
      }
      watching = false;
      mouse("mouseup", x0 + 60, y0 + 10 + FRAMES * MOVES * 1.2);
      await sleep(200);
      const sel = document.querySelectorAll(".blk-picked, [data-blk-picked], .ProseMirror-selectednode").length;
      o.numbers.rubber = { frames: stat(gaps), handler: stat(costs), picked: sel };
      view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, 1)));
      await sleep(300);
    }
    // --- a block dragged by its handle, down the window (window.__variants: sheets put on meanwhile, one run each, to find what a frame costs)
    for (const hide of (window.__variants || [null])) {
      const css = hide && document.head.appendChild(Object.assign(document.createElement("style"), { textContent: hide }));
      const p = [...view.dom.children].find((c) => c.matches("p") && c.getBoundingClientRect().top > 150);
      const r = p.getBoundingClientRect();
      mouse("mousemove", r.left + 20, r.top + 5, p);
      await sleep(400);
      const handle = document.querySelector(".blk-h");
      const hr = handle.getBoundingClientRect();
      ok("the handle shows beside the block", hr.width > 0, [hr.left, hr.top]);
      const dt = new DataTransfer(), costs = [];
      handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, clientX: hr.left + 4, clientY: hr.top + 4, dataTransfer: dt }));
      await sleep(50);
      gaps = []; watching = true;
      for (let f = 0; f < FRAMES; f++) {
        for (let m = 0; m < MOVES; m++) {
          const k = f * MOVES + m, x = r.left + 40, y = Math.min(innerHeight - 80, r.top + 10 + k * 0.9), t = document.elementFromPoint(x, y) || document.body;
          const c0 = performance.now();
          t.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
          costs.push(performance.now() - c0);
        }
        await frame();
      }
      watching = false;
      document.querySelector(".blk-h").dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: dt }));
      if (css) css.remove();
      await sleep(400);
      o.numbers["drag" + (hide ? " with " + hide : "")] = { frames: stat(gaps), handler: stat(costs) };
    }
    if (errs.length) ok("no script errors", false, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("blockperf", o);
})();
