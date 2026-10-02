/* Development probe (dev/rig.sh m5): the context menu, the formatting bar,
 * one undo history across the modes, the caret kept between them, the
 * question when the window closes over a changed dialog. Works on a copy of
 * tests/fixtures/m5.md; the rig puts text on the nested session's clipboard. */
(async () => {
  const out = (name, o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    const original = MdView.core.current.raw;
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, { TextSelection } = PM.state;
    const view = () => V.pm;
    const md = () => V.serialize(false);
    const pos = (text, after = true) => { let f = -1; view().state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + (after ? text.length : 0); }); if (f < 0) throw new Error("not in the document: " + text); return f; };
    const select = (text) => view().dispatch(view().state.tr.setSelection(TextSelection.create(view().state.doc, pos(text, false), pos(text))));
    const caret = (p) => view().dispatch(view().state.tr.setSelection(TextSelection.create(view().state.doc, p)));
    const type = (text) => { for (const ch of text) { const { from, to } = view().state.selection; if (!view().someProp("handleTextInput", (f) => f(view(), from, to, ch))) view().dispatch(view().state.tr.insertText(ch, from, to)); } };
    const key = (target, k, mods = {}) => {
      const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods });
      Object.defineProperty(e, "keyCode", { get: () => ({ Enter: 13, Escape: 27, Backspace: 8, Tab: 9, ArrowDown: 40, ArrowRight: 39, ArrowLeft: 37 })[k] || k.toUpperCase().charCodeAt(0) });
      target.dispatchEvent(e);
    };
    const undo = () => key(view().dom, "z", { ctrlKey: true });
    const redo = () => key(view().dom, "z", { ctrlKey: true, shiftKey: true });
    const menu = document.getElementById("actmenu"), sub = document.getElementById("actsub"), bar = document.getElementById("fmtbar"), dlg = document.getElementById("dlg");
    const labels = (m) => [...m.querySelectorAll(".menu-item")].map((b) => b.firstChild.textContent);
    const entry = (m, label) => { const b = [...m.querySelectorAll(".menu-item")].find((x) => x.firstChild.textContent === label); if (!b) throw new Error("no menu item " + label + " in " + labels(m)); return b; };
    const choose = async (m, label) => { entry(m, label).click(); await sleep(260); };
    const hover = async (label) => { entry(menu, label).dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); await sleep(260); };
    const context = async (el) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 12, clientY: r.top + r.height / 2 })); await sleep(300); };
    // … where the caret (or the selection's end) is
    const contextHere = async () => { const c = view().coordsAtPos(view().state.selection.to, -1); ((n) => (n.nodeType === 1 ? n : n.parentElement).closest("p, h1, h2, h3, td, th, li"))(view().domAtPos(view().state.selection.to).node).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: c.left - 2, clientY: (c.top + c.bottom) / 2 })); await sleep(300); };
    const para = (text) => [...view().dom.querySelectorAll("p, h1, h2, h3")].find((p) => p.textContent.includes(text));
    V.focus();

    // --- the context menu on text
    select("plain words");
    await contextHere();
    ok("a right click on text: the editing menu", menu.hasAttribute("data-open") && labels(menu).join("|") === "Cut|Copy|Paste|Paste and Match Style|Add Link…|Format|Paragraph|Insert", labels(menu));
    ok("… and the selection stays", view().state.doc.textBetween(view().state.selection.from, view().state.selection.to) === "plain words");
    await hover("Format");
    ok("Format opens a menu beside it", sub.hasAttribute("data-open") && labels(sub).join("|") === "Bold|Italic|Strikethrough|Code|Formula from Selection" && sub.getBoundingClientRect().left >= menu.getBoundingClientRect().right - 8, [labels(sub), sub.getBoundingClientRect().left, menu.getBoundingClientRect().right, sub.hasAttribute("data-open")]);
    out("menu", {});
    await sleep(1400); // screenshot
    await choose(sub, "Bold");
    ok("Bold from the menu", md().includes("with **plain words** in it") && !menu.hasAttribute("data-open") && view().hasFocus(), md().slice(0, 80));
    await contextHere();
    key(menu, "ArrowDown"); key(menu, "ArrowDown"); key(menu, "ArrowDown"); key(menu, "ArrowDown"); key(menu, "ArrowDown"); key(menu, "ArrowDown");
    key(menu, "ArrowRight");
    await sleep(200);
    ok("by keyboard: down to Format, right into it; what is on is ticked", sub.hasAttribute("data-open") && A.menu.panel === "sub" && sub.querySelector('[aria-checked="true"]')?.firstChild.textContent === "Bold", [document.activeElement.id, labels(sub)]);
    key(sub, "ArrowLeft");
    await sleep(120);
    ok("left closes it again", !sub.hasAttribute("data-open") && A.menu.panel === "root");
    key(menu, "Escape");
    await sleep(250);
    undo();
    ok("undone", md() === original, md().slice(0, 80));

    caret(pos("Second paragraph"));
    await contextHere();
    await hover("Paragraph");
    await choose(sub, "Heading 2");
    ok("Paragraph › Heading 2", md().includes("\n## Second paragraph for the bar and the menu.\n"), md().slice(40, 140));
    await contextHere();
    await hover("Paragraph");
    ok("… is ticked there now", sub.querySelector('[aria-checked="true"]')?.firstChild.textContent === "Heading 2");
    await choose(sub, "Text");
    ok("Paragraph › Text: as it was", md() === original);
    await contextHere();
    await hover("Insert");
    await choose(sub, "Table");
    type("x");
    ok("Insert › Table: a table below, the caret in its first cell", md().includes("menu.\n\n| x   |     |\n| --- | --- |\n|     |     |\n|     |     |\n"), md().slice(80, 220));
    undo(); undo();
    ok("undone", md() === original, md().slice(80, 220));

    // paste from the menu: the application hands the clipboard over
    caret(pos("Second paragraph"));
    await contextHere();
    await choose(menu, "Paste");
    for (let i = 0; i < 40 && !md().includes("menupaste"); i++) await sleep(50);
    ok("Paste from the menu reads the clipboard as Markdown", md().includes("Second paragraph**menupaste** for"), md().slice(60, 140));
    undo();

    // --- on an island, in a cell
    await context(view().dom.querySelector(".isl[data-kind='code']"));
    ok("a right click on a code block: Edit, Cut, Copy as Markdown, Delete", labels(menu).join("|") === "Edit…|Cut|Copy as Markdown|Delete", labels(menu));
    await choose(menu, "Delete");
    ok("Delete removes it", !md().includes("```js"));
    undo();
    await context(view().dom.querySelector("td"));
    ok("in a cell: rows, columns, the table", labels(menu).includes("Row") && labels(menu).includes("Column") && labels(menu).includes("Delete Table") && !labels(menu).includes("Paragraph"), labels(menu));
    await hover("Column");
    await choose(sub, "Align Center");
    ok("Column › Align Center", md().includes("|:-----:|"), md().slice(150, 240));
    undo();
    ok("the file is as it was", md() === original);

    // --- the formatting bar
    V.focus();
    select("bar and the menu");
    await sleep(60);
    ok("a selection: no bar at once", !bar.hasAttribute("data-open"));
    await sleep(400);
    const br = bar.getBoundingClientRect(), sr = view().coordsAtPos(view().state.selection.from);
    ok("… after a moment it floats over the selection, inside the window", bar.hasAttribute("data-open") && br.bottom <= sr.top && sr.top - br.bottom < 16 && br.left >= 8 && br.right <= innerWidth - 8 && getComputedStyle(bar).opacity === "1", [br, sr.top]);
    out("bar", {});
    await sleep(1400); // screenshot
    const btn = (id) => bar.querySelector(`[data-do="${id}"]`);
    btn("strong").click();
    ok("B makes it bold and shows as on", md().includes("the **bar and the menu**.") && btn("strong").classList.contains("active") && bar.hasAttribute("data-open"), md().slice(60, 140));
    btn("strong").click();
    ok("… and off again", md() === original && !btn("strong").classList.contains("active"));
    btn("em").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await sleep(850);
    const tip = document.getElementById("acttip");
    ok("a button says what it is after a moment", tip.hasAttribute("data-open") && tip.textContent === "Italic (Ctrl+I)" && !btn("em").title, tip.textContent);
    bar.dispatchEvent(new MouseEvent("mouseleave"));
    btn("para").click();
    await sleep(300);
    await choose(menu, "Quote");
    ok("the paragraph menu: Quote", md().includes("\n> Second paragraph for the bar and the menu.\n"), md().slice(40, 140));
    undo();
    select("bar and the menu");
    await sleep(350);
    btn("math").click();
    await sleep(100);
    ok("∑ turns the selection into a formula", md().includes("for the $bar and the menu$."), md().slice(60, 140));
    undo();
    select("bar and the menu");
    await sleep(350);
    key(view().dom, "Escape");
    await sleep(50);
    ok("Esc puts the bar away", !bar.hasAttribute("data-open"));
    select("Second");
    await sleep(350);
    type("Zweiter");
    ok("typing puts it away", !bar.hasAttribute("data-open") && md().includes("Zweiter paragraph"));
    undo();
    ok("the file is as it was", md() === original, md().slice(40, 140));

    // --- one history across the modes
    caret(pos("plain words"));
    type(" ONE");
    await sleep(1000); // saved
    type(" TWO");
    const ed = document.getElementById("ed-input");
    MdView.setMode("edit");
    await sleep(500);
    const want = original.replace("plain words", "plain words ONE TWO");
    ok("source editor: the text with what was done here", document.body.dataset.view === "edit" && ed.value === want, ed.value.slice(0, 80));
    ok("… and the caret where it was", ed.selectionStart === want.indexOf("TWO") + 3 && document.activeElement === ed, [ed.selectionStart, want.indexOf("TWO") + 3]);
    document.execCommand("undo");
    ok("undo there takes back the last step made here", ed.value === original.replace("plain words", "plain words ONE"), ed.value.slice(0, 80));
    document.execCommand("undo");
    ok("… and the one before", ed.value === original, ed.value.slice(0, 80));
    document.execCommand("redo"); document.execCommand("redo");
    ok("redo brings both back", ed.value === want);
    const at = want.indexOf("Second paragraph") + "Second".length;
    ed.setSelectionRange(at, at);
    document.execCommand("insertText", false, " SRC");
    MdView.setMode("active");
    await sleep(500);
    ok("back here: the source editor's change is in the document", md() === want.replace("Second paragraph", "Second SRC paragraph"), md().slice(40, 140));
    ok("… the caret where it was there", view().state.selection.head === pos("Second SRC"), [view().state.selection.head, pos("Second SRC")]);
    undo();
    await sleep(200);
    ok("undo here takes back what was done there", md() === want, md().slice(40, 140));
    redo();
    await sleep(200);
    ok("redo brings it back", md() === want.replace("Second paragraph", "Second SRC paragraph"), md().slice(40, 140));
    undo();
    await sleep(200);
    view().dispatch(view().state.tr.delete(pos("plain words"), pos("ONE TWO")));
    ok("back to the original by hand", md() === original, md().slice(0, 80));

    // --- undo far away: the caret comes into view, a fifth of the window in
    caret(pos("Filler paragraph 30"));
    type("!");
    window.scrollTo(0, 0);
    await sleep(100);
    undo();
    await sleep(900);
    const c = view().coordsAtPos(view().state.selection.head);
    ok("undo scrolls to where it happened, with room around it", md() === original && scrollY > 200 && c.top >= innerHeight * 0.15 && c.bottom <= innerHeight * 0.85, [c.top, c.bottom, innerHeight, scrollY]);

    // --- closing the window over a dialog with changes in it
    const code = view().dom.querySelector(".isl[data-kind='code']");
    code.scrollIntoView({ block: "center" });
    let ip = -1;
    view().state.doc.forEach((n, p) => { if (ip < 0 && n.type.name === "island") ip = p; });
    A.islands.open(view(), ip);
    await sleep(500);
    const input = dlg.querySelector(".ce-in");
    input.value = "let a = 2;";
    input.dispatchEvent(new Event("input"));
    MdView.flush(true);
    await sleep(700);
    const ask = dlg.querySelector(".dlg-ask");
    ok("closing the window over a changed dialog asks", ask.hasAttribute("data-open") && document.activeElement?.dataset.ask === "apply", document.activeElement?.outerHTML.slice(0, 80));
    out("ask", {});
    await sleep(1400); // screenshot
    ask.querySelector('[data-ask="cancel"]').click();
    await sleep(600);
    ok("Cancel: the window and the dialog stay", !ask.hasAttribute("data-open") && dlg.hasAttribute("data-open") && input.value === "let a = 2;");
    o.saved = md();
    out("m5", o);
    await sleep(300);
    // Apply: the change is saved and the window goes (the rig looks at the file and the process)
    MdView.flush(true);
    await sleep(500);
    ask.querySelector('[data-ask="apply"]').click();
    return;
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("m5", o);
})();
