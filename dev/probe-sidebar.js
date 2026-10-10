/* Development probe (dev/rig.sh sidebar): the sidebar's four layouts — source, rail, sheets,
 * tiles — over one folder, the search, and a folder's colour and sign: chosen from its menu,
 * kept in the folder, and still its own after it was renamed. */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(1400);
    const sb = document.getElementById("sidebar"), list = sb.querySelector(".sb-list"), q = (s) => sb.querySelector(s), qa = (s) => [...sb.querySelectorAll(s)];
    const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const names = (sel) => qa(sel).filter(shown).map((r) => r.querySelector(".sb-label").textContent);
    const rowOf = (name, box = ".sb-list") => qa(box + " .sb-row").find((r) => r.querySelector(".sb-label").textContent === name);
    if (document.body.dataset.sidebar !== "open") { document.querySelector('[data-act="sidebar"]').click(); await sleep(700); } // (a narrow window keeps it shut until asked: the rig's can be half as wide)
    const layout = async (to) => { window.MdPrefs = { ...(window.MdPrefs || {}), sidebarLayout: to }; MdView.prefsChanged(); await sleep(500); };
    const up = async () => { if (document.body.dataset.sidebar !== "open") { document.querySelector('[data-act="sidebar"]').click(); await sleep(700); } }; // (in a narrow window a note chosen shuts the drawer)
    const shot = async (name) => { out(name, {}); await sleep(900); };

    // ---- source (what a folder opens in)
    ok("a folder opens with the list: the tree, and new and order at its foot", sb.dataset.layout === "source" && shown(q(".sb-foot")) && !shown(q('.sb-head [data-act="newmenu"]')) && !shown(q(".sb-rail")) && !shown(q(".sb-smart")), sb.dataset.layout);
    const hits = (a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return x.left < y.right - 1 && y.left < x.right - 1 && x.top < y.bottom - 1 && y.top < x.bottom - 1; };
    const gear = document.getElementById("settings-btn");
    ok("the settings' gear at the sidebar's foot stands beside New Note, not on it", shown(gear) && !hits(gear, q(".sb-new-note")) && !hits(gear, q('.sb-foot [data-sb="more"]')) && Math.abs(gear.getBoundingClientRect().top - q(".sb-new-note").getBoundingClientRect().top) <= 1, [gear.getBoundingClientRect().toJSON(), q(".sb-new-note").getBoundingClientRect().toJSON()]);
    ok("a folder's row says its name and nothing more: no number", rowOf("Projekte").querySelector(".sb-tail").dataset.says === "" && rowOf("Studium").textContent === "Studium", rowOf("Projekte").querySelector(".sb-tail").dataset.says);
    rowOf("Alpha").click(); await sleep(1300); await up(); // (when a note was opened is kept to the second)
    rowOf("Gamma").click(); await sleep(1300); await up();
    ok("the notes opened last stand above the tree, the last first, the one on screen marked", JSON.stringify(names(".sb-recent .sb-row").slice(0, 2)) === '["Gamma","Alpha"]' && names(".sb-recent .sb-row").length <= 3 && rowOf("Gamma", ".sb-recent").classList.contains("active"), names(".sb-recent .sb-row"));
    // ---- a folder's colour and sign
    const studium = rowOf("Studium");
    studium.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 60, clientY: studium.getBoundingClientRect().top + 8, button: 2 }));
    await sleep(400);
    document.querySelector('#ctxmenu [data-cmd="look"]').click();
    await sleep(700);
    const look = document.getElementById("sblook");
    ok("a folder's menu has Colour and Icon…, and it opens a small window beside the row", look.hasAttribute("data-open") && look.querySelectorAll(".sl-color").length === 8 && look.querySelectorAll(".sl-icon").length === 21, look.innerHTML.length);
    look.querySelector('[data-color="green"]').click(); await sleep(150);
    look.querySelector('[data-icon="book"]').click(); await sleep(600);
    ok("a colour and a sign chosen show on the row at once", /--c-green/.test(studium.style.getPropertyValue("--fc")) && studium.dataset.icon === "book" && look.querySelector('[data-icon="book"]').classList.contains("on"), [studium.getAttribute("style"), studium.dataset.icon]);
    look.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300);
    ok("Esc shuts it", !look.hasAttribute("data-open"), "");
    await shot("source");

    // ---- rail
    await layout("rail");
    const rail = qa(".sb-rail .sb-rt");
    ok("rail: everything, then the folder's folders as signs — the chosen colour and sign among them", sb.dataset.layout === "rail" && rail.map((b) => b.title).join("|") === "All Notes|Projekte|Studium" && /--c-green/.test(rail[2].getAttribute("style") || "") && rail[0].classList.contains("on"), rail.map((b) => b.title + (b.getAttribute("style") || "")));
    rail[1].click(); await sleep(500);
    const pad = (r) => parseFloat(getComputedStyle(r).paddingLeft);
    ok("a folder chosen: what is in it, at the top — its folders still to open", JSON.stringify(names(".sb-list .sb-row")) === '["Deep","Plan"]' && q(".sb-crumb-name").textContent === "Projekte" && !q(".sb-crumb-count"), names(".sb-list .sb-row"));
    rowOf("Deep").click(); await sleep(600);
    ok("… a folder in it opens in place, a level deeper", JSON.stringify(names(".sb-list .sb-row")) === '["Deep","Inner","Plan"]' && pad(rowOf("Inner")) > pad(rowOf("Plan")), [names(".sb-list .sb-row"), pad(rowOf("Inner")), pad(rowOf("Plan"))]);
    await shot("rail");
    rail[0].click(); await sleep(500);
    ok("All Notes: the whole tree again", names(".sb-list .sb-row").includes("Alpha") && names(".sb-list .sb-row").includes("Studium"), names(".sb-list .sb-row"));

    // ---- sheets
    await layout("sheets");
    await sleep(900); // (the notes' beginnings are read)
    const tiles = () => names(".sb-list .sb-row");
    ok("sheets: the folder's folders and notes, a tile each", sb.dataset.layout === "sheets" && JSON.stringify(tiles().slice(0, 2)) === '["Projekte","Studium"]' && JSON.stringify(tiles().slice(2).sort()) === '["Alpha","Beta","Gamma"]' && getComputedStyle(list).display === "grid", tiles());
    ok("a note's sheet is drawn as the note is built; a folder is a folder with its sign, and no number", rowOf("Beta").querySelectorAll(".sb-sheet i.c").length === 2 && rowOf("Alpha").querySelector(".sb-sheet b").textContent === "Alpha" && !rowOf("Studium").querySelector(".sb-sheet.is-folder b") && !!rowOf("Studium").querySelector(".sb-sheet.is-folder svg, .sb-sheet.is-folder .sf"), rowOf("Beta").querySelector(".sb-sheet").innerHTML);
    const a = rowOf("Projekte").getBoundingClientRect(), b = rowOf("Studium").getBoundingClientRect();
    ok("the tiles stand side by side", Math.abs(a.top - b.top) < 2 && b.left > a.right - 2, [a.top, b.top, a.right, b.left]);
    await shot("sheets");
    rowOf("Studium").click(); await sleep(700);
    ok("a click on a folder goes into it: its notes, and the way back", JSON.stringify(tiles().sort()) === '["Blatt","Thermo"]' && shown(q(".sb-back")) && q(".sb-crumb-name").textContent === "Studium", tiles());
    q(".sb-back").click(); await sleep(700);
    ok("back: the folder itself", tiles().length === 5 && !shown(q(".sb-back")), tiles());

    // ---- tiles
    await layout("tiles");
    await sleep(900);
    const smart = () => qa(".sb-smart .sb-tile").map((t) => t.querySelector(".sb-tile-name").textContent + " " + t.querySelector(".sb-tile-n").textContent);
    ok("tiles: four smart lists, each with how many notes it holds", sb.dataset.layout === "tiles" && smart().join("|") === "All 7|Today 7|Shared 0|With Tasks 1", smart());
    q('.sb-tile[data-smart="tasks"]').click(); await sleep(400);
    ok("With Tasks: the notes that have something left to do, in one list", sb.hasAttribute("data-flat") && JSON.stringify(names(".sb-flat .sb-row")) === '["Blatt"]' && !shown(list), names(".sb-flat .sb-row"));
    await shot("tiles");
    q('.sb-tile[data-smart="all"]').click(); await sleep(400);
    ok("All: the folders again, their signs on a disc in their colour", !sb.hasAttribute("data-flat") && shown(list) && getComputedStyle(rowOf("Studium").querySelector(".sb-icon")).borderRadius === "50%", sb.getAttribute("data-flat"));

    // ---- searching, in any layout
    const field = q(".qn-search");
    field.value = "pla"; field.dispatchEvent(new Event("input", { bubbles: true })); await sleep(400);
    ok("the field narrows the folder's notes to those whose name has what is typed", shown(field) && JSON.stringify(names(".sb-flat .sb-row")) === '["Plan"]', names(".sb-flat .sb-row"));
    names(".sb-flat .sb-row"); rowOf("Plan", ".sb-flat").click(); await sleep(900); await up();
    ok("… and a row there opens its note", MdView.core.current.name === "Plan.md", MdView.core.current.name);
    field.value = ""; field.dispatchEvent(new Event("input", { bubbles: true })); await sleep(300);

    // ---- the look is the folder's: renamed, it keeps it
    await layout("source");
    window.MdHost.post(JSON.stringify({ type: "rename", path: rowOf("Studium").closest(".sb-item").dataset.key, name: "Uni" }));
    await sleep(1500);
    const uni = rowOf("Uni");
    ok("a folder renamed keeps its colour and its sign", !!uni && /--c-green/.test(uni.style.getPropertyValue("--fc")) && uni.dataset.icon === "book", uni && [uni.getAttribute("style"), uni.dataset.icon]);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("sidebar", o);
})();
