/* Development probe (dev/rig.sh board-scenes): the whiteboard's small menus — how large it is
 * shown, scenes (parts of the board under a name, gone back to), items onto the grid and spread at
 * equal distances, the board printed. */
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
    const shapes = () => st().things.filter((t) => t.k === "shape");
    // ---- how large
    q('[data-do="zoom"]').click(); await sleep(300);
    ok("the size shown, clicked: a list of sizes, Show Everything, Actual Size — opening upwards", st().menu === "zoom" && q(".bd-vpop").querySelectorAll("[data-zoom]").length === 8 && !!q('.bd-vpop [data-m="fit"]') && q(".bd-vpop").getBoundingClientRect().bottom < q(".bd-zoom").getBoundingClientRect().top, [st().menu, q(".bd-vpop").innerHTML.slice(0, 120)]);
    q('.bd-vpop [data-zoom="2"]').click(); await sleep(100);
    ok("200 %: so it is, and the menu is shut", st().zoom === 2 && st().menu === null && q('[data-do="zoom"]').textContent === "200 %", [st().zoom, st().menu]);
    key("1", { ctrlKey: true });
    // ---- things to frame
    key("v");
    for (const [i, shape] of ["rect", "ellipse", "triangle"].entries()) { q('[data-do="shapes"]').click(); await sleep(250); q(`.bd-spop [data-shape="${shape}"]`).click(); await sleep(150); B().pick([shapes()[i].id]); const t = shapes()[i]; await drag(steps(at(t.x + 10, t.y + t.h - 10), at(t.x + 10 + [-407, -93, 311][i], t.y + t.h - 10 + [-13, 47, 9][i])), { altKey: true }); await sleep(420); }
    ok("three shapes, put somewhere off the grid", shapes().length === 3 && shapes().some((t) => t.x % 20 !== 0), shapes().map((t) => [t.x, t.y]));
    // ---- onto the grid
    q('[data-do="more"]').click(); await sleep(300);
    ok("More: the board as a picture, printed, and Snap to Grid", st().menu === "more" && ["copy", "print", "snap"].every((m) => q(`.bd-vpop [data-m="${m}"]`)), q(".bd-vpop").innerHTML.slice(0, 200));
    q('.bd-vpop [data-m="snap"]').click(); await sleep(100);
    ok("Snap to Grid: on, with its tick, the menu stays", st().snap && st().menu === "more" && q('.bd-vpop [data-m="snap"]').getAttribute("aria-checked") === "true", st().snap);
    key("Escape");
    B().pick([shapes()[0].id]);
    let t = shapes()[0];
    await drag(steps(at(t.x + 10, t.y + t.h - 10), at(t.x + 10 + 33, t.y + t.h - 10 + 27)));
    ok("moved with the grid on: its top left corner comes to rest on a dot", shapes()[0].x % 20 === 0 && shapes()[0].y % 20 === 0 && shapes()[0].x !== t.x, [t.x, t.y, shapes()[0].x, shapes()[0].y]);
    q('[data-do="more"]').click(); await sleep(250); q('.bd-vpop [data-m="snap"]').click(); key("Escape");
    // ---- spread at equal distances
    key("a", { ctrlKey: true });
    q('.bd-fbar [data-f="arrange"]').click(); await sleep(300);
    ok("three chosen: Arrange offers to spread them", !!q('.bd-fpop [data-dist="H"]') && !!q('.bd-fpop [data-dist="V"]'), q(".bd-fpop").innerHTML.slice(0, 100));
    q('.bd-fpop [data-dist="H"]').click(); await sleep(80);
    const byX = [...shapes()].sort((a, b) => a.x - b.x), gaps = [byX[1].x - (byX[0].x + byX[0].w), byX[2].x - (byX[1].x + byX[1].w)];
    ok("side by side: the same distance between each two, the outermost where they were", Math.abs(gaps[0] - gaps[1]) < 0.3, [gaps, byX.map((s) => s.x)]);
    key("Escape"); key("Escape");
    // ---- scenes
    ok("no scenes: no arrows for them beside the size", q('[data-do="prev"]').hidden && q('[data-do="next"]').hidden, null);
    q('[data-do="scenes"]').click(); await sleep(300);
    ok("Scenes: none yet, said so, and Add Scene", st().menu === "scenes" && !!q(".bd-vpop .bd-hint") && !!q('.bd-vpop [data-m="scene-add"]'), q(".bd-vpop").innerHTML.slice(0, 160));
    key("0", { ctrlKey: true });
    await sleep(100);
    const whole = st().view;
    q('[data-do="scenes"]').click(); await sleep(250);
    q('.bd-vpop [data-m="scene-add"]').click(); await sleep(100);
    ok("Add Scene: what the window shows, as Scene 1, in the list", st().scenes.length === 1 && st().scenes[0].name === "Scene 1" && st().scenes[0].view[0] === Math.round(whole.x) && q(".bd-vpop").querySelectorAll(".bd-scene").length === 1 && st().menu === "scenes", st().scenes);
    key("Escape");
    // another part of the board, framed close
    const one = byX[2];
    stage.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -260, ctrlKey: true, clientX: at(one.x + one.w / 2, 0)[0], clientY: at(0, one.y + one.h / 2)[1] }));
    await sleep(100);
    q('[data-do="scenes"]').click(); await sleep(250);
    q('.bd-vpop [data-m="scene-add"]').click(); await sleep(100);
    const close = st().view;
    ok("a second scene, nearer", st().scenes.length === 2 && st().scenes[1].view[2] < st().scenes[0].view[2] && !q('[data-do="prev"]').hidden, st().scenes);
    // named
    q('.bd-vpop [data-scene-name]').click(); await sleep(100);
    const input = q(".bd-vpop .bd-scene-input");
    ok("Rename: its name is a field where it stands", !!input && document.activeElement === input && input.value === "Scene 1", !!input);
    input.value = "Everything";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(100);
    ok("typed and Enter: so it is called, the board is still open", st().scenes[0].name === "Everything" && B().shown && q(".bd-vpop .bd-scene-go").textContent === "Everything", st().scenes);
    // gone to
    q(`.bd-vpop [data-scene="${st().scenes[0].id}"]`).click(); await sleep(100);
    ok("a scene clicked: the window shows that part again, the menu is shut", Math.abs(st().view.x - whole.x) < 2 && Math.abs(st().view.z - whole.z) < 0.01 && st().menu === null && st().scene === 0, [st().view, whole]);
    q('[data-do="next"]').click(); await sleep(100);
    ok("the arrow beside the size: the next scene", st().scene === 1 && Math.abs(st().view.z - close.z) < 0.01 && Math.abs(st().view.x - close.x) < 2, [st().view, close]);
    q('[data-do="next"]').click(); await sleep(100);
    ok("… and round to the first again", st().scene === 0, st().scene);
    out("scenes", {});
    q('[data-do="scenes"]').click(); await sleep(300);
    await sleep(300);
    out("list", {});
    await sleep(400);
    // replaced, deleted, taken back
    const was = st().scenes[1].view.join();
    q(`.bd-vpop [data-scene-set="${st().scenes[1].id}"]`).click(); await sleep(100);
    ok("Replace with This View: the second scene is what the window shows now", st().scenes[1].view.join() !== was && st().scenes[1].view[2] === st().scenes[0].view[2], st().scenes);
    q(`.bd-vpop [data-scene-del="${st().scenes[1].id}"]`).click(); await sleep(100);
    ok("Delete: one scene left", st().scenes.length === 1, st().scenes);
    key("Escape");
    key("z", { ctrlKey: true }); key("z", { ctrlKey: true });
    ok("two steps back: two scenes, the second as it was framed", st().scenes.length === 2 && st().scenes[1].view.join() === was, st().scenes);
    // printed: the board's picture alone on the page
    let printed = 0;
    const real = window.MdHost.post;
    window.MdHost.post = (m) => { if (JSON.parse(m).type === "print") printed++; else real.call(window.MdHost, m); };
    q('[data-do="more"]').click(); await sleep(250); q('.bd-vpop [data-m="print"]').click();
    const page = () => document.getElementById("board-print");
    ok("Print…: the board's picture is what the page holds, and the shell is asked to print", await until(() => printed === 1 && page() && page().naturalWidth > 300 && document.body.hasAttribute("data-board-print"), 3000), [printed, !!page()]);
    window.dispatchEvent(new Event("afterprint"));
    ok("printed: the picture for the page is gone again", !page() && !document.body.hasAttribute("data-board-print"), !!page());
    window.MdHost.post = real;
    const kept = JSON.stringify(st().scenes);
    ok("kept by itself", await until(() => st() && !st().dirty, 3000), st().dirty);
    key("Escape"); key("Escape");
    await until(() => el().hidden, 2000);
    MdActive.islands.open(MdActive.view.pm, (() => { let p = -1; MdActive.view.pm.state.doc.descendants((n, pos) => { if (n.type.name === "island" && /board\.svg/.test(n.attrs.raw || "")) p = pos; }); return p; })());
    ok("opened again: the scenes are there", await until(() => st() && el().hasAttribute("data-ready")) && JSON.stringify(st().scenes) === kept && !q('[data-do="next"]').hidden, st() && st().scenes);
    key("Escape");
    await until(() => el().hidden, 2000);
    MdView.core.post("reload");
    await sleep(500);
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  out("board-scenes", o);
})();
