/* Development probe (dev/rig.sh blocks): blocks selected as wholes — a click
 * on a handle, then the keyboard — and a click below the document's last
 * block. Works on a copy of tests/fixtures/m5.md. */
(async () => {
  const out = (name, o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    const original = MdView.core.current.raw;
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm;
    const md = () => V.serialize(false);
    const key = (k, mods = {}) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }); Object.defineProperty(e, "keyCode", { get: () => ({ Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40 })[k] || k.toUpperCase().charCodeAt(0) }); view.dom.dispatchEvent(e); return e; };
    const undo = () => key("z", { ctrlKey: true });
    const picked = () => [...view.dom.querySelectorAll(".blk-sel")].map((el) => el.textContent.trim().slice(0, 18));
    const para = (text) => [...view.dom.children].find((p) => p.textContent.startsWith(text));
    const at = (kind, x, y) => post("probe-pointer", { kind, x, y });
    V.focus();

    // --- a click on the handle selects the block (the real pointer)
    const second = para("Second paragraph"), b = second.getBoundingClientRect();
    at("move", b.left + 30, b.top + 8); await sleep(300);
    const h = document.querySelector(".blk-h"), g = h.getBoundingClientRect();
    at("move", g.left + 9, g.top + 9); await sleep(120); at("down", g.left + 9, g.top + 9); await sleep(50); at("up", g.left + 9, g.top + 9); await sleep(300);
    ok("a click on the handle selects its block", picked().join("|") === "Second paragraph f" && view.hasFocus(), picked());
    out("selected", {});
    await sleep(1400); // screenshot
    // a heading selected, its handle under the pointer
    { const h1 = view.dom.querySelector("h1"), hb = h1.getBoundingClientRect();
      A.blocks.select(view, view.posAtDOM(h1, 0) - 1, false);
      at("move", hb.left + 30, hb.top + 12); await sleep(300);
      const hg = document.querySelector(".blk-h").getBoundingClientRect();
      at("move", hg.left + 9, hg.top + 9); await sleep(400);
      out("heading", {}); await sleep(1400);
      A.blocks.select(view, view.posAtDOM(para("Second paragraph"), 0) - 1, false); }
    key("ArrowDown");
    ok("↓ goes to the next block", picked().join("|") === "jslet a = 1;" || picked()[0].includes("let a"), picked());
    key("ArrowUp"); key("ArrowUp");
    ok("↑ ↑ to the one before", picked().join("|") === "First paragraph wi", picked());
    key("ArrowDown", { shiftKey: true }); key("ArrowDown", { shiftKey: true });
    ok("Shift+↓ ↓ takes two more", picked().length === 3 && picked()[0] === "First paragraph wi", picked());
    key("ArrowUp", { shiftKey: true });
    ok("Shift+↑ gives one back", picked().length === 2, picked());
    const copied = new DataTransfer();
    view.dom.dispatchEvent(new ClipboardEvent("copy", { clipboardData: copied, bubbles: true, cancelable: true }));
    ok("copy: the Markdown of the selected blocks", copied.getData("text/plain") === "First paragraph with plain words in it.\n\nSecond paragraph for the bar and the menu." && /<p/.test(copied.getData("text/html")), copied.getData("text/plain"));
    key("ArrowDown", { altKey: true });
    ok("Alt+↓ moves them below the next block", md().startsWith("# Polish\n\n```js\nlet a = 1;\n```\n\nFirst paragraph with plain words in it.\n\nSecond paragraph for the bar and the menu.\n\n| Name") && picked().length === 2, md().slice(0, 140));
    key("ArrowUp", { altKey: true });
    ok("Alt+↑ moves them back", md() === original && picked().length === 2, md().slice(0, 140));
    key("a", { ctrlKey: true });
    ok("Ctrl+A selects all blocks", picked().length === view.state.doc.childCount, [picked().length, view.state.doc.childCount]);
    key("ArrowUp", { ctrlKey: true });
    ok("Ctrl+↑: the first block", picked().join("|") === "Polish", picked());
    key("ArrowDown", { ctrlKey: true });
    ok("Ctrl+↓: the last block", picked().join("|") === "Last paragraph.", picked());
    key("Escape");
    ok("Esc: the caret is in the block again, nothing selected", picked().length === 0 && view.state.selection.empty && view.state.selection.$from.parent.textContent === "Last paragraph.");
    // delete, and undo
    A.blocks.select(view, view.posAtDOM(para("Second paragraph"), 0) - 1, false);
    key("ArrowDown", { shiftKey: true });
    key("Backspace");
    ok("Backspace deletes the selected blocks", !md().includes("Second paragraph") && !md().includes("```js") && md().includes("First paragraph") && picked().length === 0, md().slice(0, 120));
    undo();
    ok("one undo brings them back", md() === original);
    // Enter on a selected island opens it; typing goes on in a text block
    let ip = -1;
    view.state.doc.forEach((n, p) => { if (ip < 0 && n.type.name === "island") ip = p; });
    A.blocks.select(view, ip, false);
    key("Enter");
    await sleep(450);
    ok("Enter on a selected code block opens its dialog", document.getElementById("dlg").hasAttribute("data-open"));
    document.getElementById("dlg").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await sleep(400);
    A.blocks.select(view, view.posAtDOM(para("Second paragraph"), 0) - 1, false);
    const typed = key("x");
    ok("a character typed: the caret is at the end of that block and the key goes on to be typed", !typed.defaultPrevented && picked().length === 0 && view.state.selection.$from.parentOffset === view.state.selection.$from.parent.content.size && view.state.selection.$from.parent.textContent.startsWith("Second"));

    // --- a table selected as a block: the arrows move over blocks, not through its cells
    {
      const wrap = view.dom.querySelector(".table-wrap");
      A.blocks.select(view, wrap.pmViewDesc.posBefore, false);
      await sleep(100);
      ok("a table can be selected as a block", picked().length === 1 && !!view.dom.querySelector(".table-wrap.blk-sel"), picked());
      key("ArrowDown");
      ok("↓ from a selected table goes to the next block", picked().join("|").startsWith("Filler paragraph 1"), picked());
      key("ArrowUp"); key("ArrowUp");
      ok("↑ ↑ over the table to the block above it", picked()[0].includes("let a"), picked());
      key("ArrowDown"); key("ArrowDown", { shiftKey: true });
      ok("Shift+↓ from the table takes the next block too", picked().length === 2 && !!view.dom.querySelector(".table-wrap.blk-sel"), picked());
      key("ArrowUp", { shiftKey: true });
      key("ArrowUp", { altKey: true });
      ok("Alt+↑ moves the table above the code block", md().indexOf("| Name") < md().indexOf("```js") && !!view.dom.querySelector(".table-wrap.blk-sel"), md().slice(60, 200));
      key("ArrowDown", { altKey: true });
      ok("… and Alt+↓ back", md() === original);
      key("Enter");
      ok("Enter puts the caret into the table", picked().length === 0 && !!A.tableui.cellAt(view.state.selection.$from));
    }

    // --- a click into the empty space beside the text lets the selection go
    A.blocks.select(view, view.posAtDOM(para("Second paragraph"), 0) - 1, false);
    await sleep(100);
    { const pr = view.dom.getBoundingClientRect();
      at("move", pr.right + 60, 300); await sleep(60); at("down", pr.right + 60, 300); await sleep(50); at("up", pr.right + 60, 300); await sleep(250); }
    ok("a click into the empty space beside the text lets the selected block go", picked().length === 0 && md() === original, picked());

    // --- a click below the last block
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(200);
    const pm = view.dom.getBoundingClientRect();
    const blocks = view.state.doc.childCount;
    at("move", pm.left + 100, pm.bottom + 80); await sleep(80); at("down", pm.left + 100, pm.bottom + 80); await sleep(50); at("up", pm.left + 100, pm.bottom + 80); await sleep(300);
    ok("a click below the last block: a new line there, the caret in it", view.state.doc.childCount === blocks + 1 && view.state.selection.empty && view.state.selection.$from.parent === view.state.doc.lastChild && view.state.doc.lastChild.content.size === 0 && view.hasFocus(), [view.state.doc.childCount, blocks]);
    ok("… which is nothing in the file until something is written", md() === original);
    at("down", pm.left + 100, pm.bottom + 120); await sleep(50); at("up", pm.left + 100, pm.bottom + 120); await sleep(300);
    ok("a second click makes no second line", view.state.doc.childCount === blocks + 1);
    await sleep(1100);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("blocks", o);
})();
