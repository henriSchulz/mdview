/* Development probe (dev/rig.sh history): a folder becomes a project, and what is written in it
 * is kept as commits — after a quiet while, and at once when its window closes. The rig reads
 * the repository itself; this only acts, and says when. Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const say = (name, o) => post({ type: "probe", name, text: JSON.stringify(o) });
  const o = { steps: [] };
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
    const raw = MdView.core.current.raw;
    o.note = MdView.core.current.name;
    const btn = document.querySelector('[data-act="historymenu"]');
    const entries = () => [...document.querySelectorAll("#ctxmenu .menu-item:not([hidden])")];
    o.before = { says: btn.title, quiet: btn.classList.contains("quiet") };
    btn.click(); await sleep(300);              // the sidebar's clock: its menu offers the history
    o.offered = entries().map((e) => e.textContent);
    entries()[0].click();                       // the first commit: the folder as it is
    await sleep(700);
    o.after = { says: btn.title, quiet: btn.classList.contains("quiet") };
    btn.click(); await sleep(300);
    o.then = entries().map((e) => e.textContent + (e.disabled ? " (off)" : ""));
    btn.click();
    await sleep(2200);
    post({ type: "save", text: raw + "\nfirst change\n" });
    await sleep(2800);                           // quiet: the second commit
    say("history-ready", o);                     // (the rig now changes another note from outside)
    await sleep(4000);
    post({ type: "save", text: raw + "\nfirst change\n\nsecond change\n" });
    await sleep(150);
    say("history", o);
    post({ type: "close" });                     // not quiet yet: the window's closing makes the commit
  } catch (e) { o.error = String(e && e.stack || e); say("history", o); }
})();
