/* Development probe (dev/rig.sh m4): tables, footnotes and the clipboard in
 * the running app. Works on a copy of tests/fixtures/m4.md. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    const original = MdView.core.current.raw;
    // the reading view's table, to compare the editable one with
    const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top + scrollY, r.width, r.height].map((x) => Math.round(x * 10) / 10).join(","); };
    const readCells = [...document.querySelectorAll("#content table")[0].querySelectorAll("th, td")].map((c) => box(c) + getComputedStyle(c).backgroundColor + getComputedStyle(c).textAlign);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm, { TextSelection } = PM.state;
    const md = () => V.serialize(false);
    const after = (text) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + text.length; }); if (f < 0) throw new Error("not in the document: " + text); return f; };
    const caret = (pos, to = pos) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos, to)));
    const type = (text) => { for (const ch of text) { const { from, to } = view.state.selection; if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) view.dispatch(view.state.tr.insertText(ch, from, to)); } };
    const key = (target, k, mods = {}) => {
      const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods });
      Object.defineProperty(e, "keyCode", { get: () => ({ Enter: 13, Escape: 27, Backspace: 8, Tab: 9, ArrowDown: 40 })[k] || k.toUpperCase().charCodeAt(0) });
      target.dispatchEvent(e);
    };
    const undo = () => key(view.dom, "z", { ctrlKey: true });
    const menu = document.getElementById("actmenu"), dlg = document.getElementById("dlg");
    const items = () => [...menu.querySelectorAll(".menu-item")].map((b) => b.textContent);
    const choose = async (label) => { const b = [...menu.querySelectorAll(".menu-item")].find((x) => x.querySelector(".menu-label").textContent === label); if (!b) throw new Error("no menu item " + label); b.click(); await sleep(260); };
    V.focus();

    // --- a table looks as in the reading view
    const cells = () => [...view.dom.querySelectorAll("table")[0].querySelectorAll("th, td")];
    ok("the table's cells are where the reading view has them, striped and aligned the same", JSON.stringify(cells().map((c) => box(c) + getComputedStyle(c).backgroundColor + getComputedStyle(c).textAlign)) === JSON.stringify(readCells),
      [cells().map((c) => box(c) + getComputedStyle(c).backgroundColor).slice(0, 6), readCells.slice(0, 6)]);

    // --- typing in a cell
    caret(after("pear"));
    type("s");
    ok("a cell is edited in place; only its line changes", md() === original.replace("| pear  |", "| pears |"), md().slice(0, 200));
    type(" | x");
    ok("a pipe typed in a cell is escaped", md().includes("| pears \\| x |"), md().slice(0, 240));
    undo();
    caret(after("apple"));
    type("# ");
    type("- ");
    ok("what starts a heading or a list elsewhere is text in a cell", view.state.doc.child(1).type.name === "table" && md().includes("| apple# -"), md().slice(0, 200));
    undo(); undo();
    for (let i = 0; i < 6 && md() !== original; i++) undo();
    ok("undone", md() === original, md().slice(0, 200));

    // --- keys
    caret(after("Name"));
    key(view.dom, "Tab");
    ok("Tab goes to the next cell and selects what is in it", view.state.doc.textBetween(view.state.selection.from, view.state.selection.to) === "Qty");
    key(view.dom, "Enter");
    ok("Enter goes to the cell below", A.tableui.cellAt(view.state.selection.$from).r === 1 && A.tableui.cellAt(view.state.selection.$from).c === 1);
    key(view.dom, "Enter", { shiftKey: true });
    ok("Shift+Enter does nothing in a cell", md() === original);
    caret(after("12"));
    key(view.dom, "Tab");
    ok("Tab behind the last cell makes a row", view.state.doc.child(1).childCount === 4 && A.tableui.cellAt(view.state.selection.$from).r === 3);
    undo();
    ok("… one undo step", md() === original);

    // --- handles and their menu
    const td = cells()[2]; // "apple"
    td.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: td.getBoundingClientRect().left + 5, clientY: td.getBoundingClientRect().top + 5 }));
    await sleep(550); // (the handles come when the pointer has rested on the cell a moment)
    const hc = document.querySelector(".tbl-h-col"), hr = document.querySelector(".tbl-h-row");
    const tr0 = td.getBoundingClientRect(), tb = td.closest("table").getBoundingClientRect(), c0 = hc.getBoundingClientRect(), r0 = hr.getBoundingClientRect();
    ok("over a cell, a handle shows above its column and in its row, at the end of the row's first cell", getComputedStyle(hc).opacity === "1" && getComputedStyle(hr).opacity === "1"
      && Math.abs(c0.left + c0.width / 2 - (tr0.left + tr0.width / 2)) < 1.5 && Math.abs(c0.top + c0.height / 2 - tb.top) < 1.5
      && Math.abs(r0.top + r0.height / 2 - (tr0.top + tr0.height / 2)) < 1.5 && Math.abs(r0.left + r0.width / 2 - (td.parentElement.cells[0].getBoundingClientRect().right - 9)) < 1.5, [c0, r0, tr0, tb]);
    out("handles", {});
    await sleep(1400); // screenshot
    hr.click();
    await sleep(350);
    ok("the row handle opens the row menu", menu.hasAttribute("data-open") && items().join("|") === "Insert Row Above|Insert Row Below|Move Row Up|Move Row Down|Delete Row", items());
    out("menu", {});
    await sleep(1400); // screenshot
    await choose("Insert Row Below");
    ok("Insert Row Below: an empty row, the caret in it", md().includes("| apple |   3 |\n|       |     |\n| pear  |  12 |") && A.tableui.cellAt(view.state.selection.$from).r === 2 && view.hasFocus(), md().slice(0, 200));
    type("fig");
    cells()[4].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await sleep(400); // (the handles come when the pointer has rested on the cell a moment)
    document.querySelector(".tbl-h-row").click();
    await sleep(300);
    await choose("Move Row Down");
    ok("Move Row Down", md().includes("| pear  |  12 |\n| fig   |     |"), md().slice(0, 200));
    cells()[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await sleep(400); // (the handles come when the pointer has rested on the cell a moment)
    hc.click();
    await sleep(300);
    ok("the column handle opens the column menu; the alignment in use is ticked", items().length === 8 && menu.querySelector('[aria-checked="true"]')?.querySelector(".menu-label").textContent === "Align Right", items());
    await choose("Align Center");
    ok("Align Center: the marker changes, the view follows", md().includes("|-------|:---:|") && getComputedStyle(cells()[1]).textAlign === "center", md().slice(0, 200));
    cells()[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await sleep(400); // (the handles come when the pointer has rested on the cell a moment)
    hc.click();
    await sleep(300);
    await choose("Insert Column Left");
    type("Unit");
    ok("Insert Column Left", md().includes("| Name  | Unit | Qty |"), md().slice(0, 200));
    // the context menu
    { const r = cells()[4].getBoundingClientRect(); cells()[4].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 14, clientY: r.top + r.height / 2 })); }
    await sleep(300);
    const names = () => [...menu.querySelectorAll(".menu-item")].map((b) => b.querySelector(".menu-label").textContent);
    ok("a right click in a cell: rows, columns and the table", menu.hasAttribute("data-open") && names().includes("Delete Table") && names().includes("Row") && names().includes("Column"), names());
    key(menu, "Escape");
    await sleep(250);
    ok("Esc closes the menu, the editor has the focus again", !menu.hasAttribute("data-open") && view.hasFocus());
    for (let i = 0; i < 12 && md() !== original; i++) undo();
    ok("all of it undone: the file as it was", md() === original, md().slice(0, 200));

    // --- a table made by typing
    caret(after("Typed here."));
    key(view.dom, "Enter");
    type("| City | Pop |");
    key(view.dom, "Enter");
    type("Ulm");
    key(view.dom, "Tab");
    type("126");
    ok("| a | b | and Enter make a table", md().includes("Typed here.\n\n| City | Pop |\n| ---- | --- |\n| Ulm  | 126 |\n"), md().slice(180, 330));

    // --- footnotes
    const sup = view.dom.querySelector("sup.footnote-ref");
    sup.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await sleep(650);
    const pop = document.getElementById("notepop");
    ok("pointing at a reference shows the note", pop.hasAttribute("data-open") && pop.textContent.trim() === "The first note.", pop.textContent);
    out("note", {});
    await sleep(1400); // screenshot
    let refPos = -1;
    view.state.doc.descendants((n, p) => { if (refPos < 0 && n.type.name === "iatom" && n.attrs.kind === "footnote") refPos = p; });
    view.someProp("handleClickOn", (f) => f(view, refPos, view.state.doc.nodeAt(refPos), refPos, { button: 0 }, true));
    await sleep(120);
    const li = view.dom.querySelector('.footnotes li[id="fn1"]');
    ok("a click on it goes to the note, which lights up", li.classList.contains("note-hit") && !pop.hasAttribute("data-open"));
    await sleep(1100);
    ok("… for a second", !li.classList.contains("note-hit"));
    const sectionPos = view.state.doc.content.size - view.state.doc.lastChild.nodeSize;
    view.someProp("handleClickOn", (f) => f(view, sectionPos, view.state.doc.lastChild, sectionPos, { button: 0, target: li.querySelector("p") }, true));
    await sleep(500);
    const ed = () => dlg.querySelector(".ce-in");
    ok("a click on a note opens it", dlg.hasAttribute("data-open") && document.getElementById("dlg-title").textContent === "Footnote 1" && ed().value === "The first note.", ed()?.value);
    ed().value = "The *changed* note.";
    ed().dispatchEvent(new Event("input"));
    key(dlg, "Enter", { ctrlKey: true });
    await sleep(300);
    ok("the definition is written where it stands, the section shows it", md().includes("[^1]: The *changed* note.\n[^long]:") && view.dom.querySelector('.footnotes li[id="fn1"] em')?.textContent === "changed", md().slice(-160));
    undo();
    await sleep(150);
    ok("undo: definition and section as before", md().includes("[^1]: The first note.") && view.dom.querySelector('.footnotes li[id="fn1"]').textContent.includes("The first note."));
    // a new one
    caret(after("Typed here."));
    type("[^new]");
    await sleep(500);
    ok("[^new] typed: a reference, a definition at the end, its dialog", dlg.hasAttribute("data-open") && md().includes("Typed here.[^new]") && md().trimEnd().endsWith("[^new]:"), md().slice(-80));
    key(dlg, "Escape");
    await sleep(300);
    ok("left empty, both are gone again", !md().includes("[^new]"), md().slice(-80));
    type("[^new]");
    await sleep(500);
    ed().value = "A new note.";
    ed().dispatchEvent(new Event("input"));
    key(dlg, "Enter", { ctrlKey: true });
    await sleep(350);
    const sups = [...view.dom.querySelectorAll("sup.footnote-ref")].map((s) => s.textContent);
    ok("with text: numbered in reading order, shown in the section", md().trimEnd().endsWith("[^new]: A new note.") && view.dom.querySelectorAll(".footnotes li").length === 3 && sups.join("") === "[1][2][3]" , [sups, md().slice(-80)]);

    // --- paste
    const paste = (data) => {
      const dt = new DataTransfer();
      for (const [type, value] of Object.entries(data)) dt.setData(type, value);
      const e = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      view.dom.dispatchEvent(e);
      return e.defaultPrevented;
    };
    caret(after("Paste here."));
    key(view.dom, "Enter");
    ok("pasted Markdown is taken over", paste({ "text/plain": "* one\n* __two__\n\n~~~py\nx = 1\n~~~\n" }) && md().includes("Paste here.\n\n* one\n* __two__\n\n~~~py\nx = 1\n~~~\n") && !!view.dom.querySelector(".code-block .hljs-number"), md().slice(-260));
    undo();
    ok("… and is one undo step", !md().includes("~~~py"));
    paste({ "text/plain": "Hello bold link", "text/html": '<meta charset="utf-8"><p style="color:red">Hello <b>bold</b> <a href="https://example.com" class="x">link</a></p><pre><code class="language-js">let a;</code></pre>' });
    await sleep(100);
    ok("pasted HTML becomes Markdown, nothing else", md().includes("Hello **bold** [link](https://example.com)\n\n```js\nlet a;\n```") && !/style|class|<p|<b>/.test(md()), md().slice(-260));
    undo();
    caret(after("Paste "), after("Paste here"));
    paste({ "text/plain": "https://example.org/x" });
    ok("an address pasted over a selection links it", md().includes("Paste [here](https://example.org/x)."), md().slice(-200));
    undo();
    // copy
    const copyOf = () => { const dt = new DataTransfer(); view.dom.dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true })); return { text: dt.getData("text/plain"), html: dt.getData("text/html") }; };
    caret(after("apple") - 5, after("3"));
    await sleep(50);
    let got = copyOf();
    ok("cells copied: their text", /apple/.test(got.text) && /3/.test(got.text), got);
    view.dispatch(view.state.tr.setSelection(new PM.state.AllSelection(view.state.doc)));
    got = copyOf();
    ok("everything copied: the file's Markdown and its HTML", got.text.includes("|-------|----:|\n| apple |   3 |") && got.text.includes("[^1]: The first note.") && /<table/.test(got.html) && /<strong>/.test(got.html), [got.text.slice(0, 200), got.html.slice(0, 200)]);
    // dragging a row and a column by their handles (real pointer events, through the application)
    {
      const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
      const at = (kind, x, y) => post("probe-pointer", { kind, x, y });
      const before = md();
      const pearTd = [...view.dom.querySelectorAll("table")[0].querySelectorAll("td")].find((c) => c.textContent === "pear");
      const pr = pearTd.getBoundingClientRect();
      at("move", pr.left + 6, pr.top + 6); await sleep(300);
      const hr = document.querySelector(".tbl-h-row").getBoundingClientRect();
      const appleTd = [...view.dom.querySelectorAll("table")[0].querySelectorAll("td")].find((c) => c.textContent === "apple");
      const ar = appleTd.getBoundingClientRect();
      at("down", hr.left + hr.width / 2, hr.top + hr.height / 2); await sleep(80);
      at("move", hr.left + hr.width / 2, ar.top + 8); await sleep(80);
      at("move", hr.left + hr.width / 2, ar.top + 4); await sleep(150);
      const lineOn = document.querySelector(".tbl-line").hasAttribute("data-on");
      at("up", hr.left + hr.width / 2, ar.top + 4); await sleep(300);
      ok("a row dragged by its handle moves; a line shows where it goes", lineOn && md().includes("|-------|----:|\n| pear  |  12 |\n| apple |   3 |"), [lineOn, md().slice(30, 140)]);
      ok("… and no menu opens for it", !menu.hasAttribute("data-open"));
      key(view.dom, "z", { ctrlKey: true });
      const nameTh = view.dom.querySelectorAll("table")[0].querySelector("th");
      const qtyTh = view.dom.querySelectorAll("table")[0].querySelectorAll("th")[1];
      const nr = nameTh.getBoundingClientRect(), qr = qtyTh.getBoundingClientRect();
      at("move", qr.left + 6, qr.top + 6); await sleep(300);
      const ch = document.querySelector(".tbl-h-col").getBoundingClientRect();
      at("down", ch.left + ch.width / 2, ch.top + ch.height / 2); await sleep(80);
      at("move", nr.left + 10, ch.top + ch.height / 2); await sleep(80);
      at("move", nr.left + 4, ch.top + ch.height / 2); await sleep(150);
      at("up", nr.left + 4, ch.top + ch.height / 2); await sleep(300);
      ok("a column dragged by its handle moves, with its alignment", md().includes("| Qty | Name  |\n|----:|-------|\n|   3 | apple |"), md().slice(0, 140));
      key(view.dom, "z", { ctrlKey: true });
      ok("both undone", md() === before, md().slice(0, 140));
    }
    caret(after("Typed here."));
    await sleep(1200);
    o.saved = md();
  } catch (e) { o.error = String(e && e.stack || e); }
  out("m4", o);
})();
