/* Development probe (dev/rig.sh overview): all notes of a folder as tiles — a tile per note with the
 * note's beginning in it, its colour, the folders' headings, the keys, opening a note from a tile.
 * Works on a copy of tests/overview-notes. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  window.addEventListener("error", (e) => { o.jsError = String(e.message); });
  try {
    await document.fonts.ready; await sleep(1200);
    const ov = document.getElementById("overview");
    ok("a folder window opens on All Notes, on its folders", ov.hasAttribute("data-open") && ov.querySelector('[data-seg="scope"] [aria-checked="true"]')?.dataset.v === "folders");
    // (a folder's sign from Lucide is loaded when a folder first needs it — here, the stacks the window opens with: drawn again when it is there)
    const bulb = () => window.MdIcons && MdIcons.names.lightbulb, signOf = (sel) => ov.querySelector(`${sel}[data-dir="Ideen"] .ov-icon`)?.innerHTML || "";
    ok("a folder's sign of its own (Lucide's) is on its stack, as the sidebar has it", !!bulb() && signOf(".ov-tile").includes(bulb().slice(0, 40)), signOf(".ov-tile").slice(0, 80));
    // (a note is opened, as one is on screen when the tiles are asked for)
    const root = window.MdView.core.folder.tree.path || window.MdView.core.folder.path;
    if (!window.MdView.core.current) { post("note", { path: root + "/Weekend Trip.md" }); await sleep(1500); }
    const btn = document.querySelector('#tabs [data-act="overview"]'); // (the house before the tabs)
    ok("the button shows in a folder window", btn && getComputedStyle(btn).display !== "none");
    btn.click();
    await sleep(1500);
    { const look = (x) => { const c = getComputedStyle(x); return [c.backgroundColor, c.boxShadow, c.borderRadius, x.offsetHeight].join(" "); };
      const tools = [...ov.querySelectorAll(".ov-head .ov-tools > *")], mid = (x) => { const r = x.getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
      ok("the pasteboard's button looks as \"…\" beside it does", look(ov.querySelector(".ov-pastebtn")) === look(ov.querySelector(".ov-more")), [look(ov.querySelector(".ov-pastebtn")), look(ov.querySelector(".ov-more"))]);
      ok("the choices and the buttons stand on one line, together", tools.length === 4 && tools.every((x) => Math.abs(mid(x) - mid(tools[0])) <= 1), tools.map(mid)); }
    ok("the house opens it on the folders, whatever was shown last", ov.querySelector('[data-seg="scope"] [aria-checked="true"]')?.dataset.v === "folders");
    ov.querySelector('[data-seg="scope"] [data-v="all"]').click(); await sleep(900); // (every note: the checks below)
    const tiles = [...ov.querySelectorAll(".ov-tile")];
    ok("open, with a tile for every note", ov.hasAttribute("data-open") && tiles.length === 8, tiles.length);
    ok("the notes are rendered into their tiles", tiles.filter((t) => t.querySelector(".ov-prev").children.length).length >= 7, tiles.map((t) => t.querySelector(".ov-prev").children.length));
    ok("a tile is a sheet of paper, its name and when it was changed under it", tiles.every((t) => { const sh = t.querySelector(".ov-sheet"), nm = t.querySelector(".ov-name"), sub = t.querySelector(".ov-sub"); return sh && sh.querySelector(".ov-prev") && nm.getBoundingClientRect().top >= sh.getBoundingClientRect().bottom && /^Today, \d/.test(sub.textContent) && getComputedStyle(t).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(sh).boxShadow !== "none"; }), tiles.map((t) => t.querySelector(".ov-sub")?.textContent));
    ok("a note's colour is its tile's", ov.querySelector('.ov-tile.ov-red .ov-name')?.textContent === "Reading list" && ov.querySelectorAll(".ov-tile[class*=' ov-']").length >= 5);
    ok("folders have their headings", [...ov.querySelectorAll(".ov-dir")].map((h) => h.textContent).join("|") === "Ideen|Projekte", [...ov.querySelectorAll(".ov-dir")].map((h) => h.textContent));
    o.ring = getComputedStyle(ov.querySelector(".ov-tile[aria-current]")).outlineColor;
    ok("opened with the button, the note on screen wears no ring", /rgba\(.*, 0\)|transparent/.test(o.ring), o.ring);
    ok("the note on screen is marked and has the focus", ov.querySelector(".ov-tile[aria-current]") === document.activeElement, document.activeElement && document.activeElement.className);
    ok("no ids from the notes in the page twice", new Set([...document.querySelectorAll("[id]")].map((x) => x.id)).size === document.querySelectorAll("[id]").length);
    const key = (k) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    const first = tiles[0]; first.focus();
    key("ArrowRight");
    ok("→ goes to the next tile", document.activeElement === tiles[1], document.activeElement.dataset.path);
    await sleep(400); // (the ring fades in)
    ok("the arrow keys show their place: a ring around that tile", !/rgba\(.*, 0\)|transparent/.test(getComputedStyle(document.activeElement).outlineColor), getComputedStyle(document.activeElement).outlineColor);
    key("ArrowDown");
    ok("↓ goes a row down (into the next folder's grid)", document.activeElement !== tiles[1] && document.activeElement.classList.contains("ov-tile"), document.activeElement.dataset && document.activeElement.dataset.path);
    o.focusName = document.activeElement.querySelector(".ov-name")?.textContent;
    ok("tasks keep their boxes, links lead nowhere", !!ov.querySelector(".ov-prev input[type=checkbox]") && !ov.querySelector(".ov-prev a[href]"));
    const noteOnly = () => [...document.querySelectorAll('#toolbar :is([data-act="outline"], [data-act="find"], [data-act="share"], .seg)')].map((b) => getComputedStyle(b).pointerEvents);
    ok("over the tiles the note's buttons take no click, the tiles' and the sidebar's do", noteOnly().length === 4 && noteOnly().every((v) => v === "none") && getComputedStyle(btn).pointerEvents !== "none" && getComputedStyle(document.querySelector('#tabs [data-act="sidebar"]')).pointerEvents !== "none", noteOnly().join());
    out("shot", {});
    await sleep(1400); // screenshot
    key("Escape");
    await sleep(500);
    ok("Esc closes it", !ov.hasAttribute("data-open") && btn.getAttribute("aria-pressed") === "false");
    ok("closed, outline, find and the modes take clicks again", [...document.querySelectorAll('#toolbar :is([data-act="outline"], [data-act="find"], .seg)')].every((x) => getComputedStyle(x).pointerEvents !== "none"));
    btn.click(); await sleep(700);
    ov.querySelector('[data-seg="scope"] [data-v="all"]').click(); await sleep(700);
    const target = [...ov.querySelectorAll(".ov-tile")].find((t) => t.querySelector(".ov-name").textContent === "Decorations");
    target.focus(); target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(1200);
    ok("Enter opens the note and closes the tiles", !ov.hasAttribute("data-open") && document.title === "Decorations.md" && !!document.querySelector("#content blockquote.deco-block.deco-magenta"), document.title);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await sleep(500);
    ok("Ctrl+Alt+G opens it again, the note on screen marked", ov.hasAttribute("data-open") && ov.querySelector(".ov-tile[aria-current] .ov-name")?.textContent === "Decorations");
    // the head's choices: a list, folders to click through; the file menu on a note
    const opt = (seg, v) => ov.querySelector(`[data-seg="${seg}"] [data-v="${v}"]`);
    opt("scope", "all").click(); await sleep(700); // (it opened in the note's folder: every note again)
    const names = (sel) => [...ov.querySelectorAll(sel)].map((t) => t.querySelector(".ov-name").textContent);
    const menu = document.getElementById("ctxmenu"), shown = () => [...menu.querySelectorAll(".menu-item:not([hidden]) .menu-label")].map((x) => x.textContent).join("|");
    const edges = () => { const h = document.querySelector("#overview .ov-head").getBoundingClientRect(), b = document.querySelector("#overview .ov-body").getBoundingClientRect(); return [h.left, h.right, b.left, b.right].map(Math.round).join(); };
    const tilesAt = edges();
    opt("layout", "list").click(); await sleep(900);
    ok("as a list the page is as wide as with tiles: nothing moves sideways at the switch", edges() === tilesAt, [tilesAt, edges()]);
    { const ov = document.getElementById("overview"); ok("… whether there is something to scroll or not", ov.offsetWidth - ov.clientWidth > 0 && getComputedStyle(ov).overflowY === "scroll", [ov.offsetWidth, ov.clientWidth]); }
    ok("List: a row per note, the note on screen marked, its first words beside the name", ov.querySelectorAll(".ov-row").length === 8 && !ov.querySelector(".ov-tile") && ov.querySelector(".ov-row[aria-current] .ov-name")?.textContent === "Decorations" && [...ov.querySelectorAll(".ov-row .ov-snip")].filter((x) => x.textContent).length >= 6, names(".ov-row").join());
    ok("… no card around the rows; each has the note's sheet in small and says when it was changed", getComputedStyle(ov.querySelector(".ov-list")).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(ov.querySelector(".ov-list")).boxShadow === "none" && [...ov.querySelectorAll(".ov-row")].every((r) => r.querySelector(".ov-mini .ov-prev") && /^Today, \d/.test(r.querySelector(".ov-when").textContent)) && ov.querySelectorAll(".ov-row .ov-mini .ov-prev > *").length > 6, [...ov.querySelectorAll(".ov-when")].map((x) => x.textContent));
    out("shot-list", {}); await sleep(1300);
    opt("scope", "folders").click(); await sleep(600);
    ok("Folders: the folder's own folders first, then its notes", names(".ov-row").join("|") === "Ideen|Projekte|Lecture Notes|Reading list|Weekend Trip|Workout routine" && ov.querySelectorAll(".ov-row.ov-folder").length === 2, names(".ov-row").join("|"));
    ok("… and on its row", !!bulb() && signOf(".ov-row").includes(bulb().slice(0, 40)), signOf(".ov-row").slice(0, 80));
    opt("layout", "tiles").click(); await sleep(600);
    ok("as tiles too", ov.querySelectorAll(".ov-tile").length === 6 && ov.querySelectorAll(".ov-tile.ov-folder").length === 2 && /2 notes/.test(ov.querySelector(".ov-folder .ov-sub").textContent), ov.querySelectorAll(".ov-tile").length);
    ok("a folder is a stack of three sheets, its sign on the one on top, its name under it", [...ov.querySelectorAll(".ov-tile.ov-folder")].every((t) => t.querySelectorAll(".ov-stack > i").length === 3 && t.querySelector(".ov-stack > i:last-child .ov-icon") && t.querySelector(".ov-name").getBoundingClientRect().top >= t.querySelector(".ov-stack").getBoundingClientRect().bottom));
    out("shot-folders", {}); await sleep(1300);
    [...ov.querySelectorAll(".ov-folder")].find((t) => t.dataset.dir === "Projekte").click(); await sleep(600);
    ok("a click on a folder goes into it; the way back stands in the title", names(".ov-tile").sort().join("|") === "Commute thoughts|Decorations" && ov.querySelector(".ov-crumb")?.textContent === "Notes" && ov.querySelector(".ov-title").textContent.endsWith("Projekte"), ov.querySelector(".ov-title").textContent);
    const sorted = (sel) => names(sel).sort().join("|"); // (their order is the sidebar's: the one opened last first)
    const note = [...ov.querySelectorAll(".ov-tile")].find((t) => t.querySelector(".ov-name").textContent === "Commute thoughts");
    note.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 420, clientY: 300 })); await sleep(400);
    ok("a right click on a note: the file menu", menu.hasAttribute("data-open") && shown() === "Open|Open in New Tab|Open Beside|Open in Default App|Open With…|Show in Finder|Copy|Cut|Duplicate|Copy Path|Share…|Rename|Hide|Move to Trash|Show", shown());
    out("shot-menu", {}); await sleep(1300);
    [...menu.querySelectorAll(".menu-item:not([hidden])")].find((x) => x.dataset.cmd === "rename").click(); await sleep(500);
    const field = ov.querySelector(".ov-rename");
    ok("Rename: the name is a field where it stood", !!field && field.value === "Commute thoughts" && document.activeElement === field, field && field.value);
    field.value = "Commute ideas"; field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await sleep(1200);
    ok("Enter renames the file; the tiles follow", sorted(".ov-tile") === "Commute ideas|Decorations", names(".ov-tile").join("|"));
    ov.querySelector(".ov-body").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 900, clientY: 600 })); await sleep(400);
    ok("a right click on the empty room: New Note, New Folder, New Whiteboard, Add Files…, Paste, the orders", menu.hasAttribute("data-open") && shown() === "New Note|New Folder|New Whiteboard|Add Files…|Paste|Sort by Name|Sort by Last Opened|Sort by Date Modified|Settings…|Show", shown());
    [...menu.querySelectorAll(".menu-item:not([hidden])")].find((x) => x.dataset.cmd === "newfolder").click(); await sleep(500);
    const nf = document.querySelector("#newdlg input");
    ok("New Folder: a small window asks for its name", document.activeElement === nf && /Folder/.test(nf.placeholder), nf && nf.placeholder);
    nf.value = "Skizzen"; nf.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await sleep(1200);
    ok("it is made in the folder shown, and stands among the tiles", names(".ov-tile.ov-folder").join("|") === "Skizzen" && ov.querySelector(".ov-folder").dataset.path.endsWith("/Projekte/Skizzen"), names(".ov-tile").join("|"));
    ov.querySelector(".ov-tile").focus(); key("Backspace"); await sleep(600);
    ok("Backspace goes up, onto the folder left", document.activeElement.dataset.dir === "Projekte" && !ov.querySelector(".ov-crumb"), document.activeElement.className);
    ov.querySelector(".ov-folder").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 420, clientY: 300 })); await sleep(400);
    ok("a folder's menu is the one its row in the sidebar has: Open, the four new things, Paste, Show in Finder, Copy, Cut, Duplicate, Copy Path, Colour and Icon…, Rename, Hide, Move to Trash, Show", shown() === "Open|New Note|New Folder|New Whiteboard|Add Files…|Paste|Show in Finder|Copy|Cut|Duplicate|Copy Path|Colour and Icon…|Add to Favourites|Rename|Hide|Move to Trash|Show", shown());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await sleep(300);
    key("Escape"); await sleep(500);
    btn.click(); await sleep(700);
    ok("opened again in Folders: in the folder of the note on screen, that note marked", ov.querySelector(".ov-title").textContent.endsWith("Projekte") && ov.querySelector(".ov-item[aria-current] .ov-name")?.textContent === "Decorations", ov.querySelector(".ov-title").textContent);
    ov.querySelector(".ov-crumb").click(); await sleep(500);
    opt("scope", "all").click(); await sleep(500);
    ok("All Notes again: every note, by folder", ov.querySelectorAll(".ov-tile").length === 8 && ov.querySelectorAll(".ov-dir").length === 2);
  } catch (e) { o.error = String(e && e.stack || e); }
  post("probe", { name: "ov", text: JSON.stringify(o) });
})();
