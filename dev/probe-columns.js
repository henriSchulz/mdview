/* Development probe (dev/rig.sh columns): columns in the active mode — made from the / menu's
 * entries, typed in, their gap pulled (the real pointer), blocks dragged beside a block and
 * beside a column, a column emptied by a drag going away. */
(async () => {
  const out = (name, x) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const post = (type, data = {}) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready; await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, view = A.view.pm, { TextSelection } = PM.state;
    const md = () => A.view.serialize(false);
    const at = (text) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + text.length; }); return f; };
    const caret = (text) => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at(text)))); view.focus(); };
    const entry = (key, n) => A.slash.entries(view).find((e) => e && e.key === "slash.columns").items.find((e) => e && e.key === key && (n == null || e.n === n));
    const para = (text) => [...view.dom.querySelectorAll("p")].find((p) => p.textContent.startsWith(text));
    const shape = () => { const s = []; view.state.doc.forEach((n) => s.push(n.type.name === "columns" ? "(" + n.content.content.map((c) => c.content.content.map((b) => b.textContent.split(" ")[0] || "-").join("+")).join(" | ") + ")" : n.textContent.split(" ")[0])); return s.join(" "); };
    const undo = () => view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    const original = md();
    A.view.focus();

    // --- made of a block
    caret("Alpha");
    entry("columns.n", 2).act(view);
    await sleep(200);
    let cols = [...view.dom.querySelectorAll(".cols > .col")];
    ok("2 Columns: the block is the first of two, side by side", shape() === "Columns (Alpha | -) Beta Gamma Delta" && cols.length === 2 && Math.abs(cols[0].getBoundingClientRect().top - cols[1].getBoundingClientRect().top) < 1 && cols[1].getBoundingClientRect().left > cols[0].getBoundingClientRect().right, shape());
    ok("… alike in width, the caret still in its text", Math.abs(cols[0].getBoundingClientRect().width - cols[1].getBoundingClientRect().width) < 1 && view.state.selection.$from.parent.textContent.startsWith("Alpha"));
    ok("a column with nothing in it shows where it is", getComputedStyle(cols[1]).backgroundColor !== getComputedStyle(cols[0]).backgroundColor, getComputedStyle(cols[1]).backgroundColor);
    view.dispatch(view.state.tr.setSelection(PM.state.Selection.near(view.state.doc.resolve(view.posAtDOM(cols[1], 0)), 1)));
    view.dispatch(view.state.tr.insertText("Right side."));
    await sleep(100);
    ok("typed into the second", md().includes("<!-- columns -->\n\nAlpha paragraph.\n\n<!-- column -->\n\nRight side.\n\n<!-- /columns -->"), md());

    // --- the gap is pulled (the real pointer)
    cols = [...view.dom.querySelectorAll(".cols > .col")];
    const a = cols[0].getBoundingClientRect(), b = cols[1].getBoundingClientRect(), gx = (a.right + b.left) / 2, gy = a.top + 8;
    const grip = document.querySelector(".col-grip");
    post("probe-pointer", { kind: "move", x: gx, y: gy }); await sleep(250);
    ok("the pointer in the gap: a grip there, as tall as the row", grip.hasAttribute("data-on") && Math.abs(grip.getBoundingClientRect().left + 6 - gx) < 2, [grip.hasAttribute("data-on"), grip.getBoundingClientRect().left, gx]);
    post("probe-pointer", { kind: "down", x: gx, y: gy }); await sleep(80);
    post("probe-pointer", { kind: "move", x: gx + 40, y: gy, held: true }); await sleep(80);
    post("probe-pointer", { kind: "move", x: gx + 90, y: gy, held: true }); await sleep(150);
    cols = [...view.dom.querySelectorAll(".cols > .col")];
    const wa = cols[0].getBoundingClientRect().width, wb = cols[1].getBoundingClientRect().width;
    ok("pulled: the columns follow at once, the file not yet", wa > a.width + 70 && wb < b.width - 70 && !/columns \d/.test(md()), [wa, a.width, wb, b.width]);
    post("probe-pointer", { kind: "up", x: gx + 90, y: gy }); await sleep(250);
    const m = /<!-- columns ([\d.]+):([\d.]+) -->/.exec(md());
    ok("let go: the widths are in the file, as shares of a hundred", !!m && Math.abs(+m[1] + +m[2] - 100) < 0.11 && +m[1] > 55, md().slice(0, 60));
    ok("… and the columns stay exactly as wide", Math.abs([...view.dom.querySelectorAll(".cols > .col")][0].getBoundingClientRect().width - wa) < 1, [[...view.dom.querySelectorAll(".cols > .col")][0].getBoundingClientRect().width, wa]);
    // pressed and let go where it was: nothing changes — the widths least of all
    post("probe-pointer", { kind: "move", x: gx + 90, y: gy }); await sleep(250);
    post("probe-pointer", { kind: "down", x: gx + 90, y: gy }); await sleep(80);
    post("probe-pointer", { kind: "move", x: gx + 91, y: gy, held: true }); await sleep(80);
    post("probe-pointer", { kind: "up", x: gx + 91, y: gy }); await sleep(250);
    ok("the grip pressed and hardly moved: the columns keep their widths", Math.abs([...view.dom.querySelectorAll(".cols > .col")][0].getBoundingClientRect().width - wa) < 3 && /<!-- columns [\d.]+:[\d.]+ -->/.test(md()), [[...view.dom.querySelectorAll(".cols > .col")][0].getBoundingClientRect().width, wa]);
    post("probe-pointer", { kind: "move", x: gx + 90, y: gy }); await sleep(250);
    grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await sleep(200);
    ok("a double click on the grip makes them alike again", md().includes("<!-- columns -->") && Math.abs([...view.dom.querySelectorAll(".cols > .col")][0].getBoundingClientRect().width - a.width) < 2, md().slice(0, 60));
    post("probe-pointer", { kind: "move", x: gx + 300, y: gy + 300 }); await sleep(300);

    // --- blocks dragged to the side (drag events made up, sent to what lies under the pointer)
    const h = document.querySelector(".blk-h"), line = document.querySelector(".blk-line");
    const drag = async (what, x, y) => {
      para(what).dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: para(what).getBoundingClientRect().left + 20, clientY: para(what).getBoundingClientRect().top + 6 }));
      await sleep(150);
      const dt = new DataTransfer(), hr = h.getBoundingClientRect();
      h.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, clientX: hr.left + 9, clientY: hr.top + 9, dataTransfer: dt }));
      (document.elementFromPoint(x, y) || document.body).dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      const lr = line.getBoundingClientRect(), dg = A.blocks.dragging(), shown = { on: line.hasAttribute("data-on"), w: lr.width, h: lr.height, x: lr.left, over: A.blocks.over() && A.blocks.over().textContent.slice(0, 8), drag: dg && [dg.from, dg.to], under: (document.elementFromPoint(x, y) || {}).tagName };
      (document.elementFromPoint(x, y) || document.body).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      h.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
      await sleep(250);
      return shown;
    };
    let t = para("Delta").getBoundingClientRect();
    let s = await drag("Gamma", t.right - 12, t.top + 6);
    ok("a block dragged to the right end of another: the two are a row", shape() === "Columns (Alpha | Right) Beta (Delta | Gamma)", shape());
    ok("… a line down its side showed where", s.on && s.h > 12 && s.w <= 3 && s.x > t.right, s);
    t = para("Beta").getBoundingClientRect();
    s = await drag("Gamma", view.dom.getBoundingClientRect().left + 8, t.top + 6);
    ok("to the very left of a block: before it — and the row it left is no row with one column", shape() === "Columns (Alpha | Right) (Gamma | Beta) Delta", shape());
    cols = [...view.dom.querySelectorAll(".cols")][0].querySelectorAll(".col");
    t = cols[1].getBoundingClientRect();
    s = await drag("Delta", t.right - 6, t.top + 6);
    ok("to the edge of a column: a new column of that row", shape() === "Columns (Alpha | Right | Delta) (Gamma | Beta)", shape());
    t = para("Alpha").getBoundingClientRect();
    s = await drag("Delta", t.left + 60, t.bottom - 2);
    ok("into a column, below a block of it: the column it left goes", shape() === "Columns (Alpha+Delta | Right) (Gamma | Beta)" && s.w > 40, [shape(), s]);
    para("Delta").dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: para("Delta").getBoundingClientRect().left + 20, clientY: para("Delta").getBoundingClientRect().top + 6 }));
    await sleep(200);
    ok("a block in a column has its own handle", h.hasAttribute("data-on") && A.blocks.over() === para("Delta") && h.getBoundingClientRect().height < 30, A.blocks.over() && A.blocks.over().textContent);

    // --- in a column: the / menu's commands
    caret("Right side.");
    ok("in a column the menu has the column's commands", !!entry("columns.addLeft") && !!entry("columns.unwrap") && !entry("columns.n", 2));
    entry("columns.moveLeft").act(view);
    await sleep(150);
    ok("Move Column Left", shape() === "Columns (Right | Alpha+Delta) (Gamma | Beta)", shape());
    entry("columns.unwrap").act(view);
    await sleep(150);
    ok("Unwrap: one under the other again", shape() === "Columns Right Alpha Delta (Gamma | Beta)", shape());

    // --- blocks picked with Ctrl held, and a rectangle pulled inside a row (the real pointer)
    {
      const picked = () => A.blocks.picked(view.state).map((x) => x.node.textContent.split(" ")[0]).join("|");
      const mid = (text) => { const r = para(text).getBoundingClientRect(); return [r.left + 30, r.top + r.height / 2]; };
      const click = async (text, ctrl) => { const [x, y] = mid(text); post("probe-pointer", { kind: "move", x, y, ctrl }); await sleep(80); post("probe-pointer", { kind: "down", x, y, ctrl }); await sleep(50); post("probe-pointer", { kind: "up", x, y, ctrl }); await sleep(220); };
      const dragTo = (x, y) => post("probe-pointer", { kind: "move", x, y, held: true });
      await click("Right", true);
      ok("Ctrl+click on a block selects it", picked() === "Right" && view.hasFocus(), picked());
      await click("Delta", true);
      await click("Gamma", true);
      ok("… and further ones join it, wherever they stand (also in a column)", picked() === "Right|Delta|Gamma", picked());
      ok("the text between them is not selected", String(getSelection()).length === 0 || view.dom.classList.contains("has-blocksel"));
      const hd = document.querySelector(".blk-h");
      post("probe-pointer", { kind: "move", x: mid("Delta")[0] + 40, y: mid("Delta")[1] }); await sleep(300);
      ok("over one of them: its handle, which takes them all", hd.hasAttribute("data-on") && hd.hasAttribute("data-group") && hd.hasAttribute("data-apart") && hd.getBoundingClientRect().height < 30 && (A.blocks.groupEls(view.state) || []).length === 3, [hd.hasAttribute("data-group"), hd.getBoundingClientRect().height]);
      await click("Delta", true);
      ok("Ctrl+click on one of them lets it go", picked() === "Right|Gamma", picked());
      await click("Alpha", false);
      ok("a plain click puts the caret there and lets them all go", picked() === "" && view.state.selection.$from.parent.textContent.startsWith("Alpha"), picked());

      // a rectangle from beside the row into one of its columns
      const row = view.dom.querySelector(".cols").getBoundingClientRect(), g = para("Gamma").getBoundingClientRect(), bb = para("Beta").getBoundingClientRect(), pmr = view.dom.getBoundingClientRect();
      post("probe-pointer", { kind: "down", x: pmr.right + 50, y: bb.top + 2 }); await sleep(60);
      dragTo(pmr.right + 30, bb.top + 6); await sleep(60);
      dragTo(bb.left + 40, bb.bottom - 3); await sleep(150);
      ok("a rectangle pulled into a row takes the blocks of the column it reaches", picked() === "Beta", picked());
      dragTo(g.left + 40, g.bottom - 3); await sleep(150);
      ok("… pulled on over the next column, all the row holds: the row itself", A.blocks.picked(view.state).map((x) => x.node.type.name).join() === "columns" && !!view.dom.querySelector(".cols.blk-sel"), picked());
      const al = para("Alpha").getBoundingClientRect();
      dragTo(g.left + 40, al.top + 4); await sleep(150);
      ok("… pulled on over other blocks: those, and the row as a whole", picked().split("|").length >= 3 && !!view.dom.querySelector(".cols.blk-sel"), picked());
      post("probe-pointer", { kind: "up", x: g.left + 40, y: al.top + 4 }); await sleep(250);
      await click("Alpha", false);

      // whole columns picked and dragged stay columns
      {
        for (const t of ["Gamma", "Beta"]) A.blocks.toggle(view, view.posAtDOM(para(t), 0) - 1);
        ok("all a row holds picked: the row itself is what is selected", A.blocks.picked(view.state).map((x) => x.node.type.name).join() === "columns", A.blocks.picked(view.state).map((x) => x.node.type.name));
        const h2 = document.querySelector(".blk-h"), dt = new DataTransfer(), first = para("Right").getBoundingClientRect();
        para("Gamma").dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: para("Gamma").getBoundingClientRect().left + 20, clientY: para("Gamma").getBoundingClientRect().top + 6 }));
        await sleep(200);
        const hr = h2.getBoundingClientRect();
        h2.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, clientX: hr.left + 9, clientY: hr.top + 9, dataTransfer: dt }));
        const x = first.left + 120, y = first.top + 2;
        (document.elementFromPoint(x, y) || document.body).dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
        (document.elementFromPoint(x, y) || document.body).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
        h2.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
        await sleep(250);
        ok("dragged above another block, it is still a row of columns", shape() === "Columns (Gamma | Beta) Right Alpha Delta", shape());
        undo(); await sleep(200);
        await click("Alpha", false);
      }
      // a rectangle begun between two blocks, where no text is
      const dl = para("Delta").getBoundingClientRect(), gapY = (al.bottom + dl.top) / 2;
      post("probe-pointer", { kind: "move", x: al.left + 200, y: gapY }); await sleep(80);
      post("probe-pointer", { kind: "down", x: al.left + 200, y: gapY }); await sleep(60);
      dragTo(al.left + 215, gapY + 8); await sleep(60);
      dragTo(al.left + 260, dl.bottom - 4); await sleep(150);
      ok("pressed between two blocks and pulled: a rectangle there too, taking blocks", document.querySelector(".blk-band").hasAttribute("data-on") && picked() === "Delta", [picked(), document.elementFromPoint(al.left + 200, gapY).className]);
      post("probe-pointer", { kind: "up", x: al.left + 260, y: dl.bottom - 4 }); await sleep(250);
      post("probe-pointer", { kind: "down", x: al.left + 200, y: gapY }); await sleep(60);
      post("probe-pointer", { kind: "up", x: al.left + 200, y: gapY }); await sleep(250);
      ok("a click between two blocks puts the caret into the text, as before", picked() === "" && view.state.selection.empty && view.hasFocus());
    }
    out("shot", {});
    await sleep(1500); // screenshot
    for (let i = 0; i < 30 && md() !== original; i++) undo();
    ok("all of it undone", md() === original, md().slice(0, 120));
    for (let i = 0; i < 4; i++) view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await sleep(1100);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("columns", o);
})();
