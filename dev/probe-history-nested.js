/* Development probe (dev/rig.sh history, third part): a folder with a project in it becomes a
 * project, the inner one taken in (the answer the system's dialog would give is sent with the
 * message). The rig reads the repository. Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const o = {};
  try {
    await sleep(1200);
    const btn = document.querySelector('[data-act="historymenu"]');
    o.before = btn.title;
    post({ type: "history-enable", nested: "merge" });
    await sleep(2500);
    o.after = btn.title;
  } catch (e) { o.error = String(e && e.stack || e); }
  post({ type: "probe", name: "history-nested", text: JSON.stringify(o) });
})();
