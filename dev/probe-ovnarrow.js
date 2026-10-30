/* Development probe (screenshots, no checks): All Notes' head in a folder, at the window's width — for a narrow rig window
 * (MDVIEW_RIG_RULE="float; size 760 700"). */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { shots: [] };
  try {
    await document.fonts.ready; await sleep(1500);
    const root = window.MdView.core.folder.root;
    window.MdHost.post(JSON.stringify({ type: "note", path: root + "/Uni/Analysis II/Fourier Series.md" }));
    await sleep(1500);
    document.querySelector('#tabs [data-act="overview"]')?.click(); await sleep(900);
    document.querySelector('#overview [data-seg="scope"] [data-v="folders"]')?.click(); await sleep(1500);
    document.getElementById("overview").scrollTop = 0; await sleep(600);
    out("shot-head", {}); await sleep(1500);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("refined", o);
})();
