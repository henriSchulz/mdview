/* Development probe (dev/rig.sh ovswitch): All Notes switched from the folders to all notes, in a folder of some hundred notes —
 * the choice answers at once (the next frame comes soon after the click; Henri, 2026-10-14: "always a lag"), the tiles come after
 * it, a sheet whose beginning is not there yet shows that it is coming (a skeleton), and the beginning fades in when it is there. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 30) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(30); } return false; };
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await until(() => window.MdOverview && MdOverview.isOpen && document.querySelector("#overview .ov-item"), 15000);
    await sleep(1500);
    const ov = document.getElementById("overview"), opt = (v) => ov.querySelector(`[data-seg="scope"] .ov-opt[data-v="${v}"]`);
    // folders → all, three times over (the first switch, and again after the beginnings are known)
    const times = [];
    for (let round = 0; round < 3; round++) {
      opt("folders").click(); await sleep(900);
      const t0 = performance.now();
      opt("all").click();
      const t1 = await frame();
      const pressedAt = opt("all").getAttribute("aria-checked");
      await until(() => ov.querySelectorAll(".ov-item").length > 200, 6000);
      times.push({ firstFrame: Math.round(t1 - t0), tiles: Math.round(performance.now() - t0), pressed: pressedAt });
      if (round === 0) {
        // a sheet not yet drawn: it says so (a skeleton), not a blank sheet
        const blank = [...ov.querySelectorAll(".ov-tile .ov-prev")].filter((p) => !p.innerHTML.trim());
        o.skeleton = blank.length ? getComputedStyle(blank[0]).backgroundImage.slice(0, 60) + " / " + getComputedStyle(blank[0]).animationName : "none blank";
        ok("a sheet whose beginning is still coming shows that it is coming", !blank.length || (getComputedStyle(blank[0]).backgroundImage !== "none" && getComputedStyle(blank[0]).animationName !== "none"), o.skeleton);
        // (for the screenshot: the first three sheets as they are while their beginning is coming)
        { const keep = [...ov.querySelectorAll(".ov-tile .ov-prev")].slice(0, 3).map((p) => [p, p.innerHTML]); keep.forEach(([p]) => { p.innerHTML = ""; }); await sleep(100); out("skel", {}); await sleep(900); keep.forEach(([p, h]) => { p.innerHTML = h; }); }
        // … and its beginning fades in
        const p = blank[0];
        if (p) { await until(() => p.innerHTML.trim(), 8000); ok("… and its beginning fades in when it comes", getComputedStyle(p).animationName !== "none" || Number(getComputedStyle(p).opacity) < 1, [getComputedStyle(p).animationName, getComputedStyle(p).opacity]); }
      }
      await sleep(1500);
    }
    o.times = times;
    ok("the choice answers at once: the next frame within 50 ms of the click, every time", times.every((t) => t.firstFrame < 50 && t.pressed === "true"), times);
  } catch (e) { o.error = String(e && (e.message + " " + e.stack) || e); }
  out("ovswitch", o);
})();
