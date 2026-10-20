/* Development probe (dev/rig.sh pdflag): how late what is drawn on a PDF shows. A stroke's samples are handed to the board at
 * a pen's pace (one every 8 ms); for each, the time from when it was due to the frame after it was taken in — and whether the
 * ink under the hand is on the screen by then. Measured on a bare page, after many strokes, far in, and stroke after stroke
 * at the pace of quick work (the board keeping what was drawn meanwhile). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [], numbers: {} }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const ok = (name, cond, detail) => (post("log", { text: (cond ? "ok " : "FAIL ") + name + " " + JSON.stringify(detail) }), o.steps.push((cond ? "ok   " : "FAIL ") + name + "  " + JSON.stringify(detail)));
  const LIMIT = 12; // (less than a frame at 60 Hz: the next frame shows it)
  try {
    await document.fonts.ready;
    ok("the PDF is shown", await until(() => window.MdPdf && MdPdf.shown && MdPdf.shown.pages.length >= 6 && MdPdf.shown.pages[0].state === "done"), !!window.MdPdf);
    const V = MdPdf.shown, B = await window.MdPage.loadBoard().then(() => window.MdBoard), st = () => B.state();
    const stage = () => document.querySelector("#board .bd-stage");
    MdPdf.test.go(2);
    await sleep(400);
    V.bar.querySelector('[data-do="draw"]').click();
    await until(() => B.shown && document.querySelector("#board[data-open]") && st().pdf, 6000);
    await sleep(800);
    document.querySelector('#board [data-kind="pen"]').click();
    await sleep(100);
    const live = () => document.querySelector("#board .bd-live");
    const ev = (type, x, y) => stage().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, pointerType: "pen", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5 }));
    // (is there ink under the point, on the canvas of the stroke being drawn or the ink's own)
    const inked = (x, y) => {
      const dpr = window.devicePixelRatio || 1;
      for (const c of [live(), document.querySelector("#board .bd-ink")]) {
        const r = c.getBoundingClientRect(), px = Math.round((x - r.left) * dpr * (c.width / (r.width * dpr))), py = Math.round((y - r.top) * dpr * (c.height / (r.height * dpr)));
        const d = c.getContext("2d").getImageData(Math.max(0, px - 3), Math.max(0, py - 3), 7, 7).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 40) return true;
      }
      return false;
    };
    /* One stroke at a pen's pace: n samples, one every `every` ms. Each sample's lag: from when it was due to the next frame after
     * it was handed over. */
    // what the canvas of the stroke under the pen is cleared of at each step, as a share of it (the first of a stroke: all of it, for the new stroke)
    const cleared = [], clear = CanvasRenderingContext2D.prototype.clearRect;
    let first = false;
    CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) { if (this.canvas === live()) { if (first) first = false; else if (watching) cleared.push(Math.abs(w * h) / (this.canvas.width * this.canvas.height)); } return clear.call(this, x, y, w, h); };
    const lags = [], costs = [], gaps = [], ends = [];
    let watching = false, lastFrame = 0;
    const tick = (t) => { if (lastFrame && watching) gaps.push(t - lastFrame); lastFrame = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    let unseen = 0;
    async function stroke(x0, y0, n = 30, every = 8, dx = 7, dy = 0, sway = 10) {
      const t0 = performance.now(), mine = [];
      const at = (i) => [x0 + i * dx, y0 + i * dy + Math.sin(i / 3) * sway];
      for (let i = 0; i <= n; i++) {
        const due = t0 + i * every;
        while (performance.now() < due - 1) await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now() - 1)));
        const [x, y] = at(i);
        const c0 = performance.now();
        if (!i) first = true;
        ev(i ? "pointermove" : "pointerdown", x, y);
        costs.push(performance.now() - c0);
        const seen = i === (n >> 1) ? inked(...at(i - 1)) : true; // (the sample before this one is on a canvas by now — asked once a stroke: reading a canvas back costs)
        frame().then((f) => { const l = f - due; mine.push(l); lags.push(l); });
        if (!seen) unseen++;
      }
      const e0 = performance.now();
      first = true; // (let go: the canvas is emptied whole, once)
      ev("pointerup", ...at(n));
      first = false;
      ends.push(performance.now() - e0);
      await frame();
      return mine;
    }
    const stat = (xs) => { const s = [...xs].sort((a, b) => a - b), q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); return { n: s.length, p50: q(0.5), p95: q(0.95), max: Math.round(s[s.length - 1] || 0) }; };
    const measure = async (name, f) => { lags.length = costs.length = gaps.length = ends.length = 0; unseen = 0; watching = true; await f(); watching = false; await sleep(50); const s = stat(lags); o.numbers[name] = { ...s, unseen, handler: stat(costs), ends: stat(ends), frames: stat(gaps) }; return s; };
    o.numbers.window = [innerWidth, innerHeight, window.devicePixelRatio];
    const W = innerWidth, H = innerHeight;
    // --- a bare page, at the size it was opened at
    const bare = await measure("bare", async () => { for (let k = 0; k < 4; k++) { await stroke(W * 0.25, H * 0.3 + k * 40); await sleep(120); } });
    // --- quick work: strokes one after the other, as fast as a hand writes, for longer than the board waits to keep what is drawn
    const quick = await measure("quick", async () => { for (let k = 0; k < 24; k++) { await stroke(W * 0.2 + (k % 6) * 60, H * 0.45 + Math.floor(k / 6) * 40, 14, 8, 4, 0, 6); await sleep(30 + (k % 3) * 60); } await sleep(1000); });
    // --- many strokes on the page already (a page written full), then quick work again
    for (let k = 0; k < 160; k++) { const y = H * 0.15 + (k % 40) * 14, x = W * 0.15 + Math.floor(k / 40) * 150; ev("pointerdown", x, y); for (let i = 1; i < 40; i++) ev("pointermove", x + i * 3, y + Math.sin(i / 2) * 4); ev("pointerup", x + 120, y); }
    await sleep(1500);
    const full = await measure("full", async () => { for (let k = 0; k < 16; k++) { await stroke(W * 0.2 + (k % 4) * 80, H * 0.5 + Math.floor(k / 4) * 40, 14, 8, 4, 0, 6); await sleep(40 + (k % 3) * 70); } await sleep(1000); });
    // --- far in: the page drawn sharp around the hand
    const s0 = stage().getBoundingClientRect();
    for (let i = 0; i < 12; i++) { stage().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: s0.left + W / 2, clientY: s0.top + H / 2, deltaY: -120, ctrlKey: true })); await sleep(60); }
    await sleep(2500);
    o.numbers.zoom = st().zoom;
    const far = await measure("far", async () => { for (let k = 0; k < 12; k++) { await stroke(W * 0.2 + (k % 4) * 80, H * 0.4 + Math.floor(k / 4) * 50, 14, 8, 4, 0, 6); await sleep(40 + (k % 3) * 70); } await sleep(1000); });
    // (the median: what a hand feels at every stroke — the far end of the spread is what else the machine is doing meanwhile, reported, not judged)
    // (a page written full: its ink drawn anew at each stroke's end takes some of the frames — a little more room there)
    for (const [name, s] of Object.entries({ bare, quick, full, far })) { const most = name === "full" ? LIMIT + 4 : LIMIT; ok(`${name}: what is drawn is on the screen by the frame after its sample, as a rule (median ≤ ${most} ms)`, s.p50 <= most, o.numbers[name]); }
    ok("the window keeps its pace while the pen draws on a bare page (median frame ≤ 20 ms)", o.numbers.bare.frames.p50 <= 20, o.numbers.bare.frames);
    ok("each step of the pen clears and draws only around it, never the whole window", cleared.length > 100 && cleared.every((a) => a < 0.12), { steps: cleared.length, most: Math.round(Math.max(...cleared) * 1000) / 1000 });
    ok("the ink behind the pen is there whenever a sample comes", Object.values(o.numbers).every((x) => typeof x !== "object" || Array.isArray(x) || x.unseen === 0), o.numbers);
    B.close();
    await sleep(600);
    if (errs.length) ok("no script errors", false, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("lag", o);
})();
