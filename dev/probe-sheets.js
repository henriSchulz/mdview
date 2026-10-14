/* Development probe (dev/rig.sh sheets): the sidebar's sheets show what a file is — a note its beginning, a PDF its first page,
 * a whiteboard and a picture themselves. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(1400);
    const sb = document.getElementById("sidebar"), qa = (s) => [...sb.querySelectorAll(s)];
    const rowOf = (name) => qa(".sb-list .sb-row").find((r) => r.querySelector(".sb-label").textContent === name);
    if (document.body.dataset.sidebar !== "open") { document.querySelector('[data-act="sidebar"]').click(); await sleep(700); } // (a narrow window keeps it shut until asked)
    window.MdPrefs = { ...(window.MdPrefs || {}), sidebarLayout: "sheets" }; MdView.prefsChanged();
    await sleep(900);
    const sheet = (name) => rowOf(name) && rowOf(name).querySelector(".sb-sheet"), pic = (name) => sheet(name) && sheet(name).querySelector(".sb-sheet-in.is-pic img"), said = (name) => (sheet(name) ? sheet(name).innerHTML.slice(0, 200) : "no such row");
    ok("a note's sheet shows its beginning, as it is written — a heading, a list", await until(() => sheet("Alpha") && sheet("Alpha").querySelector(".sb-prev h2")) && /Some text here/.test(sheet("Alpha").querySelector(".sb-prev").textContent) && sheet("Alpha").querySelectorAll(".sb-prev li").length === 2, said("Alpha"));
    ok("… made small: it fits its sheet", sheet("Alpha").querySelector(".sb-prev").getBoundingClientRect().width <= sheet("Alpha").getBoundingClientRect().width + 1, [sheet("Alpha").querySelector(".sb-prev").getBoundingClientRect().width, sheet("Alpha").getBoundingClientRect().width]);
    ok("a PDF's sheet shows its first page", await until(() => pic("paper.pdf") && pic("paper.pdf").naturalHeight > pic("paper.pdf").naturalWidth && pic("paper.pdf").src.startsWith("blob:"), 10000), said("paper.pdf"));
    ok("a whiteboard's sheet shows the board", await until(() => pic("Skizze") && pic("Skizze").naturalWidth > 0, 4000), said("Skizze"));
    ok("a picture's sheet shows the picture", await until(() => pic("photo.png") && pic("photo.png").naturalWidth === 8, 4000), said("photo.png"));
    ok("any other file has its sign", !!sheet("data.csv") && !!sheet("data.csv").querySelector(".sb-sheet-in.is-sign svg, .sb-sheet-in.is-sign .sf"), said("data.csv"));
    out("shown", {});
    await sleep(900);
    window.MdPrefs = { ...(window.MdPrefs || {}), sidebarLayout: "source" }; MdView.prefsChanged();
    await sleep(300);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("sheets", o);
})();
