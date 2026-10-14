/* Development probe (dev/rig.sh scrollup): a long note in a folder window scrolled with a REAL wheel (dev/vptr) down and back up —
 * what stands around the note (the tabs, the toolbar, the sidebar, the gear) stays where it is in every frame while the note goes
 * up (Henri, 2026-10-14: "scrolling up in a long document, the controls flicker: the menu bar, the sidebar, the tabs"). It was not
 * the page: WebKit moved them with the note for a frame. So the rig films the screen while the wheel turns and looks at each frame;
 * the probe says where the pointer goes and where the controls are (plan N). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await until(() => MdView.core.folder && MdView.core.folder.tree, 8000);
    const root = MdView.core.folder.root;
    let seenAt = null, plans = 0;
    addEventListener("mousemove", (e) => { seenAt = [e.clientX, e.clientY]; }, true);
    const run = async (cmd, ms) => { out("plan" + ++plans, { cmd }); await sleep(ms + 1200); };
    // (where the screen's points are on the page)
    out("plan" + ++plans, { cmd: "m 100 100 s 80 m 110 110" });
    for (let i = 0; i < 200 && !seenAt; i++) await sleep(50);
    if (!seenAt) throw new Error("the pointer was not heard");
    await sleep(300); const p1 = seenAt.slice(); seenAt = null;
    out("plan" + ++plans, { cmd: "m 310 260" });
    for (let i = 0; i < 200 && !seenAt; i++) await sleep(50);
    await sleep(300);
    const kx = 200 / (seenAt[0] - p1[0]), ky = 150 / (seenAt[1] - p1[1]);
    const S = (x, y) => [Math.round(110 + (x - p1[0]) * kx), Math.round(110 + (y - p1[1]) * ky)], G = (x, y) => S(x, y).join(" ");
    const CONTROLS = ["#tabs", "#toolbar", "#sidebar", "#settings-btn"];
    // the controls' places on the screen, a little inside their edges, for the rig to look at in each frame of its film
    const regions = () => CONTROLS.map((q) => document.querySelector(q)).filter((el) => el && el.getClientRects().length && getComputedStyle(el).visibility === "visible" && +getComputedStyle(el).opacity > 0.5)
      .map((el) => { const r = el.getBoundingClientRect(), a = S(r.left + 8, Math.max(r.top, 0) + 6), b = S(r.right - 8, Math.min(r.bottom, innerHeight) - 6); return { name: "#" + el.id, box: [a[0], a[1], b[0] - a[0], b[1] - a[1]] }; })
      .filter((g) => g.box[2] > 4 && g.box[3] > 4);
    const at = () => G(innerWidth * 0.6, innerHeight * 0.5);
    for (const [label, name, mode] of [["reading", "Long.md", "read"], ["on a ground", "Ground.md", "read"], ["active", "Long.md", "active"], ["active, on a ground", "Ground.md", "active"]]) {
      window.MdHost.post(JSON.stringify({ type: "note", path: root + "/" + name }));
      await until(() => MdView.core.current && MdView.core.current.name === name && !document.body.hasAttribute("data-going"));
      if (document.body.dataset.view !== mode) { MdView.setMode(mode); await until(() => document.body.dataset.view === mode); }
      await sleep(1000); scrollTo(0, 0); await sleep(300);
      await run(`m ${at()} s 100 w 1 90 20`, 90 * 20);
      ok(label + ": the wheel takes it down", scrollY > 1000, scrollY);
      await sleep(600);
      const muts = [], y0 = scrollY;
      const mo = new MutationObserver((list) => { for (const m of list) muts.push(`${m.target.id || m.target.tagName}.${m.attributeName}`); });
      for (const q of CONTROLS) { const el = document.querySelector(q); if (el) mo.observe(el, { attributes: true }); }
      mo.observe(document.body, { attributes: true }); mo.observe(document.documentElement, { attributes: true });
      out("plan" + ++plans, { cmd: `m ${at()} s 100 w -1 80 25`, film: label, regions: regions() });
      await sleep(80 * 25 + 2500);
      mo.disconnect();
      ok(label + ", the wheel up: it goes up, and nothing of the page touches the controls meanwhile", scrollY < y0 - 300 && !muts.length, { y0, y: scrollY, muts: [...new Set(muts)].slice(0, 12) });
    }
  } catch (e) { o.error = String(e && (e.message + " " + e.stack) || e); }
  out("scrollup", o);
})();
