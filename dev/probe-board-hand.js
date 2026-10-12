/* Development probe (dev/rig.sh board-hand): what a mouse meets on a whiteboard, and its right button — a thing is chosen
 * where it is drawn (a slanting arrow not anywhere in the box around it, a shape that is only an outline not by what stands in
 * it), a box pulled over part of a stroke takes the stroke, an arrow drawn from one box into another is joined to both, the
 * joints off a box's sides, the menu of the right button, and the board moved with it held. The last part is done with a REAL
 * pointer (dev/vptr): what the browser does by itself with the right button is in the check. */
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
    o.window = [innerWidth, innerHeight];
    const ev = (type, x, y, more = {}) => stage.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5, ...more }));
    const drag = async (pts, more = {}) => { ev("pointerdown", ...pts[0], more); for (const p of pts.slice(1)) { ev("pointermove", ...p, more); await sleep(8); } ev("pointerup", ...pts[pts.length - 1], more); await sleep(60); };
    const click = (x, y, more = {}) => drag([[x, y]], more);
    const rest = async (x, y) => { ev("pointermove", x, y, { button: -1, buttons: 0, pressure: 0 }); await sleep(40); }; // (the pointer moved, no button down)
    const right = async (pts) => { ev("pointerdown", ...pts[0], { button: 2, buttons: 2 }); for (const p of pts.slice(1)) { ev("pointermove", ...p, { button: -1, buttons: 2 }); await sleep(8); } ev("pointerup", ...pts[pts.length - 1], { button: 2, buttons: 0 }); await sleep(120); };
    const key = (k, more = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
    const at = (bx, by) => { const v = st().view; return [(bx - v.x) * v.z, (by - v.y) * v.z]; };
    const steps = (a, b, n = 8) => Array.from({ length: n + 1 }, (_v, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    const things = () => st().things, of = (k) => things().filter((t) => t.k === k), picked = () => st().picked, byId = (id) => things().find((t) => t.id === id);
    const tool = async (kind, form) => { q(`.bd-kinds [data-kind="${kind}"]`).click(); await sleep(120); if (form) { q(`.bd-forms [data-form="${form}"]`).click(); await sleep(80); } };
    const menu = () => document.getElementById("textmenu"), menuOpen = () => menu().hasAttribute("data-open"), entries = () => [...menu().querySelectorAll(".menu-item")].map((b) => b.querySelector(".menu-label").textContent + (b.disabled ? " (off)" : ""));
    const choose = async (label) => { const b = [...menu().querySelectorAll(".menu-item")].find((x) => x.querySelector(".menu-label").textContent === label); if (!b) return false; b.click(); await sleep(400); return true; };

    // ---- boxes drawn with the shape tool (outlines, as that tool makes them), on the screen at:
    const A = [140, 150, 240, 220], Bx = [400, 150, 500, 220], C = [400, 330, 500, 400], E = [190, 350, 260, 410], D = [120, 300, 330, 470];
    await tool("shape", "rect");
    const made = [];
    for (const r of [A, Bx, C, E, D]) { await drag(steps([r[0], r[1]], [r[2], r[3]], 6)); made.push(picked()[0]); }
    const [a, b, c, e, d] = made;
    ok("five boxes drawn: outlines, each chosen when it was made", of("shape").length === 5 && new Set(made).size === 5 && of("shape").every((s) => s.fill === "none"), things());

    // ---- an arrow drawn from inside one box into another is joined to both at once
    await tool("shape", "arrow");
    await drag(steps([190, 185], [450, 185], 8));
    const ab = () => of("line")[0];
    ok("an arrow drawn from inside one box into another: joined to both, its ends on their sides", of("line").length === 1 && ab().from && ab().from.id === a && ab().to && ab().to.id === b && ab().p[0] === byId(a).x + byId(a).w && ab().p[2] === byId(b).x, of("line"));
    await drag(steps([225, 210], [430, 365], 8));
    const ac = () => of("line")[1];
    ok("… and one from a box's corner to a box further down: joined, a slanting line between them", of("line").length === 2 && ac().from && ac().from.id === a && ac().to && ac().to.id === c && ac().p[0] !== ac().p[2] && ac().p[1] !== ac().p[3], of("line"));
    await drag(steps([560, 300], [600, 340], 6));
    ok("an arrow drawn on the bare board is joined to nothing", of("line").length === 3 && !of("line")[2].from && !of("line")[2].to, of("line")[2]);
    key("Delete");
    await drag(steps([150, 160], [230, 210], 6));
    ok("an arrow drawn on one box, both ends on it: joined to nothing", of("line").length === 3 && !of("line")[2].from && !of("line")[2].to, of("line")[2]);
    key("Delete");
    key("v"); await sleep(120); // (the lasso in hand, nothing chosen)
    ok("the lasso in hand, nothing chosen", st().kind === "lasso" && !picked().length && of("line").length === 2, [st().kind, picked()]);

    // ---- a slanting arrow is met at its line, not anywhere in the box around it
    const L = ac().p, sc = (bx, by) => at(bx, by), corner = sc(L[0] + (L[2] - L[0]) * 0.8, L[1] + (L[3] - L[1]) * 0.2), mid = sc((L[0] + L[2]) / 2, (L[1] + L[3]) / 2);
    await click(...corner);
    ok("a click in the box around a slanting arrow, away from its line: nothing", !picked().length, [picked(), corner]);
    await drag(steps([corner[0] - 14, corner[1] - 12], [corner[0] + 14, corner[1] + 12], 6));
    ok("a box pulled there, touching nothing: nothing is chosen (not the arrow whose box it lies in)", !picked().length, [picked(), corner, L]);
    await click(mid[0] + 3, mid[1]);
    ok("a click on the arrow's line: the arrow", picked().length === 1 && picked()[0] === ac().id, picked());
    key("Escape");
    await drag(steps([mid[0] - 30, mid[1] - 4], [mid[0] + 5, mid[1] + 20], 6));
    ok("a box pulled across its line: the arrow", picked().length === 1 && picked()[0] === ac().id, picked());
    key("Escape");

    // ---- a shape that is only an outline: what stands in it is reached; a click in it chooses it, a pull in it is a box
    await click(225, 380);
    ok("a click on a box that stands within a larger outline drawn after it: the box (not the outline in front)", picked().length === 1 && picked()[0] === e, [picked(), e, d]);
    key("Escape");
    const dWas = byId(d);
    await drag(steps([140, 320], [280, 430], 8));
    ok("a box pulled within the outline, over the box in it: that box alone, and the outline has not moved", picked().length === 1 && picked()[0] === e && byId(d).x === dWas.x && byId(d).y === dWas.y, [picked(), byId(d), dWas]);
    key("Escape");
    await click(300, 450);
    ok("a click within the outline, on nothing: the outline is chosen", picked().length === 1 && picked()[0] === d, picked());
    await drag(steps([300, 450], [320, 460], 6), { altKey: true });
    ok("chosen, it is moved from anywhere within it", byId(d).x === dWas.x + 20 && byId(d).y === dWas.y + 10, [byId(d), dWas]);
    key("z", { ctrlKey: true });
    key("Escape");
    await click(123, 380);
    ok("a click on the outline itself chooses it too", picked().length === 1 && picked()[0] === d, picked());
    key("Escape");

    // ---- a stroke: the box pulled over any part of it takes it whole; pulled in the bare part of the box around it, nothing
    key("p"); await sleep(120);
    await drag([...steps([140, 500], [140, 600], 12), ...steps([140, 600], [330, 600], 16)]);
    ok("a stroke drawn, down and then along", st().items === 1, st().items);
    key("v"); await sleep(120);
    await drag(steps([220, 510], [300, 560], 6));
    ok("a box pulled in the bare part of the box around the stroke: nothing", st().chosen === 0 && !picked().length, [st().chosen, picked()]);
    await drag(steps([120, 530], [160, 550], 6));
    ok("a box pulled over a small part of the stroke: the whole stroke is chosen", st().chosen === 1, st().chosen);
    key("Escape");

    // ---- joints: off the sides of the thing chosen, and of the one the pointer rests over; pulled, a line to another thing
    B().pick([b]); await sleep(120);
    let j = st().joints;
    ok("one thing chosen: a joint off each of its sides, the knob above the one on top", j && j.id === b && j.at.length === 4 && !q(".bd-joints").hidden && [...el().querySelectorAll(".bd-joint")].filter((x) => getComputedStyle(x).display !== "none").length === 4 && getComputedStyle(q(".bd-knob")).top === "-44px", [j, getComputedStyle(q(".bd-knob")).top]);
    out("joints", {});
    await sleep(500);
    const lines = of("line").length, jb = j.at.find((x) => x[0] === "b");
    await drag(steps([jb[1], jb[2]], [450, 360], 10));
    const bc = () => of("line")[lines];
    ok("the joint under it pulled onto another box: a line from that side, joined at both ends, and nothing asked", of("line").length === lines + 1 && bc().from.id === b && bc().from.at === "b" && bc().to && bc().to.id === c && !st().asking && picked()[0] === bc().id, [of("line"), st().asking]);
    key("Escape"); await sleep(60);
    await rest(600, 520);
    ok("nothing chosen, the pointer over the bare board: no joints", !st().joints && q(".bd-joints").hidden, st().joints);
    await rest(225, 380);
    j = st().joints;
    ok("the pointer rests over a box: its joints show", j && j.id === e && !q(".bd-joints").hidden, j);
    const jr = j.at.find((x) => x[0] === "r");
    await rest(jr[1] - 6, jr[2]); await rest(jr[1], jr[2]);
    ok("… and stay while it goes to one of them, which answers", st().joints && st().joints.id === e && q('.bd-joint[data-side="r"]').hasAttribute("data-on") && stage.hasAttribute("data-joint"), [st().joints, stage.dataset]);
    await drag(steps([jr[1], jr[2]], [440, 380], 10));
    const ec = () => of("line")[lines + 1];
    ok("pulled from there onto another box: joined at both ends", of("line").length === lines + 2 && ec().from.id === e && ec().from.at === "r" && ec().to && ec().to.id === c, of("line"));
    key("Escape"); await sleep(60);
    await rest(600, 520);

    // ---- the right button: let go where it came down, the menu of what is there
    const count = things().length;
    await right([[225, 380]]);
    ok("a right click on a thing that is not chosen: it is chosen, and the app's menu opens there", picked().length === 1 && picked()[0] === e && menuOpen() && menu().classList.contains("ui-menu"), [picked(), menuOpen()]);
    ok("… with what can be done with it", ["Cut", "Copy", "Paste", "Duplicate", "Bring to Front", "Send to Back", "Lock", "Copy Style", "Delete"].every((x) => entries().some((y) => y.replace(" (off)", "") === x)) && !entries().includes("Group"), entries());
    out("menu", {});
    await sleep(500);
    ok("Duplicate, chosen there: a copy beside it", (await choose("Duplicate")) && things().length === count + 1 && !menuOpen() && picked().length === 1 && picked()[0] !== e, [things().length, count, menuOpen()]);
    key("Delete");
    B().pick([a, b]); await sleep(80);
    await right([[450, 153]]);
    ok("a right click on one of two chosen things: both stay chosen, and the menu offers Group and a line between them", picked().length === 2 && menuOpen() && entries().includes("Group") && entries().includes("Add Connection Line"), [picked(), entries()]);
    key("Escape"); await sleep(80);
    ok("Esc puts the menu away, and what was chosen stays", !menuOpen() && picked().length === 2, [menuOpen(), picked()]);
    await right([[600, 520]]);
    ok("a right click on the bare board: nothing is chosen, the menu offers Paste and Select All", !picked().length && menuOpen() && entries().map((x) => x.replace(" (off)", "")).join() === "Paste,Select All", [picked(), entries()]);
    ok("Select All, chosen there: everything", (await choose("Select All")) && picked().length === things().length + st().items, [picked().length, things().length]);
    key("Escape"); await sleep(60);

    // ---- … and pulled, it moves the board: no menu then
    let v = st().view;
    await right(steps([600, 520], [520, 470], 8));
    ok("the right button held and pulled: the board goes with it, and no menu", Math.abs(st().view.x - (v.x + 80 / v.z)) < 0.5 && Math.abs(st().view.y - (v.y + 50 / v.z)) < 0.5 && !menuOpen() && !stage.hasAttribute("data-panning"), [v, st().view, menuOpen()]);
    v = st().view;
    await right([[600, 520], [601, 521], [602, 521]]);
    ok("an unsteady click is still a click: the menu, the board where it was", st().view.x === v.x && st().view.y === v.y && menuOpen(), [v, st().view, menuOpen()]);
    key("Escape"); await sleep(60);

    // ---- the same with a real pointer: the right button as the browser hands it over. (The rig's window may be a small one:
    // the box within the outline is brought to its middle first, and everything is done around there.)
    const cx = Math.round(innerWidth / 2), cy = Math.round(innerHeight / 2), [ex0, ey0] = at(byId(e).x + byId(e).w / 2, byId(e).y + byId(e).h / 2);
    await right(steps([ex0, ey0], [cx, cy], 8));
    let seenAt = null, plans = 0;
    addEventListener("pointermove", (ev2) => { if (ev2.isTrusted) seenAt = [ev2.clientX, ev2.clientY]; }, true);
    const run = async (cmd, ms) => { out("plan" + ++plans, { cmd }); await sleep(ms); };
    await run(`m ${cx - 20} ${cy - 20} s 80 m ${cx - 10} ${cy - 10}`, 0);
    for (let i = 0; i < 200 && !seenAt; i++) await sleep(50);
    await sleep(300);
    if (!seenAt) throw new Error("the pointer was not heard");
    const off = [cx - 10 - seenAt[0], cy - 10 - seenAt[1]], G = (x, y) => `${Math.round(x + off[0])} ${Math.round(y + off[1])}`;
    const heard = { contextmenu: 0, kept: 0 };
    addEventListener("contextmenu", (ev2) => { if (ev2.isTrusted) { heard.contextmenu++; setTimeout(() => { if (!ev2.defaultPrevented) heard.kept++; }, 0); } }, true);
    v = st().view;
    await run(`m ${G(cx + 20, cy + 15)} s 120 rd s 120 g ${G(cx - 20, cy - 15)} 10 25 s 120 ru`, 1800);
    ok("a real pointer, the right button held and pulled: the board goes with it, no menu of the app's and none of the browser's", Math.abs(st().view.x - (v.x + 40 / v.z)) < 2 && Math.abs(st().view.y - (v.y + 30 / v.z)) < 2 && !menuOpen() && heard.contextmenu > 0 && heard.kept === 0, [v, st().view, menuOpen(), heard, off]);
    await run(`m ${G(cx - 40, cy - 30)} s 150 rd s 120 ru`, 1400);
    ok("a real right click on a thing: it is chosen and the menu is open", picked().length === 1 && picked()[0] === e && menuOpen() && heard.kept === 0, [picked(), e, menuOpen(), heard]);
    out("realmenu", {});
    await sleep(500);
    const mr = menu().getBoundingClientRect(), beside = [[12, 12], [innerWidth - 12, 12], [12, innerHeight - 12], [innerWidth - 12, innerHeight - 12]].find(([x, y]) => x < mr.left - 4 || x > mr.right + 4 || y < mr.top - 4 || y > mr.bottom + 4);
    if (beside) {
      await run(`m ${G(...beside)} s 150 d s 80 u`, 1200);
      ok("a real click beside the menu puts it away and does nothing else", !menuOpen() && picked().length === 1 && picked()[0] === e, [menuOpen(), picked(), beside]);
    } else key("Escape");

    ok("kept by itself", await until(() => st() && !st().dirty, 3000), st().dirty);
    key("Escape"); key("Escape");
    await until(() => el().hidden, 2000);
    MdView.core.post("reload");
    await sleep(500);
  } catch (err) {
    o.error = String(err && err.stack || err);
  }
  out("board-hand", o);
})();
