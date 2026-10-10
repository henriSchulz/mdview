/* Development probe (dev/rig.sh board-enter): stepping into a whiteboard — what is on it is there as it comes up, and it
 * is shown as the picture in the note shows it, whatever was last looked at. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(1200);
    const pic = () => [...document.querySelectorAll("#content img, #active img")].find((i) => i.offsetParent && MdView.core.board.is(i));
    const el = () => document.getElementById("board");
    const seen = [];
    // (opened once and shut, so that the board's code is loaded: what is timed is stepping in, not loading code)
    MdView.core.board.open(pic());
    for (let i = 0; i < 300 && !(window.MdBoard && MdBoard.state()); i++) await sleep(20);
    await sleep(600); MdBoard.close(); await sleep(700);
    MdBoard.open(pic());
    // (from the first moment it can be seen: what it holds then)
    for (let i = 0; i < 80; i++) { const b = el(), st = MdBoard.state(); if (b && b.dataset.open != null) seen.push({ t: i * 10, items: st && st.items, ready: b.dataset.ready != null }); await sleep(10); }
    ok("as it comes up, what is on it is on it already — it is not filled in after", seen.length > 0 && seen[0].items === 2 && seen[0].ready, seen.slice(0, 3));
    await sleep(500);
    const st = MdBoard.state(), stage = el().querySelector(".bd-stage").getBoundingClientRect();
    // the strokes lie in [0,600]x[0,300]: their middle is the stage's middle, all of them in sight
    const z = st.view.z, cx = (300 - st.view.x) * z, cy = (150 - st.view.y) * z, left = (0 - st.view.x) * z, right = (600 - st.view.x) * z;
    o.view = st.view; o.stage = [stage.width, stage.height];
    ok("it shows the whole of it, in the middle — not the far corner last looked at", Math.abs(cx - stage.width / 2) < 2 && Math.abs(cy - stage.height / 2) < 2 && left >= 0 && right <= stage.width && z <= 1 && z > 0.2, [st.view, cx, cy, stage.width, stage.height]);
    out("shown", {});
    await sleep(700);
    MdBoard.close(); await sleep(700);
    MdBoard.open(pic());
    await sleep(900);
    const again = MdBoard.state();
    ok("left and entered again: the same sight", Math.abs(again.view.x - st.view.x) < 1 && Math.abs(again.view.z - st.view.z) < 0.001, [st.view, again.view]);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("enter", o);
})();
