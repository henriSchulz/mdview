/* Development probe (dev/rig.sh switching): from note to note with different grounds — one ground goes into the next (the one that
 * was fades away over it), a note on its way keeps the sheet and has one wheel on it, the mode's button no second one
 * (Henri, 2026-10-14: "two loading animations", "the loading animation on the background looks odd"). Shots in between. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 30) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(30); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await until(() => MdView.core.folder && MdView.core.folder.tree, 10000);
    const root = MdView.core.folder.root, open = async (name) => { window.MdHost.post(JSON.stringify({ type: "note", path: root + "/" + name })); await until(() => MdView.core.current && MdView.core.current.name === name && !document.body.hasAttribute("data-going")); };
    await open("Cyan.md"); await sleep(1200);
    const bg = () => document.documentElement.dataset.docBg || "";
    ok("a note with a ground: its ground", bg() === "cyan", bg());
    // to a note without one: the cyan fades away over the window's own colour
    MdPage.going(root + "/Plain.md"); window.MdHost.post(JSON.stringify({ type: "note", path: root + "/Plain.md" }));
    const sheet = () => document.getElementById("content");
    const going = document.body.hasAttribute("data-going");
    ok("on its way, on a ground: the sheet stays (its text hidden), and one wheel", going && getComputedStyle(sheet()).visibility === "visible" && [...sheet().children].every((c) => getComputedStyle(c).visibility === "hidden") && getComputedStyle(document.getElementById("loading")).visibility === "visible", [going, getComputedStyle(sheet()).visibility]);
    const busy = document.querySelector(".seg-btn.busy");
    ok("… and the mode's button no wheel of its own meanwhile", !busy || getComputedStyle(busy, "::after").display === "none");
    await until(() => MdView.core.current && MdView.core.current.name === "Plain.md");
    await sleep(60);
    const was = document.querySelector("body > .ground-was");
    ok("… in the strip of tabs too", !!document.querySelector("#tabs > .ground-was"));
    ok("arrived: the ground that was lies over the new and fades away", !!was && bg() === "" && Number(getComputedStyle(was).opacity) < 1 && Number(getComputedStyle(was).opacity) > 0, was && getComputedStyle(was).opacity);
    out("fade1", {}); await sleep(1200);
    ok("… and is gone after it", !document.querySelector("body > .ground-was"));
    // plain → magenta, and magenta → cyan
    window.MdHost.post(JSON.stringify({ type: "note", path: root + "/Magenta.md" }));
    await until(() => MdView.core.current && MdView.core.current.name === "Magenta.md"); await sleep(80);
    ok("from none to a ground: the window's colour fades away over it", !!document.querySelector("body > .ground-was") && bg() === "magenta");
    out("fade2", {}); await sleep(1200);
    window.MdHost.post(JSON.stringify({ type: "note", path: root + "/Cyan.md" }));
    await until(() => MdView.core.current && MdView.core.current.name === "Cyan.md"); await sleep(80);
    ok("from one ground to another: the same", !!document.querySelector("body > .ground-was") && bg() === "cyan");
    out("fade3", {}); await sleep(1200);
    // in the active mode: on the way to another note, still one wheel at a time — watched over every frame until it is there
    MdView.setMode("active"); await until(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view); await sleep(900);
    const wheels = () => { const l = document.getElementById("loading"), b = document.querySelector(".seg-btn.busy"); return (getComputedStyle(l).visibility === "visible" && Number(getComputedStyle(l).opacity) > 0.05 ? 1 : 0) + (b && getComputedStyle(b, "::after").display !== "none" ? 1 : 0); };
    let most = 0, frames = 0, both = 0;
    window.MdHost.post(JSON.stringify({ type: "note", path: root + "/Magenta.md" }));
    MdPage.going(root + "/Magenta.md");
    for (let t = performance.now(); performance.now() - t < 2500;) { const n = wheels(); most = Math.max(most, n); frames++; if (n > 1) both++; await new Promise((r) => requestAnimationFrame(r)); }
    ok("the active mode, to another note: never two wheels at once", most <= 1 && MdView.core.current.name === "Magenta.md", { most, both, frames });
  } catch (e) { o.error = String(e && (e.message + " " + e.stack) || e); }
  out("switching", o);
})();
