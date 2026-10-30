/* Development probe (dev/rig.sh refined): the Refined look and Home as they look — a note with the sidebar pinned, its
 * outline at the right, All Notes' Home — for screenshots only (no checks). Each "shot-…" is a moment the rig takes a picture. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { shots: [] };
  const shot = async (name) => { await sleep(1800); o.shots.push(name); out("shot-" + name, {}); await sleep(1300); };
  try {
    await document.fonts.ready; await sleep(1500);
    const root = window.MdView.core.folder && window.MdView.core.folder.root;
    const note = root + "/Uni/Analysis II/Fourier Series.md";
    window.MdHost.post(JSON.stringify({ type: "note", path: note }));
    await sleep(1500);
    if (document.body.dataset.sidebar !== "open") document.querySelector('#tabs [data-act="sidebar"], #toolbar [data-act="sidebar"]')?.click();
    await shot("note");
    document.querySelector('#tabs [data-act="sidebar"], #toolbar [data-act="sidebar"]')?.click();
    await shot("note-wide");
    document.querySelector('#tabs [data-act="sidebar"], #toolbar [data-act="sidebar"]')?.click();
    document.querySelector('#tabs [data-act="overview"]')?.click();
    await shot("home");
    document.getElementById("overview").scrollTop = 1e5;
    await shot("home-low");
  } catch (e) { o.error = String(e && e.stack || e); }
  out("refined", o);
})();
