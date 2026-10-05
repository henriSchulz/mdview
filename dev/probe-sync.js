/* Development probe (dev/rig.sh sync): a project linked to a repository elsewhere (the rig's
 * bare one, in GitHub's place). What is kept here goes over; what another device pushes comes
 * and is on the page; both changing at once are joined. The rig plays the other device and
 * reads the repositories; this acts, and says when. Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const say = (name, o) => post({ type: "probe", name, text: JSON.stringify(o) });
  const o = {};
  try {
    await sleep(1200);
    o.note = MdView.core.current.name;
    post({ type: "history-enable" }); await sleep(600);
    post({ type: "history-link", url: window.__hub || "" });
    await sleep(2400);
    say("sync-linked", o);                 // (the rig: the other device changes this note, and pushes)
    for (let i = 0; i < 80 && !MdView.core.current.raw.includes("from the other device"); i++) await sleep(100);
    o.pulled = MdView.core.current.raw.includes("from the other device");
    // written here and, before it is kept, pushed by the other device: both have something new
    post({ type: "save", text: "written here\n\n" + MdView.core.current.raw });
    say("sync-pulled", o);                 // (the rig: the other device changes another note, and pushes)
    await sleep(5000);
    o.raw = MdView.core.current.raw;
  } catch (e) { o.error = String(e && e.stack || e); }
  say("sync", o);
})();
