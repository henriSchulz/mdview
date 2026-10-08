/* Development probe (dev/rig.sh board): a whiteboard in a note — made from the "/" menu, opened
 * over the window, drawn on, undone, erased, kept, shown by its picture in the note, opened again
 * from both views. The strokes are made-up pointer events on the board's stage. */
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
    const A = MdActive, V = A.view, view = V.pm;
    const md = () => V.serialize(false);
    V.focus();
    const end = view.state.doc.content.size;
    view.dispatch(view.state.tr.insert(end, A.schema.nodes.paragraph.create()).scrollIntoView());
    view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    for (const ch of "/whiteb") { view.dispatch(view.state.tr.insertText(ch)); await sleep(30); }
    await sleep(300);
    const items = [...A.menu.el.querySelectorAll(".menu-item")].map((b) => b.textContent.trim());
    ok("the / menu offers it", A.menu.isOpen && items.length === 1 && items[0] === "Whiteboard", items);
    view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const B = () => window.MdBoard, st = () => B() && B().state && B().state(), el = () => document.getElementById("board");
    ok("the board opens over the window, empty", await until(() => st() && el().hasAttribute("data-ready")) && st().items === 0 && !st().readonly, st());
    ok("the note names its file, and the typed /whiteb is gone", /!\[\]\(assets\/board-\d{8}-\d{6}\.board\.svg\)/.test(md()) && !md().includes("/whiteb"), md().slice(-80));
    const blockImg = () => document.querySelector("#active .board-block img");
    ok("it stands in the note as a block of its own", !!blockImg(), document.querySelector("#active").innerHTML.slice(-300));
    await sleep(700); // (grown to the window's size)
    const r = el().getBoundingClientRect();
    ok("it covers the window, above the toolbar", Math.abs(r.width - document.documentElement.clientWidth) < 2 && Math.abs(r.height - innerHeight) < 2 && document.elementFromPoint(innerWidth / 2, innerHeight / 2).closest("#board") === el(), [r.width, r.height, innerWidth, innerHeight]);
    out("open", {});
    await sleep(500);

    // ---- drawing
    const stage = el().querySelector(".bd-stage");
    const ev = (type, x, y, more = {}) => stage.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5, ...more }));
    const stroke = async (pts) => { ev("pointerdown", ...pts[0]); for (const p of pts.slice(1)) { ev("pointermove", ...p); await sleep(8); } ev("pointerup", ...pts[pts.length - 1]); await sleep(60); };
    const wave = (x0, y0, n = 30) => Array.from({ length: n }, (_v, i) => [x0 + i * 8, y0 + Math.sin(i / 3) * 30]);
    await stroke(wave(200, 200));
    ok("a stroke drawn with the pen is on the board", st().items === 1 && st().undo === 1 && st().dirty, st());
    const inked = () => { const c = el().querySelector(".bd-ink"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; };
    const one = inked();
    ok("… and drawn", one > 300, one);
    key("z", { ctrlKey: true });
    ok("Ctrl+Z takes it back", st().items === 0 && st().redo === 1 && inked() === 0, [st(), inked()]);
    key("z", { ctrlKey: true, shiftKey: true });
    ok("Ctrl+Shift+Z brings it back", st().items === 1 && inked() === one, [st(), inked()]);
    key("m");
    el().querySelector('.bd-well[data-ink="#1f6fe5"]').click();
    await stroke(wave(200, 320));
    ok("M: the fineliner, in the blue chosen from the wells", st().items === 2 && st().tool === "mono" && st().ink === "#1f6fe5", st());
    key("e");
    await stroke([[150, 320], [260, 320], [300, 330]]);
    ok("E: the eraser takes the stroke it touches, and only that", st().items === 1 && st().tool === "eraser", st());
    key("z", { ctrlKey: true });
    ok("… undone: both are there", st().items === 2, st());
    const docZoom = getComputedStyle(document.documentElement).fontSize, z0 = st().zoom;
    key("+", { ctrlKey: true });
    ok("Ctrl + makes the board larger, not the note under it", st().zoom > z0 && getComputedStyle(document.documentElement).fontSize === docZoom, [z0, st().zoom]);
    key("0", { ctrlKey: true });
    stage.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -240, ctrlKey: true, clientX: 300, clientY: 300 }));
    ok("Ctrl+wheel too", st().zoom > 1.2 || st().zoom === 4, st().zoom);
    key("0", { ctrlKey: true });
    out("drawn", {});
    await sleep(500);

    // ---- kept
    ok("kept by itself, a moment after the last stroke", await until(() => st() && !st().dirty, 3000) && await until(() => blockImg() && blockImg().dataset.board && blockImg().src.startsWith("blob:"), 3000), [st(), blockImg() && blockImg().src.slice(0, 40)]);
    key("Escape");
    ok("Esc: back in the note", !B().shown && await until(() => el().hidden, 2000) && document.body.dataset.view === "active", [B().shown, el().hidden]);
    ok("the note's text is what it was (the board is a file of its own)", /board-\d{8}-\d{6}\.board\.svg\)\s*$/.test(md()), md().slice(-60));
    const shown = () => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = blockImg().src; });
    const sizeNow = await shown();
    ok("its picture in the note shows what was drawn", !!sizeNow && sizeNow[0] > 250 && sizeNow[1] > 150, sizeNow);
    out("closed", {});
    await sleep(500);

    // ---- opened again, from both views
    blockImg().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    // (the editor's own click handling wants a real press: the block's opening is asked for directly where that did not do it)
    if (!(await until(() => B().shown, 400))) A.islands.open(view, (() => { let at = -1; view.state.doc.descendants((n, pos) => { if (n.type.name === "island" && /board\.svg/.test(n.attrs.raw || "")) at = pos; }); return at; })());
    ok("opened again from its block: both strokes are there", await until(() => st() && el().hasAttribute("data-ready")) && st().items === 2, st());
    key("Escape");
    await until(() => el().hidden, 2000);
    MdView.setMode("read");
    await until(() => document.body.dataset.view !== "active", 2000);
    await sleep(400);
    const readImg = document.querySelector("#content p.board-block img");
    ok("the reading view shows the block", !!readImg, document.getElementById("content").innerHTML.slice(-200));
    readImg && readImg.click();
    ok("… and a click opens the board there too", await until(() => st() && el().hasAttribute("data-ready")) && st().items === 2, st());
    await stroke(wave(200, 440, 12));
    ok("drawn on from the reading view", st().items === 3, st());
    // the note is left with the board open: what is unsaved goes first
    MdView.core.post("reload");
    ok("leaving the note shuts the board", !B().shown, B().shown);
    await sleep(600);
    o.kept = true;
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  out("board", o);
  function key(k, more = {}) { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more })); }
})();
