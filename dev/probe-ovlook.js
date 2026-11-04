/* Development probe (dev/rig.sh ovlook FOLDER): All Notes as it looks — tiles and the list, at the top of the folder
 * and inside its subfolders, the whiteboards, Home where the settings have it — for screenshots; one check: a whiteboard's picture
 * fills its sheet (#54). Each "shot-…" is a moment the rig takes a picture. */
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
    opt("scope", "boards").click(); opt("layout", "tiles").click(); await sleep(1500);
    await shot("boards");
    // (Velum Refined's broader sheets, where a whiteboard's picture was moved down by what the sheet is broader, and cut off: #54)
    const root = document.documentElement, was = root.dataset.velumLook;
    if (root.dataset.velum && !was) { root.dataset.velumLook = "refined"; await sleep(600); }
    const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round); };
    const pics = [...ov.querySelectorAll('.ov-file[data-kind="board"] .ov-pic')].map((p) => [r(p), p.querySelector("img") ? r(p.querySelector("img")) : null]);
    o.steps = [(pics.length && pics.every(([a, b]) => b && a.every((v, i) => Math.abs(v - b[i]) <= 1)) ? "ok   " : "FAIL ") + "a whiteboard's picture fills its sheet, in Velum Refined's look too  " + JSON.stringify(pics)];
    if (root.dataset.velum && !was) delete root.dataset.velumLook;
    if (!opt("scope", "home").hidden) { // (Home, where the settings have it — and its whiteboards and PDFs, at its foot)
      opt("scope", "home").click(); await sleep(1500); await shot("home");
      const files = [...ov.querySelectorAll(".ovh-head")].at(-1);
      if (files) { ov.scrollTop = files.offsetTop - 40; await sleep(2500); o.shots.push("home-files"); out("shot-home-files", {}); await sleep(1300); }
    }
  } catch (e) { o.error = String(e && e.stack || e); }
  out("ovlook", o);
})();
