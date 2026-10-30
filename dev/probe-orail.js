/* Development probe (dev/rig.sh orail): the outline at the right (Velum Refined: viewer/chrome.js #orail) takes its own
 * clicks — in the reading view and in the active mode, where the panel's rail stands at the right too: nothing lies over its
 * rows, and a real click on each goes to its heading and leaves the note as it was (Henri, 2026-10-30: a click there put
 * blocks into the note). The rig moves a real pointer (vptr) as "planN" says. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (cond, what, info) => o.steps.push((cond ? "ok   " : "FAIL ") + what + (cond || info === undefined ? "" : "  " + JSON.stringify(info)));
  let plans = 0;
  const run = async (cmd, ms) => { out("plan" + ++plans, { cmd }); await sleep(ms); };
  try {
    await document.fonts.ready; await sleep(1500);
    // (a folder window — the rig opens the note's folder — with the note in it, the sidebar shut)
    const core = window.MdView.core;
    if (core.folder) { window.MdHost.post(JSON.stringify({ type: "note", path: core.folder.root + "/orail.md" })); await sleep(1500); }
    // the band under the tabs is drawn (in a folder window body::before is the sidebar's card: the band is body::after)
    const band = getComputedStyle(document.body, "::after");
    ok(!!core.folder && band.content !== "none" && band.visibility === "visible" && band.transform === "none" && parseFloat(band.height) > 0 && /linear-gradient/.test(band.backgroundImage),
      "a folder window: the band under the tabs is there, visible, in place", { folder: !!core.folder, content: band.content, visibility: band.visibility, transform: band.transform, height: band.height });
    const rail = document.getElementById("orail");
    if (getComputedStyle(rail).display === "none") throw new Error(`the outline is not shown (window ${innerWidth} px wide; it needs 1100 — start the rig with MDVIEW_RIG_RULE="float; size 1160 800")`);
    const rows = () => [...rail.querySelectorAll(".or-row")];
    const centre = (b) => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const covered = () => rows().map((b, i) => { const hit = document.elementFromPoint(...centre(b)); return hit && b.contains(hit) ? null : [i, hit ? hit.id || String(hit.className) || hit.tagName : "nothing"]; }).filter(Boolean);
    // the real pointer: where the page hears it, against where it was sent (the window's place in the output)
    let seenAt = null;
    addEventListener("pointermove", (e) => { if (e.isTrusted) seenAt = [e.clientX, e.clientY]; }, true);
    const cx = Math.round(innerWidth / 2), cy = Math.round(innerHeight / 2);
    await run(`m ${cx - 20} ${cy - 20} s 80 m ${cx - 10} ${cy - 10}`, 0);
    for (let i = 0; i < 200 && !seenAt; i++) await sleep(50);
    await sleep(300);
    if (!seenAt) throw new Error("the pointer was not heard");
    const off = [cx - 10 - seenAt[0], cy - 10 - seenAt[1]], G = (x, y) => `${Math.round(x + off[0])} ${Math.round(y + off[1])}`;
    const file = () => (window.MdActive && window.MdActive.view && document.body.dataset.view === "active" ? window.MdActive.view.serialize(false) : null);
    const clickAll = async (where) => {
      const before = file();
      for (const b of rows()) { await run(`m ${G(...centre(b))} s 120 d s 60 u`, 700); }
      await sleep(600);
      ok(file() === before, "a real click on each row of the outline leaves the note as it was (" + where + ")", { before, after: file() });
    };
    ok(!covered().length, "nothing lies over the outline's rows (reading view)", covered());
    await clickAll("reading view");
    window.MdView.setMode("active"); await sleep(2500);
    ok(document.body.dataset.view === "active", "the active mode is on", document.body.dataset.view);
    out("shot-active", {}); await sleep(1200);
    ok(getComputedStyle(rail).display !== "none", "the outline stands at the right in the active mode", getComputedStyle(rail).display);
    ok(!covered().length, "nothing lies over the outline's rows (active mode)", covered());
    const blocks = document.querySelectorAll("#active .ProseMirror > *").length;
    await clickAll("active mode");
    ok(document.querySelectorAll("#active .ProseMirror > *").length === blocks, "no block came into the note", [blocks, document.querySelectorAll("#active .ProseMirror > *").length]);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("orail", o);
})();
