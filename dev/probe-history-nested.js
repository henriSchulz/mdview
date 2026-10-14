/* Development probe (dev/rig.sh history, third part): a folder with a project in it becomes a
 * project, the inner one taken in (the answer the system's dialog would give is sent with the
 * message). The rig reads the repository. Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const o = {};
  try {
    // (a folder opens on All Notes now — Henri, 2026-10-14: the note this probe is about is opened from there, the first by name)
    for (let i = 0; i < 200 && !(MdView.core.folder && MdView.core.folder.tree); i++) await new Promise((r) => setTimeout(r, 50));
    if (!(MdView.core.current && MdView.core.current.path)) {
      const t = MdView.core.folder.tree, all = (d) => [...d.notes, ...d.dirs.flatMap(all)], md = (n) => !/\.(pdf|board\.svg)$/i.test(n.path);
      const n = t.notes.filter(md).sort((a, b) => a.name.localeCompare(b.name))[0] || all(t).filter(md)[0];
      window.MdHost.post(JSON.stringify({ type: "note", path: n.path }));
      for (let i = 0; i < 200 && !(MdView.core.current && MdView.core.current.path === n.path); i++) await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 300));
      await new Promise((r) => setTimeout(r, 900));
    }
    await sleep(1200);
    const btn = document.querySelector('[data-act="historymenu"]');
    o.before = btn.title;
    post({ type: "history-enable", nested: "merge" });
    await sleep(2500);
    o.after = btn.title;
  } catch (e) { o.error = String(e && e.stack || e); }
  post({ type: "probe", name: "history-nested", text: JSON.stringify(o) });
})();
