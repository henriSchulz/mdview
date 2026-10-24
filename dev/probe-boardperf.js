/* Development probe (dev/rig.sh boardperf): what a whiteboard costs on a slow machine. Henri, 2026-10-24: "the whiteboard
 * lags so that it is not usable". A board made from the "/" menu, written full (300 strokes of a pen that presses), then:
 * strokes at a pen's pace (a sample every 8 ms) — from a sample's due time to the frame after it, and the frames meanwhile;
 * the board moved by a wheel, and zoomed, a step a frame — the gaps between frames; and what letting go of a stroke costs.
 * Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [], numbers: {} }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + "  " + JSON.stringify(detail));
  const stat = (xs) => { const s = [...xs].sort((a, b) => a - b), q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0); return { n: s.length, p50: q(0.5), p95: q(0.95), max: Math.round(s[s.length - 1] || 0), long: s.filter((x) => x > 33).length }; };
  try {
    localStorage.setItem("mdview:board-tools:tray", JSON.stringify({ edge: "bottom", mini: null }));
    await document.fonts.ready;
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, view = A.view.pm;
    A.view.focus();
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, A.schema.nodes.paragraph.create()).scrollIntoView());
    view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    for (const ch of "/whiteb") { view.dispatch(view.state.tr.insertText(ch)); await sleep(30); }
    await sleep(300);
    view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const B = () => window.MdBoard, st = () => B() && B().state && B().state(), el = () => document.getElementById("board");
    ok("the board opens", await until(() => st() && el().hasAttribute("data-ready")), st());
    await sleep(900);
    el().querySelector('[data-kind="pen"]').click();
    await sleep(100);
    const stage = el().querySelector(".bd-stage");
    let pressure = 0.5;
    const ev = (type, x, y) => stage.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, pointerType: "pen", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : pressure }));
    const W = innerWidth, H = innerHeight;
    o.numbers.window = [W, H, window.devicePixelRatio];
    // (written full: 300 strokes of 40 samples each, the pressure changing along them — bands, as a pen draws)
    for (let k = 0; k < 300; k++) {
      const y = H * 0.12 + (k % 30) * (H * 0.025), x = W * 0.08 + Math.floor(k / 30) * (W * 0.085);
      pressure = 0.3; ev("pointerdown", x, y);
      for (let i = 1; i < 40; i++) { pressure = 0.3 + 0.4 * Math.abs(Math.sin(i / 5)); ev("pointermove", x + i * 2.5, y + Math.sin(i / 2) * 5); }
      ev("pointerup", x + 100, y);
      if (k % 20 === 19) await sleep(0);
    }
    await sleep(1500);
    ok("the board holds the strokes", st().items >= 300, st().items);

    let gaps = [], watching = false, last = 0;
    const tick = (t) => { if (watching && last) gaps.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    // --- strokes at a pen's pace
    const lags = [], costs = [], ends = [];
    async function stroke(x0, y0, n = 40, every = 8) {
      const t0 = performance.now(), at = (i) => [x0 + i * 6, y0 + Math.sin(i / 3) * 12];
      for (let i = 0; i <= n; i++) {
        const due = t0 + i * every;
        while (performance.now() < due - 1) await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now() - 1)));
        pressure = 0.3 + 0.4 * Math.abs(Math.sin(i / 5));
        const c0 = performance.now();
        ev(i ? "pointermove" : "pointerdown", ...at(i));
        costs.push(performance.now() - c0);
        frame().then((f) => lags.push(f - due));
      }
      const e0 = performance.now();
      ev("pointerup", ...at(n));
      ends.push(performance.now() - e0);
      await frame();
    }
    gaps = []; watching = true;
    for (let k = 0; k < 10; k++) { await stroke(W * 0.2 + (k % 5) * 90, H * 0.5 + Math.floor(k / 5) * 60); await sleep(150); }
    watching = false;
    o.numbers.draw = { lag: stat(lags), handler: stat(costs), letgo: stat(ends), frames: stat(gaps) };
    await sleep(800);
    // --- moved by a wheel (two fingers on a touchpad): a step a frame
    const wheel = (dy, ctrl = false) => stage.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: W / 2, clientY: H / 2, deltaY: dy, deltaX: 0, ctrlKey: ctrl }));
    gaps = []; watching = true;
    for (let i = 0; i < 90; i++) { wheel(i < 45 ? 12 : -12); await frame(); }
    watching = false;
    o.numbers.pan = stat(gaps);
    await sleep(800);
    gaps = []; watching = true;
    for (let i = 0; i < 60; i++) { wheel(i < 30 ? -8 : 8, true); await frame(); }
    watching = false;
    o.numbers.zoom = stat(gaps);
    await sleep(800);
    // --- the same, the dots switched the other way (what the board's grid costs a frame)
    o.numbers.grid = st().grid !== undefined ? st().grid : document.querySelector("#board .bd-stage").hasAttribute("data-grid");
    el().querySelector('[data-do="grid"]').click();
    await sleep(400);
    gaps = []; watching = true;
    for (let i = 0; i < 90; i++) { wheel(i < 45 ? 12 : -12); await frame(); }
    watching = false;
    o.numbers.panGridToggled = stat(gaps);
    el().querySelector('[data-do="grid"]').click();
    await sleep(400);
    if (errs.length) ok("no script errors", false, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("boardperf", o);
})();
