/* Development probe (dev/rig.sh sbscroll): the sidebar's own list scrolled, in each of its layouts — a folder of notes rich in
 * what a sheet's beginning draws (formulas, code, tables, pictures). Henri, 2026-10-24: it lags "vor allem im File Explorer".
 * The gaps between frames while the list moves by a step each frame (median, p95, how many over 33 ms).
 * Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const o = { steps: [], numbers: {} };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + "  " + JSON.stringify(detail));
  const stat = (xs) => { const s = [...xs].sort((a, b) => a - b), q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0); return { n: s.length, p50: q(0.5), p95: q(0.95), long: s.filter((x) => x > 33).length }; };
  const open = (on) => { if ((document.body.dataset.sidebar === "open") !== on) document.querySelector(".tab-side").click(); };
  // (what scrolls in the sidebar: the element of it that can, the largest)
  const scroller = () => [...document.querySelectorAll("#sidebar *")].filter((e) => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY) && e.getBoundingClientRect().height > 100).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  try {
    await document.fonts.ready;
    await sleep(1500);
    open(true); await sleep(1200);
    for (const lay of ["sheets", "rail", "source", "tiles", "plain"]) {
      window.MdPrefs = { ...(window.MdPrefs || {}), sidebarLayout: lay }; MdView.prefsChanged();
      await sleep(2000); // (the sheets' beginnings drawn)
      const sc = scroller();
      if (!sc) { ok(lay + ": something in the sidebar scrolls", false, null); continue; }
      const gaps = []; let last = await frame(), dir = 1;
      for (let i = 0; i < 180; i++) {
        if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) dir = -1; else if (sc.scrollTop <= 0) dir = 1;
        sc.scrollTop += 14 * dir;
        const t = await frame(); gaps.push(t - last); last = t;
      }
      o.numbers[lay] = { ...stat(gaps), list: sc.className || sc.tagName, rows: sc.querySelectorAll("*").length };
    }
  } catch (e) { o.error = String(e && e.stack || e); }
  out("sbscroll", o);
})();
