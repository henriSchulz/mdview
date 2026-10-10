/* Development probe (dev/rig.sh sbflicker): a note chosen in the sidebar — the row of the new
 * note is marked at once and stays marked, the row of the last one is not marked again on the
 * way (that was the flicker of the two). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(1400);
    const sb = document.getElementById("sidebar");
    if (document.body.dataset.sidebar !== "open") { document.querySelector('[data-act="sidebar"]').click(); await sleep(700); }
    const rows = () => [...sb.querySelectorAll(".sb-list .sb-row[data-real]")];
    const rowOf = (name) => rows().find((r) => r.querySelector(".sb-label").textContent === name);
    const marked = () => rows().filter((r) => r.classList.contains("active")).map((r) => r.querySelector(".sb-label").textContent).sort().join("+");
    rowOf("Alpha").click(); await sleep(1500);
    ok("the note on screen is the one marked", marked() === "Alpha", marked());
    const seen = [];
    const mo = new MutationObserver(() => { const m = marked(); if (seen[seen.length - 1] !== m) seen.push(m); });
    mo.observe(sb, { subtree: true, attributes: true, attributeFilter: ["class"] });
    rowOf("Beta").click(); await sleep(1800);
    mo.disconnect();
    ok("a note chosen: its row is marked, then only it — the last one's is never marked again on the way", JSON.stringify(seen.filter((m) => m !== "")) === '["Beta"]' && marked() === "Beta", { seen, now: marked() });
  } catch (e) { o.error = String(e && e.stack || e); }
  out("sbflicker", o);
})();
