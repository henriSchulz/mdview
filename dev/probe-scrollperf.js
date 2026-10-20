/* Development probe (dev/rig.sh scrollperf): what a frame costs while a long note — without a ground, on a run of two colours, on
 * dots, on a grid — is scrolled in each mode, and while a PDF of sixty pages is: the gaps between the frames of
 * requestAnimationFrame while the page moves by a step each frame (median, p95, how many over 33 ms). Henri, 2026-10-20:
 * "the app has performance problems on Linux when scrolling, lags, in PDFs too — not in the browser on other devices", and
 * "it performs worst when a background is set in the document". A ground held with `background-attachment: fixed` makes
 * WebKit paint the whole window anew at every step of a scroll (it cannot move what it drew): no element may have one.
 * Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [], runs: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const FRAMES = 150;
  // (the gaps between frames while the scroller moves by `step` each frame, down and then back up)
  let most = 0; // (how far the scroller went: a run that moved nothing measured nothing)
  const frames = (sc, step) => new Promise((done) => {
    most = 0;
    const gaps = []; let last = 0, i = 0;
    const top0 = sc.scrollTop;
    const tick = (t) => {
      if (last) gaps.push(t - last);
      last = t;
      sc.scrollTop = top0 + step * (i < FRAMES / 2 ? i : FRAMES - i);
      most = Math.max(most, Math.round(sc.scrollTop - top0));
      if (++i < FRAMES) requestAnimationFrame(tick); else done(gaps);
    };
    requestAnimationFrame(tick);
  });
  // (the rig reads the CPU time of the app and its web process when it sees cpuA<k> and cpuB<k>: the work a frame costs, which
  // other work on the machine does not stretch as it stretches the gaps)
  let runs = 0;
  const measured = async (f) => { const k = ++runs; out("cpuA" + k, {}); await sleep(150); const r = await f(); out("cpuB" + k, {}); await sleep(150); return r; };
  const stats = (gaps) => { const g = gaps.slice().sort((a, b) => a - b), q = (p) => Math.round(g[Math.min(g.length - 1, Math.floor(g.length * p))] * 10) / 10; return { median: q(0.5), p95: q(0.95), long: g.filter((x) => x > 33).length, n: g.length }; };
  // (nothing on the page holds its picture at the window: such a background is the window painted anew at each step)
  const fixedBackgrounds = () => [document.documentElement, ...document.querySelectorAll("*")].flatMap((el) => [null, "::before", "::after"].map((p) => [el, p, getComputedStyle(el, p)]))
    .filter(([, , cs]) => cs.backgroundImage !== "none" && /fixed/.test(cs.backgroundAttachment)).map(([el, p]) => (el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")) + (p || ""));
  // (a scroller that is there to be seen: what a mode left behind stays in the page, out of sight)
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 50 && r.height > 50 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && el.checkVisibility({ visibilityProperty: true, opacityProperty: true }); };
  try {
    await until(() => MdView.core.folder && MdView.core.folder.tree);
    await document.fonts.ready;
    const root = MdView.core.folder.root, html = document.documentElement;
    const open = async (name) => {
      window.MdHost.post(JSON.stringify({ type: "note", path: root + "/" + name }));
      await until(() => MdView.core.current && MdView.core.current.path === root + "/" + name);
      await sleep(1500);
    };
    const mode = async (m) => {
      if (MdPage.mode === m) return;
      const b = document.querySelector(`.seg-btn[data-mode="${m}"]`);
      if (b) b.click();
      await until(() => MdPage.mode === m && !document.body.classList.contains("swapping") && !document.body.classList.contains("mode-wait"));
      await sleep(1200);
    };
    if (window.MdOverview && MdOverview.shown) MdOverview.close();
    for (const [file, bg] of window.__scrollperfPdf ? [] : [["Plain.md", ""], ["Run.md", "cyan"], ["Dots.md", "dots"], ["Grid.md", "grid"]]) {
      await open(file);
      ok(`${file}: the note has its ground (${bg || "none"})`, (html.dataset.docBg || "") === bg, html.dataset.docBg);
      for (const m of ["read", "active", "edit", "split"]) {
        await mode(m);
        // (the source and the split scroll a box of their own; the reading and the active mode the window)
        const sc = [document.scrollingElement, ...[...document.querySelectorAll("body *")].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && shown(el))]
          .filter((el) => el.scrollHeight > el.clientHeight + 400).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || document.scrollingElement;
        sc.scrollTop = 0; await sleep(300);
        if (bg) { const f = fixedBackgrounds(); ok(`${file}, ${m}: nothing holds its picture at the window (background-attachment: fixed)`, f.length === 0, f); }
        const name = sc === document.scrollingElement ? "window" : (sc.id || sc.className || sc.tagName).toString().split(" ")[0];
        o.runs.push({ what: `${bg || "plain"}/${m}`, ...stats(await measured(() => frames(sc, 24))), box: name, moved: most });
        ok(`${file}, ${m}: the note went down while it was measured`, most > 1000, [name, most]);
        await sleep(400);
      }
      await mode("read");
    }
    // a PDF of sixty pages
    await open("Long.pdf");
    await until(() => document.querySelector(".pdfv canvas"), 10000);
    await sleep(2500);
    const sc = document.scrollingElement;
    o.runs.push({ what: "pdf/60 pages", ...stats(await measured(() => frames(sc, 40))), box: "window", moved: most });
    const canv = [...document.querySelectorAll(".pdfv canvas")];
    o.pdf = { canvases: canv.length, megapixels: Math.round(canv.reduce((s, c) => s + c.width * c.height, 0) / 1e5) / 10, page: canv[0] ? [canv[0].width, canv[0].height] : null, dpr: devicePixelRatio };
    ok("the PDF's pages are drawn", canv.length > 0, canv.length);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("scrollperf", o);
})();
