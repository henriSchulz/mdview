/* Development probe (dev/rig.sh explorer): the folder's list as a place to work with files — it
 * lists everything but what is put away, hides and shows again, copies, cuts, pastes, duplicates,
 * takes files in from elsewhere, several rows at once — and whiteboards that are files of their
 * own: made, opened, shown in a note, and all of the folder's among All Notes. The rig reads the
 * folder itself afterwards. */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const steps = [];
  const ok = (name, cond, more) => steps.push((cond ? "ok   " : "FAIL ") + name + (cond || more === undefined ? "" : "  (" + JSON.stringify(more) + ")"));
  const until = async (f, ms = 4000) => { for (let t = 0; t < ms; t += 50) { if (f()) return true; await sleep(50); } return !!f(); };
  const done = (error) => { post({ type: "probe", name: "explorer", text: JSON.stringify({ steps, error }) }); post({ type: "close" }); };
  try {
    // (how the folder opened: All Notes over an empty tab — looked at before the note below is opened)
    for (let i = 0; i < 200 && !(window.MdOverview && MdOverview.isOpen && document.querySelector("#overview .ov-tile, #overview .ov-row")); i++) await new Promise((r) => setTimeout(r, 50));
    window.__start = { open: !!(window.MdOverview && MdOverview.isOpen), note: (MdView.core.current && MdView.core.current.path) || null, tabs: document.querySelectorAll("#tabs .tab").length };
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
    ok("a folder opens on All Notes, in the folder itself — an empty tab shown, the note last shown not opened", (() => { const st = window.__start; return st && st.open && !st.note; })(), window.__start);
    // (… and a note given to that tab from the sidebar: All Notes goes, the note is there)
    ok("… a note opened into that tab: All Notes goes", !(window.MdOverview && MdOverview.isOpen) && !!(MdView.core.current && MdView.core.current.path), [window.MdOverview && MdOverview.isOpen]);
    await until(() => MdView.core.folder && MdView.core.current, 8000);
    await sleep(600);
    const root = MdView.core.folder.root, list = document.querySelector("#sidebar .sb-list");
    const item = (p) => [...list.querySelectorAll(".sb-item:not(.leaving)")].find((e) => e.dataset.key === root + "/" + p), row = (p) => item(p) && item(p).firstChild.firstChild;
    const rows = () => [...list.querySelectorAll(".sb-item:not(.leaving)")].map((e) => e.dataset.key.slice(root.length + 1)).sort();
    const prefs = (p) => post({ type: "prefs", prefs: p });
    const key = (el, k, more = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
    const menu = (el, x = 5, y = 5) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y })); return [...document.querySelectorAll("#ctxmenu .menu-item:not([hidden])")].map((e) => e.dataset.cmd); };
    const choose = async (cmd) => { const el = document.querySelector(`#ctxmenu .menu-item[data-cmd="${cmd}"]:not([hidden])`); if (!el) return false; el.click(); await sleep(400); return true; };
    const shut = () => key(document.querySelector("#ctxmenu"), "Escape");
    for (const d of list.querySelectorAll(".sb-item.is-dir:not(.open) > .sb-in > .sb-row")) d.click(); // (every folder open: its rows count)
    await sleep(500);

    // everything that lies there, but what is put away
    ok("the list has every file and folder — notes, a PDF, a picture, any other, an empty folder", JSON.stringify(rows()) === JSON.stringify(["Alpha.md", "Beta.md", "data.csv", "empty", "paper.pdf", "photo.png", "sub", "sub/Inner.md"]), rows());
    prefs({ showHidden: true });
    ok("Hidden Items: a name with a dot and a build folder are listed, dimmed", await until(() => item(".secret") && item("node_modules")) && item(".secret").classList.contains("is-hidden") && item("node_modules").classList.contains("is-hidden") && !item("Alpha.md").classList.contains("is-hidden"), rows());
    ok("… a build folder is not gone into", !rows().some((r) => r.startsWith("node_modules/")), rows());
    prefs({ showHidden: false });
    ok("… and put away again", await until(() => !item(".secret") && !item("node_modules")), rows());
    prefs({ sidebarImages: false });
    ok("a kind taken out (Pictures) is not listed", await until(() => !item("photo.png")) && !!item("paper.pdf"), rows());
    prefs({ sidebarImages: true });
    await until(() => item("photo.png"));

    // the menus
    const onFile = menu(row("Alpha.md")); shut();
    ok("a file's menu has Copy, Cut, Duplicate, Copy Path, Hide — and no Show Again", ["copyf", "cutf", "duplicate", "copypath", "hide", "rename", "trash"].every((c) => onFile.includes(c)) && !onFile.includes("unhide") && !onFile.includes("embed"), onFile);
    const onDir = menu(row("sub")); shut();
    ok("a folder's menu has New Whiteboard, Add Files…, Paste", ["newnote", "newfolder", "newboard", "addfiles", "pastef", "copyf", "hide"].every((c) => onDir.includes(c)), onDir);

    // hidden by hand, and shown again
    menu(row("photo.png")); await choose("hide");
    ok("Hide takes a file out of the list", await until(() => !item("photo.png")), rows());
    prefs({ showHidden: true });
    ok("… with Hidden Items it stands there dimmed, and its menu has Show Again", await until(() => item("photo.png") && item("photo.png").classList.contains("is-hidden")) && (() => { const m = menu(row("photo.png")); shut(); return m.includes("unhide") && !m.includes("hide"); })());
    post({ type: "hide", paths: [root + "/sub"], on: true });
    ok("a folder hidden: all that is in it is", await until(() => item("sub/Inner.md") && item("sub/Inner.md").classList.contains("is-hidden")));
    post({ type: "hide", paths: [root + "/sub"], on: false });
    prefs({ showHidden: false });
    await until(() => item("sub/Inner.md") && !item(".secret"));
    ok("… shown again, it is listed as before; the picture stays hidden", !!item("sub/Inner.md") && !item("photo.png"), rows());

    // a copy beside it; copied and put into a folder; cut and put there
    row("Alpha.md").focus(); key(row("Alpha.md"), "d", { ctrlKey: true });
    ok("Ctrl+D: a copy beside the note", await until(() => item("Alpha copy.md")), rows());
    row("Beta.md").focus(); key(row("Beta.md"), "c", { ctrlKey: true }); await sleep(300);
    row("sub").focus(); key(row("sub"), "v", { ctrlKey: true });
    ok("Ctrl+C on a note, Ctrl+V on a folder: a copy in the folder, the note still where it was", await until(() => item("sub/Beta.md")) && !!item("Beta.md"), rows());
    key(row("sub"), "v", { ctrlKey: true });
    ok("… pasted once more: under the next free name", await until(() => item("sub/Beta 2.md")), rows());
    menu(row("data.csv")); await choose("cutf");
    menu(row("empty")); await choose("pastef");
    ok("Cut and Paste: the file is moved", await until(() => item("empty/data.csv") && !item("data.csv")), rows());

    // files from elsewhere, pulled onto the list
    const outside = root.replace(/\/notes$/, "/outside"), dt = new DataTransfer();
    dt.setData("text/uri-list", ["ext.txt", "pack"].map((n) => "file://" + outside + "/" + n).join("\r\n"));
    const ev = (type, el) => { const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }); el.dispatchEvent(e); return e; };
    const over = ev("dragover", row("sub"));
    const marked = !!document.querySelector(".sb-item.drop-into");
    ev("drop", row("sub"));
    ok("files pulled in from elsewhere: the folder under them is marked, and they are copied into it — a folder whole", over.defaultPrevented && marked && await until(() => item("sub/ext.txt") && item("sub/pack/in.md")), { prevented: over.defaultPrevented, marked, rows: rows() });

    // several at once
    row("Alpha copy.md").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    row("sub/Beta 2.md").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    const many = menu(row("sub/Beta 2.md")); shut();
    ok("Shift+click selects rows; their menu is for all of them", list.querySelectorAll(".sb-row.picked").length === 2 && many.includes("trash") && many.includes("copyf") && !many.includes("rename"), many);
    row("sub/Beta 2.md").focus(); key(row("sub/Beta 2.md"), "Delete");
    ok("Delete: all that is selected goes to the Trash", await until(() => !item("Alpha copy.md") && !item("sub/Beta 2.md")), rows());

    // a whiteboard that is a file of its own
    menu(document.querySelector("#sidebar .sb-list"), 40, document.querySelector("#sidebar .sb-list").clientHeight - 6); // (the empty room)
    ok("the empty room's menu has New Whiteboard", await choose("newboard") && await until(() => document.querySelector("#newdlg[data-open]")));
    const name = document.querySelector("#new-name");
    name.value = "Skizze"; name.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#newdlg form").requestSubmit();
    ok("New Whiteboard: its file is made, listed by its name, and the board opens", await until(() => window.MdBoard && MdBoard.shown && item("Skizze.board.svg"), 8000) && row("Skizze.board.svg").querySelector(".sb-label").textContent === "Skizze" && MdBoard.state().ref === root + "/Skizze.board.svg", window.MdBoard && MdBoard.state() && MdBoard.state().ref);
    await until(() => document.querySelector("#board[data-ready]"), 4000); // (what the file holds is on it: only then is something put there)
    MdBoard.put("sticky"); await sleep(400);
    MdBoard.close(); await sleep(700);
    ok("… shut, the note is there as before", !MdBoard.shown && MdView.core.current.path.endsWith("/Alpha.md"));
    row("Skizze.board.svg").click();
    ok("a click on its row opens it again, with what was put on it", await until(() => MdBoard.shown && MdBoard.state().things.length === 1, 6000), MdBoard.state());
    MdBoard.close(); await sleep(700);

    // … shown in a note
    MdView.setMode("active");
    await until(() => window.MdActive && MdActive.view.pm, 8000); await sleep(500);
    const inNote = menu(row("Skizze.board.svg"));
    ok("its menu has Embed in This Note", inNote.includes("embed") && await choose("embed"), inNote);
    ok("… which puts it into the note as a picture of the board", await until(() => document.querySelector("#active img[src*='Skizze.board.svg'], #active img[data-board]"), 6000), document.querySelector("#active").innerHTML.slice(-300));
    await sleep(1500);

    // a whiteboard a note keeps is in no list of the folder — but among the whiteboards of All Notes
    MdView.core.board.make(() => {}); // (made for the note, as /whiteboard makes one: kept where its pictures go)
    await sleep(2500);
    if (window.MdBoard.shown) { MdBoard.close(); await sleep(500); }
    ok("a whiteboard made in a note is not listed in the sidebar", !rows().some((r) => /board-\d+/.test(r)), rows());
    // --- a PDF among All Notes: its first page on its tile, as a note shows its beginning
    {
      MdOverview.open();
      const tile = () => document.querySelector('#overview .ov-item[data-kind="pdf"]'), img = () => tile() && tile().querySelector("img.ov-shot.on");
      // (the rail at the right is a note's: over All Notes it is not there — in a window wide enough to have one at all)
      const rail = document.getElementById("rrail"), seen = () => !!rail && getComputedStyle(rail).display !== "none" && getComputedStyle(rail).visibility !== "hidden" && getComputedStyle(rail).opacity !== "0";
      ok("over All Notes the rail at the right is not there", await until(() => !seen(), 2000), rail && [getComputedStyle(rail).visibility, getComputedStyle(rail).opacity]);
      ok("All Notes: a PDF's tile shows its first page", await until(() => img() && img().naturalHeight > img().naturalWidth && getComputedStyle(img()).opacity === "1", 10000), tile() ? tile().innerHTML.slice(0, 200) : "no PDF among the tiles");
      MdOverview.close(); await sleep(300);
      MdOverview.open();
      ok("… at once when All Notes is opened again (kept, not drawn anew)", await until(() => tile(), 3000) && !!tile().querySelector("img") && !tile().dataset.shot, tile() && tile().innerHTML.slice(0, 200));
      MdOverview.close(); await sleep(300);
    }
    MdOverview.open(); await sleep(500);
    document.querySelector('#overview [data-seg="scope"] [data-v="boards"]').click();
    const tiles = () => [...document.querySelectorAll("#overview .ov-item")];
    ok("All Notes › Whiteboards: both, each with where it stands", await until(() => tiles().length === 2, 6000) && tiles().some((t) => t.querySelector(".ov-name").textContent === "Skizze" && /Alpha/.test(t.querySelector(".ov-sub").textContent)) && tiles().some((t) => t.dataset.kept != null), tiles().map((t) => t.textContent));
    post({ type: "probe", name: "shot-boards", text: "{}" }); await sleep(1500);
    ok("… all of them, with no choice among them", !document.querySelector("#overview .ov-filter"));
    const kept = menu(tiles().find((t) => t.dataset.kept != null));
    ok("a whiteboard a note keeps: nothing in its menu takes it from the note", kept.includes("open") && kept.includes("boardfree") && !kept.includes("trash") && !kept.includes("rename") && !kept.includes("cutf"), kept);
    await choose("boardfree");
    ok("Keep as a File of Its Own: listed in the sidebar from then on", await until(() => rows().some((r) => /board-\d+/.test(r)), 5000), rows());
    await sleep(300);
    tiles().find((t) => t.querySelector(".ov-name").textContent === "Skizze").click();
    ok("a click on a whiteboard's tile opens the board", await until(() => MdBoard.shown, 6000));
    MdBoard.close(); await sleep(600);
    document.querySelector('#overview [data-seg="scope"] [data-v="all"]').click(); await sleep(300);
    MdOverview.close(); await sleep(300);
    done();
  } catch (e) { done(String((e && e.stack) || e)); }
})();
