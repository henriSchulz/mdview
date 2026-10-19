/* Development probe (dev/rig.sh ovlook FOLDER): All Notes as it looks — tiles and the list, at the top of the folder
 * and inside its subfolders — for screenshots only (no checks). Each "shot-…" is a moment the rig takes a picture. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { shots: [] };
  try {
    await document.fonts.ready; await sleep(1200);
    const ov = document.getElementById("overview");
    document.querySelector('#tabs [data-act="overview"]').click(); await sleep(1500);
    const opt = (seg, v) => ov.querySelector(`[data-seg="${seg}"] [data-v="${v}"]`);
    const shot = async (name) => { ov.scrollTop = 0; await sleep(2500); o.shots.push(name); out("shot-" + name, {}); await sleep(1300); };
    opt("scope", "folders").click(); opt("layout", "tiles").click(); await sleep(800);
    await shot("tiles");
    opt("layout", "list").click(); await sleep(800);
    await shot("list");
    const dirs = [...ov.querySelectorAll(".ov-folder")].map((t) => t.dataset.dir).filter((d) => d && !d.startsWith("."));
    for (const d of dirs.slice(0, 3)) {
      const go = (dir) => [...ov.querySelectorAll(".ov-folder")].find((t) => t.dataset.dir === dir)?.click();
      opt("layout", "tiles").click(); await sleep(400); go(d); await sleep(900);
      await shot("tiles-" + d);
      opt("layout", "list").click(); await sleep(800);
      await shot("list-" + d);
      ov.querySelector(".ov-crumb")?.click(); await sleep(800);
    }
    opt("scope", "all").click(); opt("layout", "tiles").click(); await sleep(800);
    await shot("all");
  } catch (e) { o.error = String(e && e.stack || e); }
  out("ovlook", o);
})();
