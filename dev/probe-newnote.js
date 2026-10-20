/* Development probe (dev/rig.sh newnote): New Note asks for nothing. Ctrl+N makes "Untitled" at once, the caret in its empty
 * title (the active mode shows "Untitled" there); what is written there names the file once it is left alone a moment, and when
 * it is left; one left with an empty title stays "Untitled", the next is "Untitled 2"; an old note's title edited does not rename
 * it. A new folder is still asked for. Works on a copy of tests/overview-notes; the folder is read from what the shell sends the
 * page (its tree). */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const until = async (f, ms = 4000) => { for (let t = 0; t < ms; t += 50) { if (f()) return true; await sleep(50); } return !!f(); };
  try {
    await document.fonts.ready;
    await until(() => MdView.core.folder && MdView.core.folder.tree, 8000);
    await sleep(800);
    const root = MdView.core.folder.root;
    const all = () => { const out = [], walk = (d) => { for (const n of d.notes) out.push(n.path.slice(root.length + 1)); for (const x of d.dirs) walk(x); }; walk(MdView.core.folder.tree); return out.sort(); };
    const has = (p) => all().includes(p);
    const cur = () => (MdView.core.current ? MdView.core.current.name : "");
    const pm = () => window.MdActive && MdActive.view.pm;
    const ctrlN = () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", ctrlKey: true, bubbles: true, cancelable: true }));
    const type = (text) => { const v = pm(); v.dispatch(v.state.tr.insertText(text)); };
    const tabName = () => document.querySelector(".tab-list .tab[aria-selected=\"true\"]")?.textContent.trim() || "";
    const open = async (rel) => { MdView.core.post("note", { path: root + "/" + rel }); // (as a row clicked: what is typed is saved first
 await until(() => cur() === rel.split("/").pop(), 5000); await sleep(400); };

    if (window.MdOverview && MdOverview.isOpen) MdOverview.close(false);
    await open("Reading list.md");
    MdView.setMode("active");
    await until(() => document.body.dataset.view === "active" && pm(), 6000);
    await sleep(500);

    // 1. Ctrl+N: no window, the note is there at once, the caret in its empty title
    ctrlN();
    await sleep(150);
    ok("Ctrl+N asks for no name", !document.querySelector("#newdlg[data-open]"));
    await until(() => cur() === "Untitled.md", 5000);
    await until(() => pm() && MdActive.view.payload && MdActive.view.payload.path === MdView.core.current.path && pm().hasFocus(), 3000);
    ok("… “Untitled.md” is made and opens, in the active mode", cur() === "Untitled.md" && document.body.dataset.view === "active" && has("Untitled.md"), [cur(), document.body.dataset.view, all()]);
    const s = pm().state, $c = s.selection.$from;
    ok("… the caret in its title: an empty heading, the first thing in it", pm().hasFocus() && s.selection.empty && $c.parent.type.name === "heading" && $c.parent.attrs.level === 1 && $c.parent.content.size === 0 && $c.index(0) === 0, [$c.parent.type.name, $c.parent.content.size]);
    const h = pm().dom.querySelector("h1");
    ok("… where it shows “Untitled”, greyed, not as text", !!h && h.classList.contains("placeholder") && h.dataset.placeholder === "Untitled" && h.textContent === "", h && h.outerHTML);
    // 2. left with nothing written: it stays Untitled
    await open("Weekend Trip.md");
    ok("a new note left with its title empty keeps its name: Untitled.md", has("Untitled.md"), all());
    // 3. the next is Untitled 2; written in and left at once: named after its title
    ctrlN();
    await until(() => cur() === "Untitled 2.md", 5000);
    await until(() => pm() && MdActive.view.payload && MdActive.view.payload.path === MdView.core.current.path && pm().hasFocus(), 3000);
    ok("the next new note is “Untitled 2.md”", cur() === "Untitled 2.md", cur());
    type("Projektplan");
    await sleep(200);
    await open("Weekend Trip.md");
    await until(() => has("Projektplan.md"), 4000);
    ok("“Projektplan” written in its title, then left: the file is Projektplan.md", has("Projektplan.md") && !has("Untitled 2.md") && has("Untitled.md"), all());
    await open("Projektplan.md");
    ok("… with its text as it was written", /^# Projektplan\s*$/.test(MdView.core.current.text), MdView.core.current.text);
    // 4. written in and left alone a moment, still on screen: named meanwhile, the caret where it was; written on, named again
    MdView.setMode("active"); await sleep(300);
    ctrlN();
    await until(() => cur() === "Untitled 2.md", 5000);
    await until(() => pm() && MdActive.view.payload && MdActive.view.payload.path === MdView.core.current.path && pm().hasFocus(), 3000);
    type("Idee");
    await until(() => cur() === "Idee.md", 5000);
    ok("left alone a moment while it is written: named after its title, still on screen (tab and list)", cur() === "Idee.md" && has("Idee.md") && !has("Untitled 2.md") && /Idee/.test(tabName()), [cur(), all(), tabName()]);
    ok("… the caret still in the title, the note still being written", pm().hasFocus() && pm().state.selection.$from.parent.type.name === "heading" && document.body.dataset.view === "active");
    type(" zwei");
    await until(() => cur() === "Idee zwei.md", 5000);
    await sleep(300);
    await open("Weekend Trip.md");
    await sleep(500);
    ok("written on: named again; nothing written under an old name meanwhile", has("Idee zwei.md") && !has("Idee.md") && !has("Untitled 2.md"), all());
    // 5. a note of before: its title edited, it keeps its name
    await open("Workout routine.md");
    MdView.setMode("active");
    await until(() => document.body.dataset.view === "active" && pm() && MdActive.view.payload.path === MdView.core.current.path, 6000);
    const w = pm(), at = w.state.doc.firstChild;
    ok("(an old note opens with a heading first)", at && at.type.name === "heading", at && at.type.name);
    w.dispatch(w.state.tr.insertText(" (renamed?)", at.nodeSize - 1));
    await sleep(2500);
    await open("Weekend Trip.md");
    await sleep(500);
    ok("an old note's title edited: it keeps its name", has("Workout routine.md") && !all().some((p) => /renamed/.test(p)), all());
    // 6. a folder is still asked for
    document.querySelector('#sidebar [data-act="newmenu"]').click();
    await sleep(250);
    [...document.querySelectorAll("#ctxmenu .menu-item:not([hidden])")].find((b) => b.dataset.cmd === "newfolder")?.click();
    await sleep(400);
    ok("New Folder still asks for its name", !!document.querySelector("#newdlg[data-open]") && document.activeElement === document.getElementById("new-name"));
    document.getElementById("new-name").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  } catch (e) { o.error = String(e && e.stack || e); }
  out("newnote", o);
})();
