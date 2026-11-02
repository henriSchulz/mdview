/* Development probe (dev/rig.sh sync): a linked project opened anew. Sync Now stands in the
 * tabs' strip, beside All Notes (#30), from the start — the folder is linked, whether or not the two sides have been
 * reconciled since the app started. Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const o = {};
  try {
    await sleep(2500);
    const b = document.querySelector("#tabs .tab-sync");
    o.linked = document.body.hasAttribute("data-linked");
    o.display = b ? getComputedStyle(b).display : "missing";
  } catch (e) { o.error = String(e && e.stack || e); }
  post({ type: "probe", name: "sync-button", text: JSON.stringify(o) });
})();
