/* Development probe (dev/rig.sh splitscroll): two notes side by side, the one in the window scrolled with a REAL wheel (dev/vptr)
 * — down and all the way up again: its first line comes back (Henri, 2026-10-14: "in the main document I cannot scroll to the very
 * top any more"). The beside one too. The probe says where the pointer goes (plan N). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await until(() => MdView.core.folder && MdView.core.folder.tree, 8000);
    // (two side by side want a window of some width: in a narrower one the page is made smaller until it has it)
    if (innerWidth < 1100) { window.MdHost.post(JSON.stringify({ type: "zoom", step: -Math.ceil((1 - innerWidth / 1100) * 10) })); await sleep(700); }
    const root = MdView.core.folder.root;
    window.MdHost.post(JSON.stringify({ type: "note", path: root + "/Main.md" }));
    await until(() => MdView.core.current && MdView.core.current.name === "Main.md" && !(window.MdOverview && MdOverview.isOpen));
    await sleep(800);
    MdPage.splitOpen({ path: root + "/Beside.md" });
    await until(() => document.body.hasAttribute("data-split") && /Beside/.test(document.querySelector("#split .split-doc")?.textContent || ""));
    await sleep(900);
    const gone = []; new MutationObserver(() => { if (!document.body.hasAttribute("data-split") && !gone.length) gone.push({ y: scrollY, t: Math.round(performance.now()), stack: new Error().stack.slice(0, 200) }); }).observe(document.body, { attributes: true, attributeFilter: ["data-split"] });
    window.__gone = gone;
    let seenAt = null, plans = 0;
    addEventListener("mousemove", (e) => { seenAt = [e.clientX, e.clientY]; }, true);
    const run = async (cmd, ms) => { out("plan" + ++plans, { cmd }); await sleep(ms + 1200); };
    // (where the screen's points are on the page — two of them: the page may be shown smaller than the screen)
    out("plan" + ++plans, { cmd: "m 100 100 s 80 m 110 110" });
    for (let i = 0; i < 200 && !seenAt; i++) await sleep(50);
    if (!seenAt) throw new Error("the pointer was not heard");
    await sleep(300); const p1 = seenAt.slice(); seenAt = null;
    out("plan" + ++plans, { cmd: "m 310 260" });
    for (let i = 0; i < 200 && !seenAt; i++) await sleep(50);
    await sleep(300);
    const kx = 200 / (seenAt[0] - p1[0]), ky = 150 / (seenAt[1] - p1[1]), G = (x, y) => `${Math.round(110 + (x - p1[0]) * kx)} ${Math.round(110 + (y - p1[1]) * ky)}`;
    const h1 = () => document.querySelector("#content h1"), top0 = h1().getBoundingClientRect().top, mainAt = G(innerWidth * 0.25, innerHeight * 0.5);
    ok("two notes side by side, the window's at its top", document.body.hasAttribute("data-split") && scrollY === 0 && top0 > 0, [document.body.hasAttribute("data-split"), innerWidth, scrollY, top0]);
    await run(`m ${mainAt} s 100 w 1 25 25`, 25 * 25);
    const down = scrollY;
    ok("the wheel over the note in the window: it goes down, the other stays beside it", down > 300 && document.body.hasAttribute("data-split"), [down, gone]);
    await run(`m ${mainAt} s 100 w -1 60 25`, 60 * 25);
    ok("… and all the way up again: its first line where it was", scrollY === 0 && Math.abs(h1().getBoundingClientRect().top - top0) < 2, [scrollY, h1().getBoundingClientRect().top, top0]);
    // the one beside: down and up as well, the window's note stays where it is
    const b = document.querySelector("#split .split-body"), sideAt = G(innerWidth * 0.8, innerHeight * 0.5);
    await run(`m ${sideAt} s 100 w 1 25 25`, 25 * 25);
    const bdown = b.scrollTop;
    ok("the wheel over the one beside: it goes down, the window's stays", bdown > 300 && scrollY === 0, [bdown, scrollY]);
    await run(`m ${sideAt} s 100 w -1 60 25`, 60 * 25);
    ok("… and up again to its top", b.scrollTop === 0, b.scrollTop);
    // and the window's again, after the other was scrolled
    await run(`m ${mainAt} s 100 w 1 25 25`, 25 * 25);
    await run(`m ${mainAt} s 100 w -1 60 25`, 60 * 25);
    ok("the window's again after that: down and up to its first line", scrollY === 0 && Math.abs(h1().getBoundingClientRect().top - top0) < 2, [scrollY, h1().getBoundingClientRect().top, top0]);
    // the same in the active mode, and on a note with a ground (Henri's notes are mostly both)
    const strip = () => { const t = document.getElementById("tabs"); return t && document.body.hasAttribute("data-tabs") ? t.getBoundingClientRect().bottom : 0; };
    const first = () => { const v = document.body.dataset.view; if (v === "edit") { const e = document.querySelector("#editor, #ed-wrap"); return e ? e.getBoundingClientRect() : { top: -999 }; } return (document.querySelector(v === "active" ? "#active h1" : "#content h1") || {}).getBoundingClientRect?.() || { top: -999 }; };
    for (const [label, setup] of [["in the active mode", async () => { MdView.setMode("active"); await until(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view); await sleep(900); }],
      ["on a note with a ground", async () => { MdView.setMode("read"); await sleep(500); window.MdHost.post(JSON.stringify({ type: "note", path: root + "/Ground.md" })); await until(() => MdView.core.current && MdView.core.current.name === "Ground.md"); await sleep(1200); }],
      ["… with a ground, in the active mode", async () => { MdView.setMode("active"); await until(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view); await sleep(900); }],
      ["the note beside its own reading, in the source", async () => { MdView.setMode("edit"); await until(() => document.body.dataset.view === "edit"); await sleep(500); MdPage.splitOpen(null); await until(() => MdPage.splitState().kind === "self"); await sleep(900); }],
      ["… the same in the reading view", async () => { MdView.setMode("read"); await sleep(900); }]]) {
      await setup();
      const sp = document.body.hasAttribute("data-split"), t0 = first().top;
      await run(`m ${mainAt} s 100 w 1 25 25`, 25 * 25);
      const d = scrollY;
      await run(`m ${mainAt} s 100 w -1 80 25`, 80 * 25);
      ok(label + ": down and all the way up, its first line under the tabs, as it was", sp && document.body.hasAttribute("data-split") && d > 300 && scrollY === 0 && Math.abs(first().top - t0) < 2 && first().top >= strip(), { split: sp, down: d, y: scrollY, top: first().top, t0, strip: strip() });
    }
  } catch (e) { o.error = String(e && (e.message + " " + e.stack) || e) + " | split: " + document.body.hasAttribute("data-split") + " overview: " + !!(window.MdOverview && MdOverview.isOpen) + " " + JSON.stringify(window.__gone); }
  out("splitscroll", o);
})();
