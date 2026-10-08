/* Development probe (dev/rig.sh board-connect): connectors on a whiteboard — a line pulled out of
 * an item by the arrow at its side, the shape chosen for its end, lines that go where their items
 * go, an end let go of and joined again, the way a line takes, a line between two chosen items. */
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
    const things = () => st().things, of = (k) => things().filter((t) => t.k === k);
    key("v");
    B().put("shape", { shape: "round" }); await sleep(200);
    const first = () => of("shape")[0];
    ok("without the connectors a chosen item has its knob and no arrows", !st().connect && !q(".bd-pick").hasAttribute("data-conn") && getComputedStyle(q(".bd-knob")).display !== "none", st().connect);
    q('[data-do="connect"]').click(); await sleep(100);
    ok("Connectors: an arrow off each side of it", st().connect && q(".bd-pick").hasAttribute("data-conn") && [...el().querySelectorAll(".bd-conn")].filter((c) => getComputedStyle(c).display !== "none").length === 4 && getComputedStyle(q(".bd-knob")).display === "none", st().connect);
    out("arrows", {});
    await sleep(400);
    // a line pulled out of its right side, let go over the bare board
    let s = first();
    await drag(steps(at(s.x + s.w + 24, s.y + s.h / 2), at(s.x + s.w + 180, s.y + s.h / 2), 10));
    ok("the right arrow pulled out to the bare board: a line from that side, and the question what is to stand at its end", st().asking && of("line").length === 1 && of("line")[0].from.id === s.id && of("line")[0].from.at === "r" && !of("line")[0].to, [st().asking, of("line")]);
    q('.bd-cpop [data-next="ellipse"]').click(); await sleep(150);
    const second = () => of("shape")[1], line = () => of("line")[0];
    ok("an ellipse chosen: it stands beyond the line's end, of the first one's size and look, joined on its left side, and is chosen", of("shape").length === 2 && second().shape === "ellipse" && second().w === s.w && second().fill === s.fill && line().to.id === second().id && line().to.at === "l" && Math.abs(second().x - (s.x + s.w + 180)) <= 1 && st().picked[0] === second().id && !st().asking, [second(), line()]);
    ok("the line ends in an arrow and takes its way by right angles", line().ends.join() === "none,arrow" && line().route === "corner", line());
    // the first item moved: the line goes with it
    B().pick([first().id]);
    s = first();
    await drag(steps(at(s.x + 12, s.y + s.h - 12), at(s.x + 12, s.y + s.h - 12 + 140)), { altKey: true });
    ok("the first item moved down: the line's start is still on its right side, its end where it was", first().y === s.y + 140 && line().p[0] === first().x + first().w && line().p[1] === first().y + first().h / 2 && line().p[2] === second().x, [first(), line().p]);
    const path = () => el().querySelector(`.bd-world .bd-item[data-id="${line().id}"] path`).getAttribute("d");
    ok("… drawn with two corners between them", (path().match(/L/g) || []).length === 3, path());
    key("z", { ctrlKey: true });
    ok("one step back: item and line as before", first().y === s.y && line().p[1] === s.y + s.h / 2, [first().y, line().p]);
    // out of the second item's bottom, let go over the first: joined at once, nothing asked
    B().pick([second().id]);
    let t = second();
    await drag(steps(at(t.x + t.w / 2, t.y + t.h + 24), at(first().x + first().w / 2, first().y + first().h / 2 + 10), 12));
    ok("an arrow pulled onto another item joins the two, without asking", of("line").length === 2 && !st().asking && of("line")[1].from.id === second().id && of("line")[1].to.id === first().id, of("line"));
    // an end pulled off its item lets go; let go over an item, it joins that
    B().pick([line().id]);
    const end = line().p.slice(2);
    await drag(steps(at(...end), at(end[0] + 40, end[1] - 220), 10));
    ok("the first line's end pulled away to the bare board: it is joined to nothing there", !line().to && line().p[3] === end[1] - 220 && !!line().from, line());
    await drag(steps(at(line().p[2], line().p[3]), at(second().x + second().w / 2, second().y + 4), 10));
    ok("pulled back onto the ellipse, near its top: joined there", line().to && line().to.id === second().id && line().to.at === "t" && line().p[3] === second().y, line());
    // the way it takes
    q('.bd-fbar [data-f="ends"]').click(); await sleep(300);
    ok("Line Ends offers the line's way too: straight, by right angles, as a bow", q(".bd-fpop").querySelectorAll("[data-route]").length === 3 && q('.bd-fpop [data-route="corner"]').getAttribute("aria-pressed") === "true", q(".bd-fpop").innerHTML.slice(0, 200));
    q('.bd-fpop [data-route="curve"]').click(); await sleep(80);
    ok("as a bow: drawn in many small pieces", line().route === "curve" && (path().match(/L/g) || []).length > 10, path().slice(0, 80));
    q('.bd-fpop [data-route="straight"]').click(); await sleep(80);
    ok("straight: one piece, and no word about its way in the item", !line().route && (path().match(/L/g) || []).length === 1, line());
    key("Escape"); key("Escape");
    out("joined", {});
    await sleep(400);
    // a line between two chosen items
    B().put("shape", { shape: "diamond" }); await sleep(200);
    const third = () => of("shape")[2];
    B().pick([first().id, third().id]);
    q('.bd-fbar [data-f="arrange"]').click(); await sleep(300);
    ok("two items chosen: Arrange offers a line between them", !!q('.bd-fpop [data-f="link"]'), q(".bd-fpop").innerHTML.slice(0, 200));
    q('.bd-fpop [data-f="link"]').click(); await sleep(100);
    ok("Add Connection Line: joined at both ends, chosen", of("line").length === 3 && of("line")[2].from.id === first().id && of("line")[2].to.id === third().id && st().picked[0] === of("line")[2].id, of("line")[2]);
    // an item deleted: its lines stay, joined to nothing at that end
    B().pick([second().id]);
    key("Delete");
    ok("an item deleted: the lines that were joined to it stay where they were, their ends free", of("shape").length === 2 && of("line").length === 3 && !of("line")[0].to && !of("line")[1].from && !!of("line")[1].to, of("line"));
    key("z", { ctrlKey: true });
    ok("one step back: the item is there again and the lines are joined to it", of("shape").length === 3 && of("line")[0].to && of("line")[1].from, of("line"));
    // a line copied with what it joins joins the copies
    key("a", { ctrlKey: true });
    key("d", { ctrlKey: true });
    const copies = things().slice(-6), ids = new Set(copies.map((c) => c.id));
    ok("everything copied: the copies' lines join the copies", things().length === 12 && copies.filter((c) => c.k === "line").every((l) => ids.has(l.from.id) && ids.has(l.to.id)), copies);
    key("Delete");
    const kept = JSON.stringify(things());
    ok("kept by itself", await until(() => st() && !st().dirty, 3000), st().dirty);
    key("Escape"); key("Escape");
    await until(() => el().hidden, 2000);
    out("closed", {});
    await sleep(300);
    MdActive.islands.open(MdActive.view.pm, (() => { let p = -1; MdActive.view.pm.state.doc.descendants((n, pos) => { if (n.type.name === "island" && /board\.svg/.test(n.attrs.raw || "")) p = pos; }); return p; })());
    // (the same values, whatever order a line of the file names them in; which way an end leaves is worked out, not kept)
    const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter((k) => k !== "sides").sort().map((k) => [k, canon(v[k])])) : v);
    const same = (a, b) => JSON.stringify(canon(JSON.parse(a))) === JSON.stringify(canon(JSON.parse(b)));
    ok("opened again: the lines are joined as they were left", await until(() => st() && el().hasAttribute("data-ready")) && same(JSON.stringify(things()), kept), [kept.slice(0, 300), JSON.stringify(things()).slice(0, 300)]);
    key("Escape");
    await until(() => el().hidden, 2000);
    MdView.core.post("reload");
    await sleep(500);
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  out("board-connect", o);
})();
