/* Development probe (dev/rig.sh board-improve): strokes chosen on a whiteboard made a little neater by Claude (Improve, board.js):
 * its button in the bar of what is chosen, the strokes smoothed at once, Claude's steps done on them alone — moved, drawn anew,
 * a slip taken away —, what is not chosen left as it was, all of it one step back. The model is a fixed answer
 * (MDVIEW_IMPROVE_FAKE); `real`: Claude itself. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] }, errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const REAL = !!window.__improveReal;
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(800);
    const B = () => window.MdBoard, st = () => B() && B().shown && B().state(), el = () => document.getElementById("board");
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    MdActive.view.focus();
    MdActive.context.INSERT.board(MdActive.view.pm);
    ok("the board opens", await until(() => st() && el().hasAttribute("data-ready")), st());
    await sleep(600);
    // a word written in a shaky hand (wa, a wave; wb, a line that should be straight), a slip (wc), and a stroke not chosen (wx)
    const v = st().view, x0 = v.x + 120, y0 = v.y + 160;
    const wave = Array.from({ length: 24 }, (_, i) => [x0 + i * 6, y0 + Math.sin(i * 1.7) * 3 + (i % 2 ? 1.5 : -1.5)]);
    const line = Array.from({ length: 12 }, (_, i) => [x0 + i * 4, y0 + 40 + (i % 3) * 2]);
    B().inkPut([{ id: "wa", pts: wave, c: "#e5372c", tool: "pen", w: 3 }, { id: "wb", pts: line, c: "#1f6fe5", tool: "pencil", w: 4 },
      { id: "wc", pts: [[x0 + 160, y0 + 60], [x0 + 161, y0 + 61]] }, { id: "wx", pts: [[x0, y0 + 120], [x0 + 3, y0 + 125], [x0 + 60, y0 + 118], [x0 + 80, y0 + 130]] }]);
    // (real: words and a formula in a hurried hand, and a wobbly circle, for Claude to set straight)
    const hand = REAL ? B().claude.write({ x: x0, y: y0 + 180, text: "Hallo Welt\na² + b² = c²", size: 30, mess: 1.5 }).map((it, i) => ({ id: "h" + i, pts: it.pts.map((p) => [p[0], p[1]]), w: it.w })) : [];
    if (REAL) hand.push({ id: "ring", pts: Array.from({ length: 40 }, (_, i) => { const a = (i / 39) * Math.PI * 2.1; return [x0 + 300 + Math.cos(a) * (40 + Math.sin(i) * 4), y0 + 240 + Math.sin(a) * (34 + Math.cos(i * 1.3) * 4)]; }) });
    if (REAL) B().inkPut(hand);
    const was = { wa: B().inkPts("wa"), wb: B().inkPts("wb"), wx: B().inkPts("wx") };
    B().pick(["wa", "wb", "wc", ...hand.map((h) => h.id)]);
    await sleep(300);
    const btn = () => el().querySelector('.bd-pickbar [data-f="improve"], [data-f="improve"]');
    ok("what is chosen has Improve in its bar, with its sign", !!btn() && btn().getAttribute("aria-label") === "Improve" && !!btn().querySelector("svg path"), btn() && btn().outerHTML.slice(0, 160));
    ok("…beside Ask Claude", !!btn() && !!btn().parentElement.querySelector('[data-f="claude"]'));
    const undo0 = st().undo;
    out("chosen", {}); await sleep(700);
    btn().click();
    ok("pressed: it works at once, the strokes smoothed before Claude says anything", st().improving && JSON.stringify(B().inkPts("wa")) !== JSON.stringify(was.wa), st().improving);
    const ends = B().inkPts("wa");
    ok("…their ends where they were", JSON.stringify([ends[0], ends.at(-1)]) === JSON.stringify([was.wa[0], was.wa.at(-1)]), [ends[0], was.wa[0]]);
    ok("while it works, its button stops it", await until(() => btn() && btn().getAttribute("aria-label") === "Stop Improve", 1500), btn() && btn().getAttribute("aria-label"));
    ok("the line under Claude's button says it is improving", /Improving/.test(st().claude.chip), st().claude.chip);
    out("improving", {});
    const t0 = Date.now();
    ok("Claude is done", await until(() => !st().improving, REAL ? 180000 : 10000), st().claude.chip);
    o.seconds = Math.round((Date.now() - t0) / 100) / 10;
    await sleep(200);
    const s1 = st(), wa = B().inkPts("wa"), wb = B().inkPts("wb");
    if (!REAL) {
      ok("fit: the word moved down by what Claude said (5)", wa && Math.abs(wa[0][1] - (was.wa[0][1] + 5)) < 0.2, wa && [wa[0], was.wa[0]]);
      ok("redraw: the shaky line drawn anew, straight and 40 wide", wb && wb.every((p) => Math.abs(p[1] - wb[0][1]) < 0.2) && Math.abs(wb.at(-1)[0] - wb[0][0] - 40) < 0.5, wb && [wb[0], wb.at(-1)]);
      ok("…in its own pen, colour and width", s1.kinds.some((k) => k.startsWith("pencil:")) && s1.inks.includes("#1f6fe5"), s1.kinds);
      ok("del: the slip is gone", !B().inkPts("wc"));
    } else ok("Claude changed the strokes", JSON.stringify(wa) !== JSON.stringify(was.wa) || JSON.stringify(wb) !== JSON.stringify(was.wb), s1.claude.chip);
    ok("what was not chosen is as it was", JSON.stringify(B().inkPts("wx")) === JSON.stringify(was.wx));
    ok("what it made stays chosen", s1.picked.includes("wa") && s1.picked.includes("wb") && !s1.picked.includes("wx"), s1.picked);
    ok("the line says it is done", /Improved/.test(s1.claude.chip), s1.claude.chip);
    ok("all of it is one step back", s1.undo === undo0 + 1, [undo0, s1.undo]);
    out("improved", {}); await sleep(700);
    el().querySelector('[data-do="undo"]').click();
    await sleep(200);
    ok("one Undo: the strokes as they were drawn, the slip there again", JSON.stringify(B().inkPts("wa")) === JSON.stringify(was.wa) && JSON.stringify(B().inkPts("wb")) === JSON.stringify(was.wb) && !!B().inkPts("wc"), B().inkPts("wa")?.[0]);
    // stopped while it works: what was smoothed is one step back as well, and nothing waits on
    if (!REAL) {
      B().pick(["wa", "wb", "wc"]);
      await sleep(200);
      btn().click();
      await sleep(50);
      btn().click();
      ok("pressed again while it works: it stops", await until(() => !st().improving, 1500) && btn().getAttribute("aria-label") === "Improve", st().improving);
      ok("…the smoothing one step back", st().undo === undo0 + 1, st().undo);
      el().querySelector('[data-do="undo"]').click();
      await sleep(400);
      ok("…and nothing of the answer comes after it", JSON.stringify(B().inkPts("wa")) === JSON.stringify(was.wa) && !!B().inkPts("wc"), B().inkPts("wa")?.[0]);
    }
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  if (errs.length) o.steps.push("FAIL errors on the page  " + JSON.stringify(errs.slice(0, 3)));
  out("board-improve", o);
})();
