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
    localStorage.setItem("mdview:board-tools:tray", JSON.stringify({ edge: "bottom", mini: null })); // (the tray at the foot, where this pulls it from)
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
    const stroke = async (pts, more = {}) => { ev("pointerdown", ...pts[0], more); for (const p of pts.slice(1)) { ev("pointermove", ...p, more); await sleep(8); } ev("pointerup", ...pts[pts.length - 1], more); await sleep(60); };
    const wave = (x0, y0, n = 30) => Array.from({ length: n }, (_v, i) => [x0 + i * 8, y0 + Math.sin(i / 3) * 30]);
    ok("a board opens with the lasso in hand: no tray", st().kind === "lasso" && getComputedStyle(el().querySelector(".bd-palette")).pointerEvents === "none" && el().querySelector('[data-kind="lasso"]').getAttribute("aria-checked") === "true", st().kind);
    el().querySelector('[data-kind="pen"]').click();
    ok("the pens, chosen in the bar at the top: their tray", st().kind === "pen" && st().mode === "draw" && getComputedStyle(el().querySelector(".bd-palette")).pointerEvents !== "none" && el().querySelectorAll(".bd-palette .bd-tool[data-tool]").length === 4, st().kind);
    await stroke(wave(200, 200));
    ok("a stroke drawn with the pen is on the board", st().items === 1 && st().undo === 1 && st().dirty, st());
    const inked = () => { const c = el().querySelector(".bd-ink"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; };
    const one = inked();
    ok("… and drawn", one > 300, one);
    key("z", { ctrlKey: true });
    ok("Ctrl+Z takes it back", st().items === 0 && st().redo === 1 && inked() === 0, [st(), inked()]);
    key("z", { ctrlKey: true, shiftKey: true });
    ok("Ctrl+Shift+Z brings it back", st().items === 1 && inked() === one, [st(), inked()]);
    key("f");
    ok("the pens' tray: three colours at hand", el().querySelectorAll(".bd-wells .bd-well").length === 3, el().querySelector(".bd-wells").innerHTML.slice(0, 200));
    el().querySelector('.bd-well[data-ink="#1f6fe5"]').click();
    await stroke(wave(200, 320));
    ok("F: the fineliner, in the blue chosen from the wells", st().items === 2 && st().tool === "mono" && st().ink === "#1f6fe5", st());
    // the colour in use, pressed again: the colours, and the one chosen there takes its place among the three
    el().querySelector('.bd-well[data-ink="#1f6fe5"]').click();
    await sleep(300);
    ok("the colour in use, pressed again: all the colours, in a small window", st().options && el().querySelector(".bd-pop").dataset.what === "hues" && el().querySelectorAll(".bd-pop .bd-well").length === 7, el().querySelector(".bd-pop").innerHTML.slice(0, 120));
    el().querySelector('.bd-pop [data-ink="#2fa84f"]').click();
    ok("one chosen there: the pen's colour, and one of the three from now on", st().tools.mono.c === "#2fa84f" && !st().options && [...el().querySelectorAll(".bd-wells .bd-well")].map((b) => b.dataset.ink).join() === "auto,#2fa84f,#e5372c", st().tools.mono);
    key("p");
    ok("… of this pen only: another pen has its own three", [...el().querySelectorAll(".bd-wells .bd-well")].map((b) => b.dataset.ink).join() === "auto,#1f6fe5,#e5372c", [...el().querySelectorAll(".bd-wells .bd-well")].map((b) => b.dataset.ink));
    key("f");
    el().querySelector('.bd-well[data-ink="#2fa84f"]').click(); await sleep(200);
    el().querySelector('.bd-pop [data-ink="#1f6fe5"]').click();
    key("e");
    await stroke([[150, 320], [260, 320], [300, 330]]);
    ok("E: the eraser takes the stroke it touches, and only that", st().items === 1 && st().tool === "eraser", st());
    key("z", { ctrlKey: true });
    ok("… undone: both are there", st().items === 2, st());

    // ---- the palette: marker, a tool's options, a stroke made clean, parts erased, the lasso
    const tool = (t) => el().querySelector(`.bd-tool[data-tool="${t}"]`);
    key("m");
    await stroke(wave(520, 200, 14));
    ok("M: the marker — see-through, in its own colour", st().items === 3 && st().kinds[2].startsWith("marker:") && st().ink === "#f2b90f" && tool("marker").getAttribute("aria-checked") === "true", st());
    tool("marker").click();
    await sleep(350);
    const pop = el().querySelector(".bd-pop");
    ok("the pen in hand, clicked again: how broad and how see-through it is, over it", st().options && pop.querySelectorAll(".bd-width").length === 5 && !!pop.querySelector("input[type=range]") && pop.getBoundingClientRect().bottom <= tool("marker").getBoundingClientRect().top + 30, [st().options, pop.innerHTML.slice(0, 120)]);
    pop.querySelector('.bd-width[data-w="28"]').click();
    const range = pop.ownerDocument.querySelector("#board .bd-pop input[type=range]");
    range.value = "60"; range.dispatchEvent(new Event("input", { bubbles: true }));
    ok("a width and an opacity chosen there are the tool's", st().tools.marker.w === 28 && st().tools.marker.o === 0.6 && st().options, st().tools.marker);
    key("Escape");
    ok("Esc shuts the options, not the board", !st().options && B().shown, st());
    // a hand that rests at the end: the stroke is made clean
    key("p");
    const rest = async (pts, ms = 750) => { ev("pointerdown", ...pts[0]); for (const p of pts.slice(1)) { ev("pointermove", ...p); await sleep(6); } await sleep(ms); ev("pointerup", ...pts[pts.length - 1]); await sleep(60); };
    await rest(Array.from({ length: 30 }, (_v, i) => [520 + i * 7, 330 + Math.sin(i * 1.7) * 1.5]));
    ok("a line drawn and the hand resting: it is straight, two points", st().items === 4 && st().kinds[3] === "pen!:2", st().kinds);
    await rest(Array.from({ length: 60 }, (_v, i) => [620 + Math.cos((i / 57) * 2 * Math.PI) * 45 + Math.sin(i * 2.1), 460 + Math.sin((i / 57) * 2 * Math.PI) * 45]));
    ok("a ring drawn and the hand resting: a circle", st().items === 5 && st().kinds[4] === "pen:65", st().kinds);
    await stroke(Array.from({ length: 30 }, (_v, i) => [200 + i * 7, 460 + Math.sin(i * 1.7) * 1.5]));
    ok("without the rest a stroke stays as drawn", st().items === 6 && !st().kinds[5].includes("!") && st().kinds[5] !== "pen:2", st().kinds);
    // the eraser set to parts: the straight line is cut where the eraser crosses it
    key("e");
    ok("E: the eraser's tray — what it takes, how large it is; no pens, no colours", st().kind === "eraser" && el().querySelectorAll(".bd-sizes .bd-width").length === 5 && !el().querySelector(".bd-tools").offsetWidth && !el().querySelector(".bd-wells").offsetWidth, st().kind);
    el().querySelector('.bd-palette [data-mode="pixel"]').click();
    await stroke([[620, 300], [620, 330], [620, 360]]);
    ok("the eraser set to parts cuts the line in two", st().items === 7 && st().kinds.filter((k) => k === "pen!:2").length === 2 && st().tools.eraser.mode === "pixel", st().kinds);
    key("z", { ctrlKey: true });
    ok("… one step back: the line is whole", st().items === 6 && st().kinds.filter((k) => k === "pen!:2").length === 1, st().kinds);
    el().querySelector('.bd-palette [data-mode="object"]').click();
    // the lasso: a pen draws a loop around what it wants
    key("l");
    await stroke([[180, 150], [460, 150], [460, 250], [180, 250], [180, 152]].flatMap((c, i, a) => (i ? Array.from({ length: 10 }, (_v, k) => [a[i - 1][0] + ((c[0] - a[i - 1][0]) * (k + 1)) / 10, a[i - 1][1] + ((c[1] - a[i - 1][1]) * (k + 1)) / 10]) : [c])), { pointerType: "pen" });
    const frame = el().querySelector(".bd-pick");
    ok("L: a pen's loop around a stroke chooses it — a frame, and a small bar beside it", st().kind === "lasso" && st().chosen === 1 && !frame.hidden && frame.dataset.kind === "ink" && !el().querySelector(".bd-fbar").hidden && st().items === 6, st());
    const box0 = st().chosenBox;
    await stroke([[300, 200], [300, 190], [300, 170], [300, 160]], { altKey: true });
    ok("pulled from inside its frame, it moves", st().chosen === 1 && st().chosenBox[1] === box0[1] - 40 && st().chosenBox[0] === box0[0], [box0, st().chosenBox]);
    key("z", { ctrlKey: true });
    ok("… and back with one step", st().chosenBox[1] === box0[1], [box0, st().chosenBox]);
    const fr = frame.getBoundingClientRect();
    await stroke([[fr.right, fr.bottom], [fr.right + 20, fr.bottom + 6], [fr.right + 60, fr.bottom + 16]]);
    ok("pulled at a corner, it grows from the opposite one", st().chosenBox[2] - st().chosenBox[0] > (box0[2] - box0[0]) * 1.15 && Math.abs(st().chosenBox[0] - box0[0]) <= 2 && Math.abs(st().chosenBox[1] - box0[1]) <= 2, [box0, st().chosenBox]);
    key("z", { ctrlKey: true });
    el().querySelector('.bd-fbar [data-f="ink"]').click();
    await sleep(200);
    el().querySelector('.bd-fpop [data-ic="#e5372c"]').click();
    ok("a colour chosen in its bar is the stroke's, not the pen's", st().inks[0] === "#e5372c" && st().tools.pen.c === "auto" && st().kind === "lasso", st().inks);
    key("d", { ctrlKey: true });
    ok("Ctrl+D: a copy beside it, chosen in its place", st().items === 7 && st().chosen === 1 && st().chosenBox[0] === box0[0] + 16, st());
    key("Delete");
    ok("Delete takes what is chosen", st().items === 6 && st().chosen === 0 && frame.hidden, st());
    await stroke([[200, 320], [200, 321]]);
    ok("a tap on a stroke chooses that one", st().chosen === 1 && st().inks[1] === "#1f6fe5", st());
    key("Escape");
    ok("Esc lets go of it, the board stays", st().chosen === 0 && B().shown, st());
    key("p");
    out("palette", {});
    await sleep(500);
    const count = st().items;

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
    ok("opened again from its block: every stroke is there", await until(() => st() && el().hasAttribute("data-ready")) && st().items === count, [count, st()]);
    key("Escape");
    await until(() => el().hidden, 2000);
    MdView.setMode("read");
    await until(() => document.body.dataset.view !== "active", 2000);
    await sleep(400);
    const readImg = document.querySelector("#content p.board-block img");
    ok("the reading view shows the block", !!readImg, document.getElementById("content").innerHTML.slice(-200));
    readImg && readImg.click();
    ok("… and a click opens the board there too", await until(() => st() && el().hasAttribute("data-ready")) && st().items === count, [count, st()]);
    key("p");
    await stroke(wave(200, 440, 12));
    ok("drawn on from the reading view", st().items === count + 1, st());
    o.strokes = count + 1;
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
