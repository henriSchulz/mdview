/* Development probe (dev/rig.sh railfav): a folder pulled onto the sidebar's rail with a REAL pointer (dev/vptr) becomes a
 * favourite — the browser's own drag, which takes a drop only where the page says it would take it in a way the pull allows.
 * The probe says where the pointer is to go (plan N), the rig moves it, the probe looks at what happened. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(1400);
    const sb = document.getElementById("sidebar"), q = (s) => sb.querySelector(s), qa = (s) => [...sb.querySelectorAll(s)];
    if (document.body.dataset.sidebar !== "open") { document.querySelector('[data-act="sidebar"]').click(); await sleep(700); }
    window.MdPrefs = { ...(window.MdPrefs || {}), sidebarLayout: "rail" }; MdView.prefsChanged(); await sleep(500); // (the sheets are the layout to begin with: the rail is chosen)
    ok("the rail chosen", sb.dataset.layout === "rail", sb.dataset.layout);
    const rowOf = (name) => qa(".sb-list .sb-row").find((r) => r.querySelector(".sb-label").textContent === name);
    let seenAt = null, plans = 0;
    addEventListener("mousemove", (e) => { seenAt = [e.clientX, e.clientY]; }, true);
    const heard = {}; for (const t of ["dragstart", "dragover", "drop", "dragend"]) document.addEventListener(t, () => { heard[t] = (heard[t] || 0) + 1; }, true);
    const run = async (cmd, last, ms) => { out("plan" + ++plans, { cmd }); const t = performance.now(); while (performance.now() - t < ms + 6000) { await sleep(40); if (seenAt && Math.hypot(seenAt[0] - last[0], seenAt[1] - last[1]) < 3 && performance.now() - t > ms) break; } await sleep(500); };
    out("plan" + ++plans, { cmd: "m 200 300 s 80 m 210 310" });
    for (let i = 0; i < 200 && !seenAt; i++) await sleep(50);
    await sleep(300);
    if (!seenAt) throw new Error("the pointer was not heard");
    const off = [210 - seenAt[0], 310 - seenAt[1]], G = (x, y) => `${Math.round(x + off[0])} ${Math.round(y + off[1])}`;
    const row = rowOf("Studium"), rail = q(".sb-rail");
    ok("the folder's row is there, and the rail holds no favourite yet", !!row && qa(".sb-rail .sb-rt").length === 1, qa(".sb-rail .sb-rt").map((b) => b.title));
    const rr = row.getBoundingClientRect(), from = [rr.left + 40, rr.top + rr.height / 2], ra = rail.getBoundingClientRect(), to = [ra.left + ra.width / 2, ra.bottom - 60];
    await run(`m ${G(...from)}`, from, 150);
    await run(`d s 150 g ${G(from[0] + 12, from[1] + 6)} 4 30 g ${G(...to)} 24 25 s 400 u s 200 g ${G(to[0] + 60, to[1] - 40)} 3 30`, [to[0] + 60, to[1] - 40], 1800);
    o.heard = heard;
    ok("pulled with the pointer onto the rail and let go there: a favourite", await until(() => qa(".sb-rail .sb-rt").map((b) => b.title).includes("Studium"), 3000), [qa(".sb-rail .sb-rt").map((b) => b.title), heard]);
    ok("… and not moved anywhere: the folder is where it was", !!rowOf("Studium") && !!(MdView.core.folder.looks || {}).Studium, MdView.core.folder.looks);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("railfav", o);
})();
