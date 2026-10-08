/* Development probe (dev/rig.sh board-items): what stands on a whiteboard beside the ink — shapes,
 * sticky notes, text boxes, lines — put there from the bar at the top, chosen, moved along guides,
 * pulled to size, turned, typed in, given their look from the bar beside them, aligned, grouped,
 * locked, copied; kept and read again. The pointer is made-up events on the board's stage. */
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
    const B = () => window.MdBoard, st = () => B() && B().state && B().state(), el = () => document.getElementById("board");
    ok("the board opens", await until(() => st() && el().hasAttribute("data-ready")), st());
    await sleep(700);
    const stage = el().querySelector(".bd-stage"), q = (s) => el().querySelector(s);
    const ev = (type, x, y, more = {}) => stage.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5, ...more }));
    const drag = async (pts, more = {}) => { ev("pointerdown", ...pts[0], more); for (const p of pts.slice(1)) { ev("pointermove", ...p, more); await sleep(8); } ev("pointerup", ...pts[pts.length - 1], more); await sleep(60); };
    const click = (x, y, more = {}) => drag([[x, y], [x, y]], more);
    const key = (k, more = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
    const at = (bx, by) => { const v = st().view; return [(bx - v.x) * v.z, (by - v.y) * v.z]; }; // the board's point on the screen
    const thing = (i) => st().things[i], midOf = (t) => (t.k === "line" ? [(t.p[0] + t.p[2]) / 2, (t.p[1] + t.p[3]) / 2] : [t.x + t.w / 2, t.y + t.h / 2]);
    const grip = (t) => at(t.x + 12, t.y + t.h - 12); // a place on it that nothing else lies over
    const steps = (a, b, n = 8) => Array.from({ length: n + 1 }, (_v, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    const type = async (text) => { document.execCommand("insertText", false, text); await sleep(80); };

    // ---- the tools put away: the pointer chooses
    key("v");
    await sleep(500);
    ok("V: the drawing tools are put away, the bar at the top stays", st().mode === "select" && getComputedStyle(q(".bd-palette")).opacity === "0" && !!q(".bd-insert").offsetWidth, [st().mode, getComputedStyle(q(".bd-palette")).opacity]);
    q('[data-do="shapes"]').click();
    await sleep(350);
    ok("Shape: a choice of them under its button", q(".bd-spop").hasAttribute("data-open") && q(".bd-spop").querySelectorAll(".bd-tile").length === 9, q(".bd-spop").innerHTML.slice(0, 80));
    q('.bd-spop [data-shape="rect"]').click();
    await sleep(200);
    ok("a rectangle stands in the middle of the view, chosen: its frame with dots, its bar beside it", st().things.length === 1 && thing(0).k === "shape" && st().picked.length === 1 && !q(".bd-pick").hidden && !q(".bd-fbar").hidden && q(".bd-fbar").querySelectorAll(".bd-btn").length === 6, [st().things, q(".bd-fbar").innerHTML.slice(0, 200)]);
    const drawn = el().querySelector(".bd-world .bd-item[data-k='shape'] path");
    ok("… and is drawn", !!drawn && drawn.getBoundingClientRect().width > 100 && getComputedStyle(drawn).fill === "rgb(31, 111, 229)", drawn && [drawn.getBoundingClientRect().width, getComputedStyle(drawn).fill]);
    out("shape", {});
    await sleep(400);

    // ---- moved, pulled to size, turned
    let was = thing(0);
    await drag(steps(at(...midOf(was)), at(midOf(was)[0] + 120, midOf(was)[1] - 60)));
    ok("pulled by its middle, it moves", thing(0).x === was.x + 120 && thing(0).y === was.y - 60, [was, thing(0)]);
    was = thing(0);
    await drag(steps(at(was.x + was.w, was.y + was.h), at(was.x + was.w + 60, was.y + was.h + 30)));
    ok("pulled at a corner's dot, it grows there and stays where it was at the opposite corner", thing(0).w === was.w + 60 && thing(0).h === was.h + 30 && thing(0).x === was.x && thing(0).y === was.y, [was, thing(0)]);
    was = thing(0);
    await drag(steps(at(was.x + was.w, was.y + was.h), at(was.x + was.w + 80, was.y + was.h + 10)), { shiftKey: true });
    ok("with Shift its proportions stay", Math.abs(thing(0).w / thing(0).h - was.w / was.h) < 0.01 && thing(0).w > was.w + 60, [was, thing(0)]);
    key("z", { ctrlKey: true });
    was = thing(0);
    const knob = at(midOf(was)[0], was.y - 26), c = at(...midOf(was));
    await drag(steps(knob, [c[0] + 100, c[1] - 58], 10));
    ok("pulled at the knob, it turns about its middle", Math.abs(thing(0).r - 60) < 2 && thing(0).x === was.x && thing(0).w === was.w, [was.r, thing(0).r]);
    await drag(steps(at(...midOf(was)), at(midOf(was)[0] + 30, midOf(was)[1])), {});
    ok("turned, it is still hit where it is, and moves", thing(0).x === was.x + 30 && Math.abs(thing(0).r - 60) < 2, thing(0));
    key("z", { ctrlKey: true }); key("z", { ctrlKey: true });
    ok("two steps back: where it was, upright", thing(0).r === 0 && thing(0).x === was.x, thing(0));

    // ---- its look, from the bar beside it
    q('.bd-fbar [data-f="fill"]').click();
    await sleep(350);
    ok("Fill: twelve colours and none", q(".bd-fpop").hasAttribute("data-open") && q(".bd-fpop").querySelectorAll(".bd-swatches .bd-well").length === 12 && !!q('.bd-fpop [data-fill="none"]'), q(".bd-fpop").innerHTML.slice(0, 100));
    q('.bd-fpop [data-fill="#e5372c"]').click();
    await sleep(100);
    ok("a colour chosen is the shape's, at once", thing(0).fill === "#e5372c" && getComputedStyle(drawn).fill === "rgb(229, 55, 44)" && q(".bd-fpop").hasAttribute("data-open"), [thing(0).fill, getComputedStyle(drawn).fill]);
    q('.bd-fbar [data-f="stroke"]').click();
    await sleep(350);
    q('.bd-fpop [data-stroke="auto"]').click(); q('.bd-fpop [data-sw="4"]').click();
    ok("Border: a colour and a width", thing(0).stroke.c === "auto" && thing(0).stroke.w === 4, thing(0).stroke);
    key("Escape");
    ok("Esc shuts the choices, the shape stays chosen", !q(".bd-fpop").hasAttribute("data-open") && st().picked.length === 1, st().picked);

    // ---- text: in a shape, on a note, in a box
    const m0 = at(...midOf(thing(0)));
    await click(...m0); await click(...m0);
    ok("clicked twice, a shape takes text", await until(() => st().editing === thing(0).id && document.activeElement.classList.contains("bd-t"), 1500), [st().editing, document.activeElement.className]);
    await type("Start");
    key("Escape");
    await sleep(100);
    ok("typed, and Esc: the text is the shape's, the board is still open", thing(0).text === "Start" && !st().editing && B().shown && st().picked.length === 1, thing(0));
    key("Escape");
    key("n");
    await sleep(150);
    ok("N: a sticky note, ready to be typed on", st().things.length === 2 && thing(1).k === "sticky" && st().editing === thing(1).id, st().things.map((t) => t.k));
    await type("Ask about the lab report");
    await click(40, innerHeight - 200);
    ok("a click beside it ends the typing", thing(1).text === "Ask about the lab report" && !st().editing, thing(1));
    key("t");
    await sleep(150);
    await type("A heading");
    q('[data-do="textbox"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await sleep(100);
    ok("T: a text box; it is as tall as its text", st().things.length === 3 && thing(2).k === "text" && thing(2).text === "A heading" && thing(2).h > 30 && thing(2).h < 60 && !st().editing, thing(2));
    key("t");
    await sleep(150);
    key("Escape");
    await sleep(100);
    ok("a text box left empty is none", st().things.length === 3, st().things.map((t) => t.k));
    await click(...at(...midOf(thing(2))));
    q('.bd-fbar [data-f="text"]').click();
    await sleep(300);
    q('.bd-fpop [data-size="1"]').click(); q('.bd-fpop [data-style="bold"]').click(); q('.bd-fpop [data-align="center"]').click();
    ok("Text: larger, bold, centred", thing(2).ts.size === 20 && thing(2).ts.bold === true && thing(2).ts.align === "center", thing(2).ts);
    key("Escape"); key("Escape");

    // ---- a line with an arrow
    q('[data-do="shapes"]').click(); await sleep(300);
    q('.bd-spop [data-line="arrow"]').click(); await sleep(150);
    ok("an arrow: a line with a head at its end, chosen by its two ends", st().things.length === 4 && thing(3).k === "line" && thing(3).ends.join() === "none,arrow" && q(".bd-pick").dataset.kind === "line", thing(3));
    was = thing(3);
    await drag(steps(at(was.p[2], was.p[3]), at(was.p[2] + 40, was.p[3] + 90)));
    ok("an end pulled goes with the hand, the other stays", thing(3).p[2] === was.p[2] + 40 && thing(3).p[3] === was.p[3] + 90 && thing(3).p[0] === was.p[0], [was.p, thing(3).p]);
    q('.bd-fbar [data-f="ends"]').click(); await sleep(300);
    q('.bd-fpop [data-end="0"]').click();
    ok("Line Ends: an arrow at the start too", thing(3).ends.join() === "arrow,arrow", thing(3).ends);
    key("Escape"); key("Escape");
    out("items", {});
    await sleep(400);

    // ---- guides: an edge meets an edge
    const shape = () => thing(0), note = () => thing(1);
    was = note();
    const want = shape().x - was.x; // the note's left edge onto the shape's
    await drag(steps(grip(was), [grip(was)[0] + want + 4, grip(was)[1] + 260], 12));
    // (4 pixels off where the edges meet — the shape's edge is its border's outer side, 2 pixels out)
    ok("moved to within a few pixels of another's edge, it rests on it", Math.abs(note().x - (shape().x - 2)) <= 1 && note().y !== was.y, [note().x, shape().x]);
    const rested = note().x;
    await sleep(450);
    await drag(steps(grip(note()), [grip(note())[0] + 3, grip(note())[1] + 20], 6), { altKey: true });
    ok("with Alt held nothing holds it", note().x === rested + 3, [note().x, rested]);

    // ---- several: a box pulled over them, aligned, grouped, in order, locked, copied
    key("a", { ctrlKey: true });
    ok("Ctrl+A chooses everything that stands on the board", st().picked.length === 4 && q(".bd-pick").dataset.kind === "many", st().picked);
    key("Escape");
    const far = st().things.flatMap((t) => (t.k === "line" ? [[t.p[0], t.p[1]], [t.p[2], t.p[3]]] : [[t.x, t.y], [t.x + t.w, t.y + t.h]]));
    const lo = at(Math.min(...far.map((p) => p[0])) - 30, Math.min(...far.map((p) => p[1])) - 30), hi = at(shape().x + shape().w + 10, shape().y + shape().h + 10);
    await drag(steps([Math.max(4, lo[0]), Math.max(60, lo[1])], hi, 10));
    ok("a box pulled from the bare board chooses what it touches", st().picked.includes(shape().id) && st().picked.length >= 2, [st().picked, st().things.map((t) => t.id)]);
    key("a", { ctrlKey: true });
    q('.bd-fbar [data-f="arrange"]').click(); await sleep(300);
    q('.bd-fpop [data-al="T"]').click();
    const tops = () => st().things.map((t) => (t.k === "line" ? Math.min(t.p[1], t.p[3]) - 12 : t.y));
    ok("Arrange › Top: every one at the top of them all", Math.max(...tops().slice(0, 3)) - Math.min(...tops().slice(0, 3)) <= 2.1, tops()); // (a border counts as part of its shape)
    key("g", { ctrlKey: true });
    key("Escape"); key("Escape");
    await click(...at(...midOf(shape())));
    ok("Ctrl+G: grouped, a click on one chooses them all", st().picked.length === 4 && st().things.every((t) => t.group), st().things.map((t) => t.group));
    was = st().things;
    await drag(steps(at(...midOf(shape())), at(midOf(shape())[0] + 50, midOf(shape())[1] + 40)), { altKey: true });
    ok("… and they move as one", thing(0).x === was[0].x + 50 && thing(1).y === was[1].y + 40 && thing(3).p[0] === was[3].p[0] + 50, [was[0].x, thing(0).x]);
    key("g", { ctrlKey: true, shiftKey: true });
    key("Escape");
    await sleep(450);
    await click(...grip(shape()));
    ok("Ctrl+Shift+G: apart again", st().picked.length === 1 && !st().things.some((t) => t.group), st().picked);
    B().pick([thing(0).id]);
    const firstId = thing(0).id;
    key("F", { ctrlKey: true, shiftKey: true });
    ok("Ctrl+Shift+F: to the front of the others", st().things[3].id === firstId, st().things.map((t) => t.id));
    key("B", { ctrlKey: true, shiftKey: true });
    ok("Ctrl+Shift+B: behind them", st().things[0].id === firstId, st().things.map((t) => t.id));
    key("l", { ctrlKey: true });
    was = thing(0);
    await drag(steps(grip(was), [grip(was)[0] + 70, grip(was)[1]]));
    B().pick([was.id]);
    key("Delete");
    ok("Ctrl+L: locked — it does not move and is not deleted; its bar offers only Unlock", thing(0).x === was.x && st().things.length === 4 && thing(0).lock === true && q(".bd-fbar").querySelectorAll(".bd-btn").length === 1, [thing(0), q(".bd-fbar").innerHTML.slice(0, 120)]);
    q('.bd-fbar [data-f="unlock"]').click();
    ok("Unlock", !thing(0).lock, thing(0));
    B().pick([thing(0).id]);
    key("c", { ctrlKey: true }); key("v", { ctrlKey: true });
    ok("Ctrl+C, Ctrl+V: a copy beside it, chosen", st().things.length === 5 && st().things[4].x === thing(0).x + 16 && st().picked[0] === st().things[4].id && st().things[4].text === "Start", st().things.map((t) => t.id));
    key("ArrowRight", { shiftKey: true });
    ok("the arrow keys nudge what is chosen (Shift: ten)", st().things[4].x === thing(0).x + 26, st().things[4].x);
    key("Delete");
    ok("Delete", st().things.length === 4 && st().picked.length === 0, st().things.length);
    out("arranged", {});
    await sleep(400);

    // ---- ink over it, kept, read again
    key("p");
    await sleep(400);
    ok("P: the tools come back, nothing is chosen", st().mode === "draw" && getComputedStyle(q(".bd-palette")).opacity === "1" && q(".bd-pick").hidden && q(".bd-fbar").hidden, st().mode);
    const sm = at(...midOf(shape()));
    await drag(steps([sm[0] - 60, sm[1] - 20], [sm[0] + 60, sm[1] + 20], 14));
    ok("a stroke over a shape is a stroke; the shape stays where it is", st().items === 1 && st().things.length === 4, [st().items, st().things.length]);
    const kept = JSON.stringify(st().things);
    ok("kept by itself", await until(() => st() && !st().dirty, 3000), st().dirty);
    key("Escape");
    await until(() => el().hidden, 2000);
    const img = document.querySelector("#active .board-block img");
    const size = await new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = img.src; });
    ok("the picture in the note shows it all", !!size && size[0] > 300 && size[1] > 200, size);
    out("closed", {});
    await sleep(400);
    MdActive.islands.open(MdActive.view.pm, (() => { let p = -1; MdActive.view.pm.state.doc.descendants((n, pos) => { if (n.type.name === "island" && /board\.svg/.test(n.attrs.raw || "")) p = pos; }); return p; })());
    ok("opened again: everything is there as it was left", await until(() => st() && el().hasAttribute("data-ready")) && JSON.stringify(st().things) === kept && st().items === 1, [kept.slice(0, 200), JSON.stringify(st().things).slice(0, 200)]);
    key("Escape");
    await until(() => el().hidden, 2000);
    MdView.core.post("reload");
    await sleep(500);
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  out("board-items", o);
})();
