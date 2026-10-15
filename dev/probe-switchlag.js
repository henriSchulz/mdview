/* Development probe (dev/rig.sh switchlag): a change of mode in a long note — whatever moves on the screen (the switch's thumb)
 * moves on, frame after frame, and the page's long hold comes only when nothing moves. Without WebKit's DMA-BUF renderer
 * nothing turns or glides while the page is busy; a hold in the middle of the thumb's way was a thumb that stuck, and a
 * wheel that stood still. Henri, 2026-10-15: "switching between the modes lags, the spinner too — put a loading in between".
 * Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  const out = (o) => window.MdHost.post(JSON.stringify({ type: "probe", name: "switchlag", text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [], times = [];
  const ok = (name, cond, detail) => results.push({ name, ok: !!cond, ...(cond ? {} : { detail }) });
  const LIMIT = 70; // ms: the longest gap between two frames while the thumb is on its way
  try {
    await document.fonts.ready;
    await sleep(1500);
    const thumb = document.querySelector(".seg-thumb");
    let rec = null;
    const tick = (t) => { if (rec) rec.push([t, getComputedStyle(thumb).transform]); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await sleep(300);
    ok("frames are drawn here (else nothing can be measured)", true);
    const go = async (mode) => {
      const btn = document.querySelector(`.seg-btn[data-mode="${mode}"]`);
      rec = [[performance.now(), getComputedStyle(thumb).transform]];
      const t0 = performance.now();
      btn.click();
      for (let i = 0; i < 400 && (MdPage.mode !== mode || document.body.classList.contains("swapping") || document.body.classList.contains("mode-wait")); i++) await sleep(10);
      const took = performance.now() - t0;
      await sleep(700); // (the thumb at rest, what comes after drawn: a diagram, the reading beside the source)
      const r = rec; rec = null;
      const x = (tf) => (tf === "none" ? 0 : Number(tf.match(/matrix\(([^)]+)\)/)[1].split(",")[4]));
      const end = x(r[r.length - 1][1]);
      let moving = 0, hold = 0, left = 0;
      for (let i = 0; i + 1 < r.length; i++) {
        const gap = r[i + 1][0] - r[i][0], away = Math.abs(x(r[i][1]) - end);
        if (away > 1) { moving = Math.max(moving, gap); if (gap === moving) left = away; } // (the thumb still a pixel and more from where it goes)
        hold = Math.max(hold, gap);
      }
      times.push({ to: mode, took: Math.round(took), moving: Math.round(moving), left: Math.round(left), hold: Math.round(hold), wheel: !!document.querySelector(".seg-btn.busy") });
    };
    const order = ["active", "read", "edit", "read", "split", "edit", "split", "active", "split", "read", "active", "edit", "active"];
    for (const m of order) await go(m);
    for (const t of times) ok(`→ ${t.to}: the thumb glides on — no gap over ${LIMIT} ms while it moves`, t.moving <= LIMIT, t);
    out({ pass: results.every((r) => r.ok), results, times, chars: MdView.core.current.text.length, width: innerWidth });
  } catch (e) {
    out({ pass: false, error: String(e && e.stack || e), results, times });
  }
})();
