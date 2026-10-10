/* Development probe (dev/rig.sh tiledrag): a tile of All Notes taken with a REAL pointer (dev/vptr) and held — the picture
 * that goes with the pointer is the browser's own, so only a real drag shows it. The probe says where the tile is and
 * where it is held (plan 2); the rig moves the pointer, looks at the screen while it is held, and measures the picture. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready; await sleep(1200);
    const ov = document.getElementById("overview");
    document.querySelector('#tabs [data-act="overview"]').click();
    await sleep(1500);
    const heard = {}; for (const t of ["dragstart", "dragend"]) document.addEventListener(t, () => { heard[t] = (heard[t] || 0) + 1; }, true);
    // how the compositor's coordinates lie to the page's
    let seenAt = null;
    addEventListener("mousemove", (e) => { seenAt = [e.clientX, e.clientY]; }, true);
    out("plan1", { cmd: "m 200 300 s 80 m 210 310" });
    for (let i = 0; i < 200 && !seenAt; i++) await sleep(50);
    await sleep(300);
    if (!seenAt) throw new Error("the pointer was not heard");
    const off = [210 - seenAt[0], 310 - seenAt[1]];
    const tile = [...ov.querySelectorAll(".ov-tile:not(.ov-folder)")].find((t) => t.querySelector(".ov-prev").children.length > 1), r = tile.getBoundingClientRect();
    // (held to the right of and below where it stood, over the page's empty room)
    const from = [r.left + r.width / 2 + off[0], r.top + r.height / 2 + off[1]], hold = [Math.min(innerWidth - r.width * 2.2, r.right + r.width * 1.5) + off[0], Math.min(innerHeight - r.height * 1.2, r.top + r.height * 1.4) + off[1]];
    o.at = [Math.round(r.left + off[0]), Math.round(r.top + off[1])]; o.tile = [Math.round(r.width), Math.round(r.height)]; o.hold = hold.map(Math.round); o.win = [innerWidth, innerHeight]; o.dpr = devicePixelRatio;
    out("plan2", { cmd: `m ${Math.round(from[0])} ${Math.round(from[1])} s 200 d s 200 g ${o.hold[0]} ${o.hold[1]} 16 20 s 2600 u`, at: o.at, tile: o.tile, hold: o.hold });
    for (let i = 0; i < 160 && !heard.dragend; i++) await sleep(50);
    ok("the tile was taken by the pointer and let go again", heard.dragstart === 1 && heard.dragend === 1, heard);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("tiledrag", o);
})();
