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

    // --- the pointer passing over the text sets nothing off: a handle comes when it rests
    {
      at("move", view.dom.getBoundingClientRect().right + 80, 420); await sleep(500);
      const hh = document.querySelector(".blk-h"), seen = [];
      for (const t of ["First paragraph", "Second paragraph", "Filler paragraph 1", "Filler paragraph 2", "Filler paragraph 3"]) {
        const r = para(t).getBoundingClientRect();
        at("move", r.left + 120, r.top + r.height / 2); await sleep(45);
        seen.push(hh.hasAttribute("data-on"));
      }
      at("move", view.dom.getBoundingClientRect().right + 80, 420); await sleep(400);
      ok("moved across five blocks without resting: no handle shows, then or after", seen.every((x) => !x) && !hh.hasAttribute("data-on"), seen);
      const r = para("Second paragraph").getBoundingClientRect();
      at("move", r.left + 120, r.top + r.height / 2); await sleep(60);
      const early = hh.hasAttribute("data-on");
      await sleep(300);
      ok("resting on a block: its handle, after a moment", !early && hh.hasAttribute("data-on") && A.blocks.over() === para("Second paragraph"), [early, hh.hasAttribute("data-on")]);
    }

    // --- the handle shows where it stands: with the pointer beside a block, not only over its text
    {
      at("move", view.dom.getBoundingClientRect().right + 80, 400); await sleep(500);
      const hh = document.querySelector(".blk-h"), pr = view.dom.getBoundingClientRect(), fp = para("First paragraph").getBoundingClientRect();
      ok("away from the text: no handle", !hh.hasAttribute("data-on"));
      at("move", pr.left - 22, fp.top + fp.height / 2); await sleep(250);
      ok("the pointer left of a block, where its handle stands: the handle is there", hh.hasAttribute("data-on") && A.blocks.over() === para("First paragraph") && Math.abs(hh.getBoundingClientRect().left + 9 - (pr.left - 23)) < 4, [hh.hasAttribute("data-on"), A.blocks.over() && A.blocks.over().textContent.slice(0, 12), hh.getBoundingClientRect().left, pr.left]);
      const sp = para("Second paragraph").getBoundingClientRect();
      at("move", pr.left - 22, sp.top + sp.height / 2); await sleep(250);
      ok("moved down beside the next block: that block's handle", A.blocks.over() === para("Second paragraph") && hh.hasAttribute("data-on"));
      const g = hh.getBoundingClientRect();
      at("move", g.left + 9, g.top + 9); await sleep(120); at("down", g.left + 9, g.top + 9); await sleep(50); at("up", g.left + 9, g.top + 9); await sleep(300);
      ok("… and it is clicked from there", picked().join("|") === "Second paragraph f", picked());
      key("Escape");
      at("move", pr.left - 140, sp.top + 8); await sleep(600);
      ok("further out it goes", !hh.hasAttribute("data-on"));
    }

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

    // --- a rectangle pulled from the empty space beside the text takes blocks as wholes (the real pointer)
    for (let i = 0; i < 6 && md() !== original; i++) undo();
    window.scrollTo(0, 0);
    await sleep(250);
    {
      const drag = (x, y) => post("probe-pointer", { kind: "move", x, y, held: true });
      const band = document.querySelector(".blk-band"), pr = view.dom.getBoundingClientRect();
      const f = para("First paragraph").getBoundingClientRect(), s2 = para("Second paragraph").getBoundingClientRect(), h1 = view.dom.firstElementChild.getBoundingClientRect();
      const x0 = pr.right + 50;
      at("move", x0, f.top + 4); await sleep(60); at("down", x0, f.top + 4); await sleep(60);
      drag(x0 - 2, f.top + 5); await sleep(60);
      ok("pressed and barely moved: no rectangle yet", !band.hasAttribute("data-on") && picked().length === 0);
      drag(x0 - 20, f.top + 12); await sleep(80);
      ok("pulled: a rectangle, but beside the text it takes nothing", band.hasAttribute("data-on") && picked().length === 0, picked());
      drag(pr.right - 60, s2.bottom - 4); await sleep(120);
      ok("pulled into the text: the blocks it reaches are selected as wholes", picked().join("|") === "First paragraph wi|Second paragraph f", picked());
      ok("… and no text in them", String(getSelection()) === "" || view.dom.classList.contains("has-blocksel"), String(getSelection()));
      const br = band.getBoundingClientRect();
      ok("the rectangle spans from where it began to the pointer", Math.abs(br.right - x0) < 2 && Math.abs(br.left - (pr.right - 60)) < 2 && Math.abs(br.top - (f.top + 4)) < 2, [br.left, br.right, br.top]);
      drag(pr.right - 60, f.bottom - 2); await sleep(120);
      ok("pulled back: fewer blocks", picked().join("|") === "First paragraph wi", picked());
      drag(pr.right - 60, s2.bottom - 4); await sleep(100);
      at("up", pr.right - 60, s2.bottom - 4); await sleep(300);
      ok("let go: the rectangle is gone, the blocks stay selected, the text has the focus", !band.hasAttribute("data-on") && picked().length === 2 && view.hasFocus(), picked());
      // the handle they share
      at("move", pr.left + 40, f.top + 8); await sleep(300);
      const gh = document.querySelector(".blk-h"), gr = gh.getBoundingClientRect();
      ok("several blocks selected have one handle, beside all of them", gh.hasAttribute("data-group") && gh.hasAttribute("data-on") && gr.top <= f.top && gr.bottom >= s2.bottom && gr.right <= f.left, [gr.top, gr.bottom, f.top, s2.bottom]);
      at("move", pr.left + 40, s2.top + 8); await sleep(200);
      ok("… the same one over the second of them", gh.hasAttribute("data-group") && Math.abs(gh.getBoundingClientRect().top - gr.top) < 1);
      at("move", gr.left + 9, gr.bottom - 12); await sleep(150); at("down", gr.left + 9, gr.bottom - 12); await sleep(50); at("up", gr.left + 9, gr.bottom - 12); await sleep(250);
      ok("a click on it leaves them selected", picked().length === 2 && gh.hasAttribute("data-on"), picked());
      const ghost = A.blocks.ghostOf(A.blocks.groupEls(view.state));
      ok("what is dragged shows all of them", ghost.textContent.includes("First paragraph") && ghost.textContent.includes("Second paragraph") && !ghost.querySelector(".blk-sel") && Math.abs(ghost.offsetWidth - pr.width) < 2 && ghost.offsetHeight > f.height + s2.height, [ghost.offsetWidth, ghost.offsetHeight]);
      ghost.remove();
      at("move", pr.left + 40, para("Filler paragraph 1").getBoundingClientRect().top + 8); await sleep(300);
      ok("over a block that is not selected: that block's own handle", !gh.hasAttribute("data-group") && gh.getBoundingClientRect().height < 30, gh.getBoundingClientRect().height);
      key("ArrowDown", { altKey: true }); await sleep(120);
      ok("the keyboard works on them: Alt+↓ moves both", md().indexOf("```js") < md().indexOf("First paragraph") && picked().length === 2, md().slice(0, 120));
      undo(); await sleep(120);
      // upwards, from beside the second paragraph to the heading
      at("down", x0, s2.bottom - 2); await sleep(60);
      drag(x0 - 20, s2.bottom - 10); await sleep(60);
      drag(pr.right - 80, h1.top + 6); await sleep(120);
      at("up", pr.right - 80, h1.top + 6); await sleep(250);
      const sel = A.blocks.selection(view.state);
      ok("pulled upwards: from the heading to the block it began at", picked().length === 3 && picked()[0].startsWith("Polish") && sel && sel.a === 0 && sel.head === 0, [picked(), sel && sel.head]);
      at("down", x0, f.top + 4); await sleep(60); at("up", x0, f.top + 4); await sleep(250);
      ok("a press let go where it was is a click: the blocks are let go", picked().length === 0 && md() === original, picked());
    }
    await sleep(1100);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("blocks", o);
})();
