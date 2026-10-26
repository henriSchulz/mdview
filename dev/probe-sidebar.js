/* Development probe (dev/rig.sh sidebar): the sidebar's four layouts — source, rail, sheets,
 * tiles — over one folder, the search, and a folder's colour and sign: chosen from its menu,
 * kept in the folder, and still its own after it was renamed. Last, the sidebar lies over the
 * note: opened and shut, the note's column, All Notes and the halves of a split do not move — in
 * the window as it is and in one zoomed to be narrower (Henri, 2026-10-20). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
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
    const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };

    // ---- what a folder opens in: the rail
    ok("a folder opens with the sheets (Henri, 2026-10-20: the rail before)", sb.dataset.layout === "sheets", sb.dataset.layout);
    // (the folder's name at the head, beside the button that opens another — in the rail's layout too: it was hidden there, Henri 2026-10-14)
    { const nm = q(".sb-folder-name"); ok("… the folder's name at the head, beside Open Another Folder", !!nm && nm.textContent.trim() !== "" && nm.offsetWidth > 20 && getComputedStyle(nm).display !== "none", nm && [nm.textContent, nm.offsetWidth, getComputedStyle(nm).display]); }
    await layout("source");
    // ---- source
    ok("the list: the tree, and new and order at its foot", sb.dataset.layout === "source" && shown(q(".sb-foot")) && !shown(q('.sb-head [data-act="newmenu"]')) && !shown(q(".sb-rail")) && !shown(q(".sb-smart")), sb.dataset.layout);
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
    ok("a folder's menu has Colour and Icon…, and it opens a small window beside the row — the colours, a search, many signs", look.hasAttribute("data-open") && look.querySelectorAll(".sl-color").length === 9 && !!look.querySelector("[data-more]") && look.querySelectorAll(".sl-icon").length > 80 && !!look.querySelector(".sl-find"), look.querySelectorAll(".sl-icon").length); // (the app's twenty, the folder's own, and Lucide's that notes are often about: dev/rig.sh icons)
    look.querySelector('[data-color="green"]').click(); await sleep(150);
    look.querySelector('[data-icon="book"]').click(); await sleep(600);
    ok("a colour and a sign chosen show on the row at once", /--c-green/.test(studium.style.getPropertyValue("--fc")) && studium.dataset.icon === "book" && look.querySelector('[data-icon="book"]').classList.contains("on"), [studium.getAttribute("style"), studium.dataset.icon]);
    look.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300);
    ok("Esc shuts it", !look.hasAttribute("data-open"), "");
    await shot("source");

    // ---- rail
    await layout("rail");
    // the rail holds the favourites, not every folder: at first everything alone, and a faint star where they will stand
    ok("rail: at first everything alone — no folder is a favourite yet", qa(".sb-rail .sb-rt").map((b) => b.title).join("|") === "All Notes" && !!q(".sb-rail .sb-rail-hint"), qa(".sb-rail .sb-rt").map((b) => b.title));
    { // a favourite made from a folder's menu: the star
      const menuOn = async (row) => { const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 8, button: 2 })); await sleep(350); return document.querySelector('#ctxmenu [data-cmd="fav"]'); };
      if (!rowOf("Studium")) { qa(".sb-rail .sb-rt")[0].click(); await sleep(400); }
      const fav = await menuOn(rowOf("Studium"));
      ok("a folder's menu: Add to Favourites, with a hollow star", !!fav && !fav.hidden && fav.querySelector(".menu-label").textContent === "Add to Favourites" && !fav.querySelector(".menu-icon path[fill]"), fav && fav.textContent);
      fav.click(); await sleep(500);
      ok("… chosen: its sign stands in the rail", qa(".sb-rail .sb-rt").map((b) => b.title).join("|") === "All Notes|Studium" && !q(".sb-rail .sb-rail-hint"), qa(".sb-rail .sb-rt").map((b) => b.title));
      const again = await menuOn(rowOf("Studium"));
      ok("… and its menu says so, the star filled: Remove from Favourites", again.querySelector(".menu-label").textContent === "Remove from Favourites" && !!again.querySelector(".menu-icon path[fill]"), again.textContent);
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300);
      // a favourite made by pulling the folder onto the rail
      const dt = new DataTransfer(), ev = (type, el, x, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      const railEl = q(".sb-rail"), rr = railEl.getBoundingClientRect();
      ev("dragstart", rowOf("Projekte")); ev("dragover", railEl, rr.left + 20, rr.bottom - 20); const lit = railEl.hasAttribute("data-drop"); ev("drop", railEl, rr.left + 20, rr.bottom - 20); ev("dragend", rowOf("Projekte"));
      await sleep(600);
      ok("a folder pulled onto the rail: a favourite from then on (the rail lit while it was over it)", lit && qa(".sb-rail .sb-rt").map((b) => b.title).join("|") === "All Notes|Projekte|Studium", [lit, qa(".sb-rail .sb-rt").map((b) => b.title)]);
      ok("… kept with the folder's look, as the folder says itself", !!(MdView.core.folder.looks || {}).Projekte && MdView.core.folder.looks.Projekte.fav === true && MdView.core.folder.looks.Studium.fav === true && MdView.core.folder.looks.Studium.color === "green", MdView.core.folder.looks);
    }
    const rail = qa(".sb-rail .sb-rt");
    ok("rail: everything, then the favourites as signs — the chosen colour and sign among them", sb.dataset.layout === "rail" && rail.map((b) => b.title).join("|") === "All Notes|Projekte|Studium" && /--c-green/.test(rail[2].getAttribute("style") || "") && rail[0].classList.contains("on"), rail.map((b) => b.title + (b.getAttribute("style") || "")));
    // a folder's sign in the rail has the folder's own menu: its colour and sign are changed from there too
    const signOf = (name) => qa(".sb-rail .sb-rt").find((b) => b.title === name);
    signOf("Projekte").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 26, clientY: signOf("Projekte").getBoundingClientRect().top + 8, button: 2 }));
    await sleep(400);
    const offered = [...document.querySelectorAll("#ctxmenu > [data-cmd]")].filter((b) => !b.hidden).map((b) => b.dataset.cmd);
    ok("rail: a right click on a folder's sign opens the folder's menu, Colour and Icon… in it", document.getElementById("ctxmenu").hasAttribute("data-open") && document.getElementById("ctxmenu").dataset.kind === "dir" && offered.includes("look") && offered.includes("newnote"), offered);
    document.querySelector('#ctxmenu [data-cmd="look"]').click(); await sleep(700);
    const look2 = document.getElementById("sblook"), lr = look2.getBoundingClientRect(), sr = signOf("Projekte").getBoundingClientRect();
    ok("… its small window opens beside that sign", look2.hasAttribute("data-open") && lr.top >= sr.top && lr.top - sr.bottom < 40 && lr.left < 120, [lr.left, lr.top, sr.bottom, lr.height, innerHeight]);
    look2.querySelector('[data-color="red"]').click(); await sleep(150);
    look2.querySelector('[data-icon="star"]') && look2.querySelector('[data-icon="star"]').click(); await sleep(600);
    ok("… and the colour chosen there shows on the sign", /--c-red/.test(signOf("Projekte").getAttribute("style") || ""), signOf("Projekte").getAttribute("style"));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300);
    signOf("All Notes").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 26, clientY: 30, button: 2 })); await sleep(300);
    ok("All Notes is no folder: its sign has no menu", !document.getElementById("ctxmenu").hasAttribute("data-open"), "");
    signOf("Projekte").click(); await sleep(500);
    const pad = (r) => parseFloat(getComputedStyle(r).paddingLeft);
    ok("a folder chosen: what is in it, at the top — its folders still to open", JSON.stringify(names(".sb-list .sb-row")) === '["Deep","Plan"]' && q(".sb-crumb-name").textContent === "Projekte" && !q(".sb-crumb-count"), names(".sb-list .sb-row"));
    rowOf("Deep").click(); await sleep(600);
    ok("… a folder in it opens in place, a level deeper", JSON.stringify(names(".sb-list .sb-row")) === '["Deep","Inner","Plan"]' && pad(rowOf("Inner")) > pad(rowOf("Plan")), [names(".sb-list .sb-row"), pad(rowOf("Inner")), pad(rowOf("Plan"))]);
    await shot("rail");
    signOf("All Notes").click(); await sleep(500);
    ok("All Notes: the whole tree again", names(".sb-list .sb-row").includes("Alpha") && names(".sb-list .sb-row").includes("Studium"), names(".sb-list .sb-row"));

    // ---- sheets
    await layout("sheets");
    await sleep(900); // (the notes' beginnings are read)
    const tiles = () => names(".sb-list .sb-row");
    ok("sheets: the folder's folders and notes, a tile each", sb.dataset.layout === "sheets" && JSON.stringify(tiles().slice(0, 2)) === '["Projekte","Studium"]' && JSON.stringify(tiles().slice(2).sort()) === '["Alpha","Beta","Gamma"]' && getComputedStyle(list).display === "grid", tiles());
    ok("a note's sheet shows the note's beginning, small; a folder is a folder with its sign, and no number", await until(() => rowOf("Alpha").querySelector(".sb-sheet .sb-prev")) && /Some text\./.test(rowOf("Alpha").querySelector(".sb-sheet .sb-prev").textContent) && rowOf("Beta").querySelectorAll(".sb-sheet .sb-prev li").length === 2 && rowOf("Alpha").querySelector(".sb-sheet .sb-prev").getBoundingClientRect().width < 90 && !rowOf("Studium").querySelector(".sb-sheet.is-folder b") && !!rowOf("Studium").querySelector(".sb-sheet.is-folder svg, .sb-sheet.is-folder .sf"), rowOf("Beta").querySelector(".sb-sheet").innerHTML);
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

    // ---- out of a folder again: a row pulled onto what stands for the folder above
    const root = MdView.core.folder.root, has = (rel) => !!document.querySelector(`.sb-list .sb-item[data-key="${root}/${rel}"]`);
    const drag = async (from, to) => {
      const dt = new DataTransfer(), ev = (type, el) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      ev("dragstart", from); ev("dragover", to); const marked = !!to.closest(".drop-into"); ev("drop", to); ev("dragend", from);
      await sleep(1300);
      return marked;
    };
    await layout("source");
    if (!rowOf("Projekte").closest(".sb-item").classList.contains("open")) { rowOf("Projekte").click(); await sleep(500); }
    let marked = await drag(rowOf("Plan"), q(".sb-folder"));
    ok("list: a note pulled out of its folder onto the folder's name at the head lies in the folder itself — the name marked on the way", marked && has("Plan.md") && !has("Projekte/Plan.md"), [marked, has("Plan.md"), has("Projekte/Plan.md")]);
    marked = await drag(rowOf("Plan"), rowOf("Projekte"));
    ok("… and onto a folder's row, in that folder again", marked && has("Projekte/Plan.md"), [marked, has("Projekte/Plan.md")]);
    await layout("sheets");
    rowOf("Studium").click(); await sleep(700);
    marked = await drag(rowOf("Thermo"), q(".sb-back"));
    ok("sheets: in a folder, a sheet pulled onto the way back lies in the folder above", marked && has("Thermo.md") && !has("Studium/Thermo.md"), [marked, has("Thermo.md")]);
    q(".sb-back").click(); await sleep(600);
    await layout("rail");
    const tile = (name) => qa(".sb-rail .sb-rt").find((b) => b.title === name);
    tile("All Notes").click(); await sleep(400);
    marked = await drag(rowOf("Thermo"), tile("Studium"));
    ok("rail: a note pulled onto a folder's sign lies in that folder", marked && has("Studium/Thermo.md") && !has("Thermo.md"), [marked, has("Studium/Thermo.md")]);
    tile("Studium").click(); await sleep(500);
    marked = await drag(rowOf("Thermo"), tile("All Notes"));
    ok("… and from inside a folder onto All Notes, in the folder itself", marked && has("Thermo.md"), [marked, has("Thermo.md")]);
    tile("All Notes").click(); await sleep(400);
    await drag(rowOf("Thermo"), tile("Studium")); // (as it was)

    // ---- the look is the folder's: renamed, it keeps it
    await layout("source");
    window.MdHost.post(JSON.stringify({ type: "rename", path: rowOf("Studium").closest(".sb-item").dataset.key, name: "Uni" }));
    await sleep(1500);
    const uni = rowOf("Uni");
    ok("a folder renamed keeps its colour and its sign", !!uni && /--c-green/.test(uni.style.getPropertyValue("--fc")) && uni.dataset.icon === "book", uni && [uni.getAttribute("style"), uni.dataset.icon]);
    // ---- one menu, wherever a thing is met: a folder's row, its sign in the rail and its tile in All Notes offer the same
    // entries, and so do a note's row and its tile
    const menu = document.getElementById("ctxmenu");
    const menuOf = async (el) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 8, button: 2 }));
      await sleep(350);
      const list = menu.hasAttribute("data-open") ? [...menu.children].filter((b) => !b.hidden && b.dataset.cmd).map((b) => b.dataset.cmd).join(" ") : "(no menu)";
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(250);
      return list;
    };
    const dirRow = await menuOf(rowOf("Projekte")), noteRow = await menuOf(rowOf("Alpha"));
    await layout("rail");
    const dirSign = await menuOf(signOf("Projekte"));
    await layout("source");
    MdOverview.open(); await sleep(700);
    while (document.querySelector("#overview .ov-crumb")) { document.querySelector("#overview .ov-crumb").click(); await sleep(400); } // (All Notes opens in the folder of the note on screen: up to the folder itself)
    const tileOf = (name) => [...document.querySelectorAll("#overview .ov-item")].find((t) => t.querySelector(".ov-name").textContent === name);
    const dirTile = tileOf("Projekte") ? await menuOf(tileOf("Projekte")) : "(no tile)", noteTile = tileOf("Alpha") ? await menuOf(tileOf("Alpha")) : "(no tile)";
    ok("a folder has the same menu on its row, on its sign in the rail and on its tile in All Notes", dirRow.includes("look") && dirRow.includes("rename") && dirRow === dirSign && dirRow === dirTile, { row: dirRow, sign: dirSign, tile: dirTile });
    ok("a note has the same menu on its row and on its tile", noteRow.includes("rename") && noteRow === noteTile, { row: noteRow, tile: noteTile });
    // … and what is chosen there is done there: a folder's colour from its tile
    const pt = tileOf("Projekte"), pr = pt.getBoundingClientRect();
    pt.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: pr.left + 10, clientY: pr.top + 8, button: 2 })); await sleep(350);
    menu.querySelector('[data-cmd="look"]').click(); await sleep(700);
    const look3 = document.getElementById("sblook"), l3 = look3.getBoundingClientRect();
    ok("All Notes: Colour and Icon… opens its small window at the tile, over All Notes", look3.hasAttribute("data-open") && l3.left >= pr.left - 4 && l3.top >= pr.top && document.elementFromPoint(l3.left + 20, l3.top + 20) && look3.contains(document.elementFromPoint(l3.left + 20, l3.top + 20)), [l3.left, l3.top, pr.left, pr.top]);
    look3.querySelector('[data-color="blue"]').click(); await sleep(700);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300);
    MdOverview.close(); await sleep(400);
    ok("… and the colour chosen there is the folder's", /--c-blue/.test(rowOf("Projekte").style.getPropertyValue("--fc")), rowOf("Projekte").getAttribute("style"));
    // the rail: Rename shows the folder's row among All Notes and the name is changed there
    await layout("rail");
    signOf("Projekte").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 26, clientY: signOf("Projekte").getBoundingClientRect().top + 8, button: 2 })); await sleep(350);
    menu.querySelector('[data-cmd="rename"]').click(); await sleep(800);
    ok("rail: Rename brings the folder's row and a field for its name", !!q(".sb-list .sb-rename") && q(".sb-list .sb-rename").value === "Projekte" && document.activeElement === q(".sb-list .sb-rename"), [!!q(".sb-list .sb-rename"), document.activeElement && document.activeElement.className]);
    q(".sb-list .sb-rename") && q(".sb-list .sb-rename").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300);
    // ---- a right click in the sidebar's empty room: new things, the order — and the settings
    await layout("source");
    await up();
    { const r = list.getBoundingClientRect();
      list.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.bottom - 20 })); await sleep(400);
      const cmds = [...document.querySelectorAll("#ctxmenu .menu-item:not([hidden])")].map((b) => b.dataset.cmd);
      ok("the sidebar's empty room: its menu has Settings…, after the orders (by name first)", cmds.indexOf("settings") > cmds.indexOf("sort:modified") && cmds.indexOf("sort:name") < cmds.indexOf("sort:opened"), cmds);
      document.querySelector('#ctxmenu .menu-item[data-cmd="settings"]').click();
      ok("… chosen: the settings open", await until(() => document.getElementById("settings") && document.getElementById("settings").hasAttribute("data-open"), 3000));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await sleep(500); }
    await layout("source");

    // ---- pinned, the sidebar makes room; shut, it peeks out over the note (Henri, 2026-10-26: Notion's way)
    const toggle = async (open) => { if ((document.body.dataset.sidebar === "open") !== open) { document.querySelector('#tabs [data-act="sidebar"]').click(); await sleep(800); } };
    const leftOf = (sel) => { const el = document.querySelector(sel); return el && el.getClientRects().length ? Math.round(el.getBoundingClientRect().left) : null; };
    const textLeft = (sel) => { const el = document.querySelector(sel); return el.getBoundingClientRect().left + (parseFloat(getComputedStyle(el).paddingLeft) || 0); };
    const move = (x, y) => { const at = document.elementFromPoint(x, y) || document.body; at.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: "mouse", isPrimary: true, buttons: 0 })); };
    let sent = 0; { const own = MdView.setFolder; MdView.setFolder = function (...a) { sent++; return own.apply(this, a); }; } // (the folder the shell sends)
    const pinned = async (what, sel) => {
      await toggle(false); const shut = leftOf(sel), sentBefore = sent;
      const t0 = performance.now(); document.querySelector('#tabs [data-act="sidebar"]').click(); const took = performance.now() - t0;
      const glides = getComputedStyle(document.querySelector(sel).closest("#content, #overview")).transform !== "none";
      await sleep(800);
      ok(`… (${innerWidth} px) opened, the folder is not scanned and sent again`, sent === sentBefore, sent - sentBefore);
      const side = sb.getBoundingClientRect();
      ok(`${what} (${innerWidth} px): pinned, the sidebar makes room — nothing of it lies under the card`, document.body.dataset.sidebar === "open" && side.width > 150 && textLeft(sel) >= side.right - 1, { text: Math.round(textLeft(sel)), card: Math.round(side.right), shut, open: leftOf(sel) });
      ok(`… (${innerWidth} px) it glides there (transform), and the click takes little time: the new layout made once`, (glides || shut === leftOf(sel)) && took < 100, { glides, took: Math.round(took) });
      await toggle(false);
      ok(`… (${innerWidth} px) and it goes back where it was when the sidebar shuts`, leftOf(sel) === shut, [leftOf(sel), shut]);
    };
    const room = async () => {
      await pinned("the note's column", "#content");
      await toggle(true);
      { const btn = document.querySelector('#tabs [data-act="sidebar"]').getBoundingClientRect(), side = sb.getBoundingClientRect();
        ok(`(${innerWidth} px) the sidebar's button in the strip stays beside the card, to be clicked`, btn.left >= side.right - 1, [btn.left, side.right]); }
      { const p = document.querySelector("#content p, #content h1"), pr = p.getBoundingClientRect();
        p.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: pr.left + 4, clientY: pr.top + 4, pointerType: "mouse", isPrimary: true })); await sleep(700);
        ok(`(${innerWidth} px) a press into the note leaves the pinned sidebar open`, document.body.dataset.sidebar === "open", document.body.dataset.sidebar); }
      await toggle(false);
      // peeking: the pointer at the window's left edge, and away again
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); await sleep(300); // (a folder's colour window left open above)
      document.querySelector("#settings[data-open] .st-close")?.click(); await sleep(500); // (and the settings)
      { const before = leftOf("#content"); move(2, innerHeight / 2); await sleep(500);
        ok(`(${innerWidth} px) shut, the pointer at the window's left edge: the card peeks out over the note`, document.body.dataset.sidebar === "peek" && sb.getBoundingClientRect().left >= 0 && leftOf("#content") === before, { state: document.body.dataset.sidebar, content: [before, leftOf("#content")] });
        move(120, innerHeight / 2); await sleep(600);
        ok("… the pointer on the card: it stays", document.body.dataset.sidebar === "peek", document.body.dataset.sidebar);
        move(innerWidth - 80, innerHeight / 2); await sleep(900);
        ok("… the pointer gone from it: it slides away again, and nothing was told the host", document.body.dataset.sidebar === "closed", { state: document.body.dataset.sidebar, ctx: MdPage.ctxOpen(), open: [...document.querySelectorAll(":is(#sblook, .ui-popover)[data-open]")].map((e) => e.id || e.className), sizing: document.body.className, at: (document.elementFromPoint(innerWidth - 80, innerHeight / 2) || {}).id });
        move(innerWidth / 2, innerHeight / 2); move(30, innerHeight / 2); await sleep(400);
        ok("… the pointer passing near the edge, not at it: no peek", document.body.dataset.sidebar === "closed", document.body.dataset.sidebar); }
      { const btn = document.querySelector('#tabs [data-act="sidebar"]'), br = btn.getBoundingClientRect(); move(br.left + br.width / 2, br.top + br.height / 2); await sleep(700);
        ok(`(${innerWidth} px) the pointer resting on the sidebar's button: it peeks out`, document.body.dataset.sidebar === "peek", { state: document.body.dataset.sidebar, at: (document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2) || {}).outerHTML?.slice(0, 80), br: [br.left, br.top, br.width] });
        btn.click(); await sleep(800);
        ok("… the button clicked: it is pinned, and makes room", document.body.dataset.sidebar === "open" && textLeft("#content") >= sb.getBoundingClientRect().right - 1, document.body.dataset.sidebar);
        await toggle(false); }
      { move(2, innerHeight / 2); await sleep(500); const p = document.querySelector("#content p, #content h1"), pr = p.getBoundingClientRect();
        p.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: pr.right - 4, clientY: pr.top + 4, pointerType: "mouse", isPrimary: true })); await sleep(700);
        ok(`(${innerWidth} px) peeking, a press into the note puts it away`, document.body.dataset.sidebar === "closed", document.body.dataset.sidebar); }
      document.querySelector('#tabs [data-act="overview"]').click(); await sleep(900);
      if (document.body.hasAttribute("data-overview")) { await pinned("All Notes", "#overview"); await pinned("All Notes' sheets", "#overview .ov-body"); window.MdOverview && MdOverview.close(false); await sleep(600); }
      else ok("All Notes opened from the strip", false, "");
    };
    await room();
    { // narrower: the page zoomed (fewer CSS pixels across), still wider than a phone's drawer
      const wide = innerWidth, settle = async () => { for (let i = 0, last = -1, n = 0; i < 60 && n < 5; i++) { await sleep(100); n = innerWidth === last ? n + 1 : 0; last = innerWidth; } };
      let steps = 0;
      while (innerWidth > 1000 && steps < 12) { post("zoom", { step: 1 }); steps++; await settle(); }
      if (innerWidth > 760 && innerWidth < wide) await room(); else ok("the window zoomed to between 760 and 1000 px", false, [wide, innerWidth]);
      for (let i = 0; i < steps; i++) post("zoom", { step: -1 });
      await settle();
    }
  } catch (e) { o.error = String(e && e.stack || e); }
  out("sidebar", o);
})();
