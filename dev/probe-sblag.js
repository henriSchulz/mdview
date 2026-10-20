/* Development probe (dev/rig.sh sblag): a long note scrolled, and the sidebar opened, in each of the sidebar's layouts — the
 * frames come as often with the sidebar open as with it shut. Henri, 2026-10-20: "the sidebar is extremely laggy: while it is
 * open the whole document lags, and opening it is not smooth at all". Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  const out = (o) => window.MdHost.post(JSON.stringify({ type: "probe", name: "sblag", text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [], figures = {};
  const ok = (name, cond, detail) => results.push({ name, ok: !!cond, ...(cond ? {} : { detail }) });
  // a mark the rig reads the processes' CPU at (dev/rig.sh sblag): phase k begins at mark k
  let marks = 0;
  const mark = async (label) => { window.MdHost.post(JSON.stringify({ type: "probe", name: "m" + ++marks, text: JSON.stringify({ label }) })); await sleep(250); };
  const frames = () => new Promise((r) => requestAnimationFrame(r));
  // the gaps between frames over a stretch of time, while `step` is called at each
  const run = async (ms, step) => {
    const gaps = [];
    let last = await frames();
    const t0 = last;
    while (last - t0 < ms) {
      if (step) step();
      const t = await frames();
      gaps.push(t - last);
      last = t;
    }
    gaps.sort((a, b) => a - b);
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    return { frames: gaps.length, mean: Math.round(mean * 10) / 10, p90: Math.round(gaps[Math.floor(gaps.length * 0.9)]), max: Math.round(gaps[gaps.length - 1]) };
  };
  let dir = 1;
  const scroll = () => {
    const se = document.scrollingElement;
    if (se.scrollTop + innerHeight >= se.scrollHeight - 2) dir = -1;
    else if (se.scrollTop <= 0) dir = 1;
    window.scrollBy({ top: 40 * dir, behavior: "instant" });
  };
  const open = (on) => { if ((document.body.dataset.sidebar === "open") !== on) document.querySelector(".tab-side").click(); };
  try {
    await document.fonts.ready;
    await sleep(1500);
    const root = MdView.core.folder.root;
    window.MdHost.post(JSON.stringify({ type: "note", path: root + "/Long.md" }));
    for (let i = 0; i < 100 && !(MdView.core.current && MdView.core.current.name === "Long.md"); i++) await sleep(50);
    await sleep(1500);
    figures.dpr = devicePixelRatio;
    open(false); await sleep(900);
    for (const lay of ["sheets", "rail", "source", "tiles"]) {
      window.MdPrefs = { ...(window.MdPrefs || {}), sidebarLayout: lay }; MdView.prefsChanged();
      open(false); await sleep(900);
      const f = {};
      await mark(lay + " opening");
      const t = run(700);
      open(true);
      f.opening = await t;
      await sleep(1200); // (the sheets' beginnings drawn)
      await mark(lay + " open, still");
      f.still = await run(1500);
      // scrolled open and shut by turns, three times: the machine's own pace drifts (other work on it), a turn's two figures not
      await mark(lay + " scrolled, open and shut by turns");
      const turns = { open: [], shut: [] };
      for (let i = 0; i < 3; i++) for (const on of [true, false]) {
        open(on); await sleep(800);
        turns[on ? "open" : "shut"].push(await run(1500, scroll));
      }
      const avg = (a) => ({ mean: Math.round(a.reduce((x, y) => x + (y.mean), 0) / a.length * 10) / 10, p90: Math.max(...a.map((y) => y.p90)), max: Math.max(...a.map((y) => y.max)) });
      f.open = avg(turns.open); f.shut = avg(turns.shut);
      open(true); await sleep(900);
      await mark(lay + " closing");
      const t2 = run(700);
      open(false);
      f.closing = await t2;
      await sleep(900);
      await mark(lay + " opening again");
      const t3 = run(700);
      open(true);
      f.again = await t3; // (as it is opened day by day: the layout not chosen anew just before)
      await sleep(600);
      open(false);
      await sleep(900);
      figures[lay] = f;
      await mark("-");
    }
    for (const lay of ["sheets", "rail", "source", "tiles"]) {
      const f = figures[lay];
      // (before: 1.5 to 1.9 times as long a frame, the sidebar's shade a blur painted anew at each step; after: 1.1 to 1.35)
      ok(`${lay}: a note scrolled with the sidebar open gets its frames as with it shut`, f.open.mean <= f.shut.mean * 1.4, { shut: f.shut, open: f.open });
      // (the first time after the layout is chosen, its sheets are drawn for the first time: one frame of that is allowed)
      ok(`${lay}: the sidebar opens in even frames`, f.opening.mean <= 22, f.opening);
      ok(`${lay}: … and opens so again`, f.again.max <= 50 && f.again.mean <= 22, f.again);
      // (shut, the note is laid out again at its new width in the first frame: that one may take longer)
      ok(`${lay}: … and shuts in even frames`, f.closing.max <= 70 && f.closing.mean <= 22, f.closing);
    }
    out({ pass: results.every((r) => r.ok), results, figures });
  } catch (e) {
    out({ pass: false, error: String(e && e.stack || e), results, figures });
  }
})();
