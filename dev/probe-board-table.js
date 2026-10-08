/* Development probe (dev/rig.sh board-table): a table on a whiteboard — put there, typed in cell
 * by cell, grown by rows and columns, pulled to size, kept. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    MdActive.view.focus();
    MdActive.context.INSERT.board(MdActive.view.pm);
    const B = () => window.MdBoard, st = () => B() && B().state && B().state(), el = () => document.getElementById("board"), q = (s) => el().querySelector(s);
    ok("the board opens", await until(() => st() && el().hasAttribute("data-ready")), st());
    await sleep(700);
    const stage = q(".bd-stage");
    const ev = (type, x, y, more = {}) => stage.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5, ...more }));
    const drag = async (pts, more = {}) => { ev("pointerdown", ...pts[0], more); for (const p of pts.slice(1)) { ev("pointermove", ...p, more); await sleep(8); } ev("pointerup", ...pts[pts.length - 1], more); await sleep(60); };
    const key = (k, more = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
    const at = (bx, by) => { const v = st().view; return [(bx - v.x) * v.z, (by - v.y) * v.z]; };
    const steps = (a, b, n = 8) => Array.from({ length: n + 1 }, (_v, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    const type = async (text) => { document.execCommand("insertText", false, text); await sleep(80); };
    const table = () => st().things.find((t) => t.k === "table");
    q('[data-do="plus"]').click(); await sleep(250);
    ok("More to Add: a sticky note, a table, a link", st().menu === "plus" && q(".bd-vpop").querySelectorAll("[data-m]").length === 3, st().menu);
    q('.bd-vpop [data-m="table"]').click(); await sleep(200);
    ok("Table: three by three in the middle of the view, the first cell ready to be typed in", st().mode === "select" && table() && table().rows.length === 3 && table().cols.length === 3 && st().editing === table().id && document.activeElement.closest(".bd-cell")?.dataset.cell === "0,0", [st().things, st().editing]);
    await type("Day");
    key("Tab"); await sleep(120);
    ok("typed, and Tab: the text is the cell's, the next cell is being typed in", table().cells[0][0] === "Day" && document.activeElement.closest(".bd-cell")?.dataset.cell === "0,1" && st().editing === table().id, [table().cells, document.activeElement.className]);
    await type("Topic");
    key("Tab"); await type("Room");
    key("Tab"); await sleep(120);
    ok("Tab at a row's end: the first cell of the next row", document.activeElement.closest(".bd-cell")?.dataset.cell === "1,0", document.activeElement.closest(".bd-cell")?.dataset.cell);
    key("Tab", { shiftKey: true }); await sleep(120);
    ok("Shift+Tab: back", document.activeElement.closest(".bd-cell")?.dataset.cell === "0,2" && table().cells[0][2] === "Room", document.activeElement.closest(".bd-cell")?.dataset.cell);
    key("Tab"); key("Tab"); await sleep(120);
    const rowWas = table().rows[1];
    await type("Fourier series, and what they are good for when a signal has to be taken apart into its tones");
    ok("a long text in a cell: its row grows to hold it, the table with it", table().rows[1] > rowWas + 30 && table().h === table().rows.reduce((a, b) => a + b, 0) && table().cells[1][1].startsWith("Fourier"), table().rows);
    key("Escape"); await sleep(100);
    ok("Esc: typing is over, the table stays chosen", !st().editing && st().picked[0] === table().id && B().shown, st().editing);
    const head = el().querySelector('.bd-world .bd-cell[data-cell="0,0"]'), body = el().querySelector('.bd-world .bd-cell[data-cell="1,0"]');
    ok("its first row is its head", Number(getComputedStyle(head).fontWeight) >= 600 && Number(getComputedStyle(body).fontWeight) < 600, [getComputedStyle(head).fontWeight, getComputedStyle(body).fontWeight]);
    ok("no knob to turn a table: it stands upright", getComputedStyle(q(".bd-knob")).display === "none" && table().r === 0, getComputedStyle(q(".bd-knob")).display);
    out("typed", {});
    await sleep(400);
    // rows and columns
    q('.bd-fbar [data-f="table"]').click(); await sleep(300);
    ok("its bar has Table: rows, columns, text size, head row", q(".bd-fpop").hasAttribute("data-open") && !!q('.bd-fpop [data-trows="1"]') && !!q('.bd-fpop [data-tcols="1"]') && !!q('.bd-fpop [data-thead]'), q(".bd-fpop").innerHTML.slice(0, 200));
    let was = table();
    q('.bd-fpop [data-trows="1"]').click(); await sleep(60); q('.bd-fpop [data-tcols="1"]').click(); await sleep(60);
    ok("a row and a column more: at its end, empty, and it is that much larger", table().rows.length === 4 && table().cols.length === 4 && table().cells[3].join("") === "" && table().cells[0].join() === "Day,Topic,Room," && table().w === was.w + was.cols[2] && table().h === was.h + was.rows[2], table());
    q('.bd-fpop [data-tcols="-1"]').click(); await sleep(60);
    ok("a column less: the last one is gone", table().cols.length === 3 && table().cells.every((r) => r.length === 3), table().cols);
    q('.bd-fpop [data-thead]').click(); await sleep(60);
    ok("Header Row off: the first row is as the others", table().head === false && Number(getComputedStyle(el().querySelector('.bd-world .bd-cell[data-cell="0,0"]')).fontWeight) < 600, table().head);
    key("z", { ctrlKey: true });
    key("Escape");
    // pulled to size
    was = table();
    await drag(steps(at(was.x + was.w, was.y + was.h), at(was.x + was.w + 90, was.y + was.h)));
    ok("pulled at its corner: every column takes its share", Math.abs(table().w - (was.w + 90)) < 1.5 && table().cols.every((c, i) => Math.abs(c - was.cols[i] * (table().w / was.w)) < 0.2) && table().x === was.x, [was.cols, table().cols]);
    // a cell clicked twice
    const c21 = at(table().x + table().cols[0] + 20, table().y + table().rows[0] + table().rows[1] + 12);
    await drag([c21, c21]); await drag([c21, c21]);
    ok("a cell clicked twice is typed in", await until(() => document.activeElement.closest(".bd-cell")?.dataset.cell === "2,1", 1500), document.activeElement.closest(".bd-cell")?.dataset.cell);
    await type("x");
    key("Escape"); key("Escape");
    const kept = JSON.stringify(table());
    ok("kept by itself", await until(() => st() && !st().dirty, 3000), st().dirty);
    key("Escape");
    await until(() => el().hidden, 2000);
    out("closed", {});
    await sleep(300);
    MdActive.islands.open(MdActive.view.pm, (() => { let p = -1; MdActive.view.pm.state.doc.descendants((n, pos) => { if (n.type.name === "island" && /board\.svg/.test(n.attrs.raw || "")) p = pos; }); return p; })());
    ok("opened again: the table as it was left", await until(() => st() && el().hasAttribute("data-ready")) && JSON.stringify(table()) === kept, [kept.slice(0, 200), JSON.stringify(table()).slice(0, 200)]);
    key("Escape");
    await until(() => el().hidden, 2000);
    MdView.core.post("reload");
    await sleep(500);
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  out("board-table", o);
})();
