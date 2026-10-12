/* Development probe (dev/rig.sh colsel): the rectangle pulled over blocks that stand in a column
 * (the real pointer) — it takes the list items, paragraphs and headings it reaches, as it does
 * outside columns, not the list or the column around them; the handle of an item there, and
 * Shift. Works on a note the rig writes. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready; await sleep(700);
    // (the rig's window can be half as wide as usual, and columns stand one under the other then: the page smaller, until they are side by side)
    if (innerWidth < 1000) { post("zoom", { step: -Math.ceil((1 - innerWidth / 1000) * 10) }); await sleep(600); }
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, view = A.view.pm;
    const md = () => A.view.serialize(false), original = md();
    const key = (k, mods = {}) => view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
    // what is selected: "kind:first words" of each block, in the document's order
    const short = { list_item: "item", paragraph: "p", heading: "h", bullet_list: "list", ordered_list: "list", columns: "row", blockquote: "quote", callout: "callout" };
    const picked = () => A.blocks.picked(view.state).map((x) => (short[x.node.type.name] || x.node.type.name) + ":" + x.node.textContent.trim().slice(0, 9).trim()).join("|");
    const shown = () => [...view.dom.querySelectorAll(".blk-sel")].length;
    // the element of the item (or block) whose own text is `text`, and where it is
    const own = (text) => [...view.dom.querySelectorAll("li > p, li > .li-body > p, .col > p, .col > h2, .pm > p")].find((p) => p.textContent.trim() === text);
    const item = (text) => own(text).closest("li") || own(text);
    const box = (text) => own(text).getBoundingClientRect();
    const at = (kind, x, y, more = {}) => post("probe-pointer", { kind, x, y, ...more });
    /* a rectangle pulled from (x0, y0) to (x1, y1) and held there; let(): let go, and a click into the empty space to let the blocks go */
    const pull = async (x0, y0, x1, y1) => {
      at("move", x0, y0); await sleep(60); at("down", x0, y0); await sleep(60);
      at("move", x0 + (x1 > x0 ? 8 : -8), y0 + 2, { held: true }); await sleep(60);
      at("move", x1, y1, { held: true }); await sleep(160);
    };
    const to = async (x, y) => { at("move", x, y, { held: true }); await sleep(160); };
    let last = [0, 0];
    const pulled = async (...a) => { await pull(...a); last = [a[2], a[3]]; };
    const let_ = async () => { at("up", last[0], last[1]); await sleep(220); };
    const free = async () => { const pm = view.dom.getBoundingClientRect(); at("move", pm.right + 70, 300); await sleep(60); at("down", pm.right + 70, 300); await sleep(50); at("up", pm.right + 70, 300); await sleep(220); if (picked()) ok("a click into the empty space lets the blocks go", false, picked()); };
    A.view.focus();

    const pm = view.dom.getBoundingClientRect(), cols = [...view.dom.querySelectorAll(".cols > .col")].map((c) => c.getBoundingClientRect());
    ok("the note's two columns stand side by side", cols.length === 2 && cols[1].left > cols[0].right && Math.abs(cols[0].top - cols[1].top) < 1, [innerWidth, cols.map((c) => [c.left, c.top])]);
    const leftX = pm.left - 70, gapX = (cols[0].right + cols[1].left) / 2, rightX = pm.right + 70;
    const two = box("L two"), three = box("L three"), one = box("L one");

    // --- one item of a list in a column (what Henri pulled over)
    await pulled(leftX, two.top + 3, cols[0].left + 90, two.bottom - 3);
    ok("a rectangle from beside the note over one item of a list in a column: that item, not the list or the column", picked() === "item:L two", picked());
    ok("… and it alone is shown selected", shown() === 1 && item("L two").classList.contains("blk-sel"), shown());
    await to(cols[0].left + 90, three.bottom - 3);
    ok("… pulled on over the next item: the two", picked() === "item:L two|item:L three", picked());
    await to(cols[0].left + 90, two.bottom - 3);
    ok("… pulled back: the one again", picked() === "item:L two", picked());
    await let_();
    ok("let go: it stays selected", picked() === "item:L two" && view.hasFocus(), picked());
    await free();
    await pulled(leftX, one.top + 3, cols[0].left + 90, three.bottom - 3);
    ok("all the items of the list: the list itself, as outside columns", picked() === "list:L oneL tw", picked());
    await let_(); await free();

    // --- other blocks of a column
    const lp = box("Left paragraph.");
    await pulled(leftX, lp.top + 3, cols[0].left + 90, lp.bottom - 3);
    ok("a paragraph in a column: the paragraph", picked() === "p:Left para", picked());
    await let_(); await free();
    await pulled(leftX, three.top + 3, cols[0].left + 90, lp.bottom - 3);
    ok("from the last item of a list to the paragraph under it: that item and the paragraph, not the whole list", picked() === "item:L three|p:Left para", picked());
    await let_(); await free();
    const lh = box("Left");
    await pulled(leftX, lh.top + 3, cols[0].left + 90, one.bottom - 3);
    ok("from the heading to the first item under it: the heading and that item", picked() === "h:Left|item:L one", picked());
    await let_(); await free();
    const a1 = box("nested A1"), a2 = box("nested A2");
    await pulled(leftX, a1.top + 3, cols[0].left + 90, a1.bottom - 3);
    ok("an item of a list inside an item, in a column: that item", picked() === "item:nested A1", picked());
    await to(cols[0].left + 90, a2.bottom - 3);
    ok("… and the next one with it", picked() === "item:nested A1|item:nested A2", picked());
    await let_(); await free();

    // --- the other column, from the gap between the two and from the right
    const r2 = box("R two"), r1 = box("R one");
    await pulled(gapX, r2.top + 3, cols[1].left + 90, r2.bottom - 3);
    ok("pressed in the gap between the columns and pulled over one item of the right one: that item", document.querySelector(".blk-band").hasAttribute("data-on") && picked() === "item:R two", picked());
    await let_(); await free();
    await pulled(rightX, r1.top + 3, cols[1].right - 60, r1.bottom - 3);
    ok("from the right of the note over one item of the right column: that item", picked() === "item:R one", picked());
    await let_(); await free();
    await pulled(leftX, two.top + 3, cols[1].left + 90, two.bottom - 3);
    ok("across both columns, one line high: the item of each that stands there", picked() === "item:L two|item:R two", picked());
    await let_(); await free();
    const c1 = box("C one"), callout = own("C one").closest(".callout, blockquote").getBoundingClientRect();
    await pulled(rightX, c1.top + 3, cols[1].right - 60, c1.bottom - 3);
    const inCallout = picked();
    ok("an item of a list in a callout in a column: the callout, as a callout outside columns", /^(callout|quote|blockquote):/.test(inCallout) && !inCallout.includes("|"), inCallout);
    await let_(); await free();
    await pulled(rightX, r2.top + 3, cols[1].right - 60, callout.top + 12);
    ok("from an item to the callout under it: that item and the callout", /^item:R two\|(callout|quote|blockquote):/.test(picked()), picked());
    await let_(); await free();
    const row = view.dom.querySelector(".cols").getBoundingClientRect();
    await pulled(leftX, row.top + 3, pm.right - 30, row.bottom - 3);
    ok("everything in both columns: the row itself", picked().startsWith("row:"), picked());
    await let_(); await free();

    // --- the handle of an item in a column, and Shift
    at("move", two.left + 40, two.top + two.height / 2); await sleep(420);
    const h = document.querySelector(".blk-h");
    { const g = h.getBoundingClientRect();
      at("move", g.left + 9, g.top + 9); await sleep(140); at("down", g.left + 9, g.top + 9); await sleep(50); at("up", g.left + 9, g.top + 9); await sleep(280); }
    ok("a click on the handle of an item in a column: that item", picked() === "item:L two", [picked(), h.hasAttribute("data-on")]);
    key("ArrowDown", { shiftKey: true }); await sleep(80);
    ok("Shift+↓: the next item with it", picked() === "item:L two|item:L three", picked());
    key("ArrowUp", { shiftKey: true }); await sleep(80);
    A.blocks.select(view, item("L one").pmViewDesc.posBefore, true); await sleep(80);
    ok("Shift and the handle of another item of the list: from the one to the other", picked() === "item:L one|item:L two", picked());
    A.blocks.select(view, item("L two").pmViewDesc.posBefore, false);
    A.blocks.select(view, item("R two").pmViewDesc.posBefore, true); await sleep(80);
    ok("Shift and the handle of an item in the other column: no block twice, and none that holds another", (() => { const P = A.blocks.picked(view.state); return P.length > 1 && P.some((x) => x.node.textContent.trim() === "R two" || x.node.textContent.includes("R two")) && !P.some((x) => P.some((y) => x.pos < y.pos && y.pos < x.pos + x.node.nodeSize)); })(), picked());
    key("Escape"); await sleep(80);
    await free();
    ok("nothing of the note was changed", md() === original && picked() === "");
    await sleep(300);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("colsel", o);
})();
