/* Development probe (dev/rig.sh board-more): the rest of the whiteboard's tools — the pencil, the
 * ruler, the palette at the other edge, a link as a card, a file dropped as a card, a picture
 * cut, a look kept for new items. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    try { localStorage.removeItem("mdview:board-tools:place"); } catch (e) { /* none */ }
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const note = MdView.core.current.path, dir = note.slice(0, note.lastIndexOf("/"));
    MdActive.view.focus();
    MdActive.context.INSERT.board(MdActive.view.pm);
    const B = () => window.MdBoard, st = () => B() && B().state && B().state(), el = () => document.getElementById("board"), q = (s) => el().querySelector(s);
    ok("the board opens", await until(() => st() && el().hasAttribute("data-ready")), st());
    await sleep(700);
    const stage = q(".bd-stage");
    const ev = (target, type, x, y, more = {}) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5, ...more }));
    const drag = async (pts, more = {}, target = stage) => { ev(target, "pointerdown", ...pts[0], more); for (const p of pts.slice(1)) { ev(target, "pointermove", ...p, more); await sleep(8); } ev(target, "pointerup", ...pts[pts.length - 1], more); await sleep(60); };
    const key = (k, more = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
    const at = (bx, by) => { const v = st().view; return [(bx - v.x) * v.z, (by - v.y) * v.z]; };
    const steps = (a, b, n = 8) => Array.from({ length: n + 1 }, (_v, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    const W = el().clientWidth, H = el().clientHeight;

    // ---- the pencil
    key("b");
    await drag(Array.from({ length: 25 }, (_v, i) => [200 + i * 8, 180 + Math.sin(i / 3) * 25]));
    ok("B: the pencil — a stroke of its kind, a sixth tool in the tray", st().tool === "pencil" && st().kinds[0].startsWith("pencil:") && el().querySelectorAll(".bd-tools .bd-tool").length === 6, st().kinds);
    // ---- the ruler
    key("r");
    await sleep(100);
    const rule = q(".bd-ruler");
    ok("R: a ruler lies across the middle of the view, level", st().ruler && st().ruler.a === 0 && !rule.hidden && Math.abs(rule.getBoundingClientRect().height - 64) < 1 && q("[data-ruler]").getAttribute("aria-pressed") === "true", st().ruler);
    const mid = at(st().ruler.x, st().ruler.y);
    key("p");
    await drag(Array.from({ length: 30 }, (_v, i) => [mid[0] - 150 + i * 10, mid[1] - 32 - 9 + Math.sin(i) * 7]));
    const ys = () => { const b = st().chosenBox; return b; };
    key("a", { ctrlKey: true });
    const all = st().chosenBox;
    key("Escape"); key("p");
    ok("a stroke begun at its edge runs straight along it, however the hand wobbles", st().items === 2 && st().kinds[1].startsWith("pen:"), st().kinds);
    // the straight stroke's own box: chosen alone with a tap of the lasso
    key("l");
    await drag([[mid[0] - 100, mid[1] - 35], [mid[0] - 100, mid[1] - 35]]);
    const line = st().chosenBox;
    ok("… a level line: no taller than its own width", st().chosen === 1 && line && line[3] - line[1] <= 6 && line[2] - line[0] > 250, line);
    key("Escape"); key("p");
    // turned by an end, moved by its middle
    const L = rule.getBoundingClientRect().width;
    await drag(steps([mid[0] + L / 2 - 20, mid[1]], [mid[0] + L / 2 - 120, mid[1] + 260], 10));
    ok("pulled by an end, it turns about its middle", Math.abs(st().ruler.a) > 20 && Math.abs(st().ruler.x - (st().view.x + mid[0])) < 1, st().ruler);
    const turned = st().ruler.a;
    await drag(steps(mid, [mid[0] + 60, mid[1] - 40], 6));
    ok("pulled by its middle, it moves and keeps its angle", st().ruler.a === turned && Math.abs(st().ruler.x - (st().view.x + mid[0] + 60)) < 1, st().ruler);
    ok("on the ruler itself nothing is drawn", st().items === 2, st().items);
    out("ruler", {});
    await sleep(400);
    key("r");
    ok("R again: put away", !st().ruler && rule.hidden, st().ruler);

    // ---- the palette at the other edge
    const pal = q(".bd-palette"), pr = pal.getBoundingClientRect(), bare = q(".bd-palette .bd-sep");
    const from = [bare.getBoundingClientRect().left + 0.5, pr.top + pr.height / 2];
    await drag(steps(from, [from[0], 140], 8), {}, bare);
    await sleep(700);
    ok("the palette pulled by a bare part to the upper half: it lies at the top from then on, under the bars", st().palette === "top" && pal.getBoundingClientRect().top < H / 3 && pal.getBoundingClientRect().top > q(".bd-insert").getBoundingClientRect().bottom, [st().palette, pal.getBoundingClientRect().top]);
    q('.bd-tool[data-tool="pen"]').click(); await sleep(350);
    ok("its options open under it there", q(".bd-pop").hasAttribute("data-open") && q(".bd-pop").getBoundingClientRect().top >= pal.getBoundingClientRect().bottom, [q(".bd-pop").getBoundingClientRect().top, pal.getBoundingClientRect().bottom]);
    key("Escape");
    const from2 = [bare.getBoundingClientRect().left + 0.5, pal.getBoundingClientRect().top + 30];
    await drag(steps(from2, [from2[0], H - 60], 8), {}, bare);
    await sleep(700);
    ok("… and back to the foot", st().palette === "bottom" && pal.getBoundingClientRect().bottom > H - 40, [st().palette, pal.getBoundingClientRect().bottom]);

    // ---- a link as a card
    q('[data-do="link"]').click(); await sleep(300);
    const field = q(".bd-vpop .bd-link-input");
    ok("Link: a field for its address", st().menu === "link" && !!field && document.activeElement === field, st().menu);
    field.value = "not an address";
    q('.bd-vpop [data-m="link-add"]').click(); await sleep(60);
    ok("what is no address is not taken: the field stays", st().menu === "link" && st().things.length === 0, st().things);
    field.value = "example.org/docs";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(150);
    const card = () => st().things.find((t) => t.k === "link");
    ok("an address and Enter: a card on the board, chosen, the tools put away", card() && card().url === "https://example.org/docs" && st().mode === "select" && st().picked[0] === card().id && st().menu === null, st().things);
    const cardEl = el().querySelector(".bd-world .bd-card");
    ok("the card says where it leads", cardEl.querySelector("b").textContent === "example.org" && cardEl.querySelector("i").textContent === "example.org/docs", cardEl.textContent);
    let opened = null;
    const real = window.MdHost.post;
    window.MdHost.post = (m) => { const j = JSON.parse(m); if (j.type === "link") opened = j; else real.call(window.MdHost, m); };
    q('.bd-fbar [data-f="open"]').click();
    ok("Open in its bar: the host is asked to open the address", opened && opened.href === "https://example.org/docs", opened);
    opened = null;
    const cm = at(card().x + card().w / 2, card().y + card().h / 2);
    await drag([cm, cm]); await drag([cm, cm]);
    ok("clicked twice: opened too", opened && opened.href === "https://example.org/docs" && B().shown, opened);
    key("Escape");

    // ---- a file dropped: a card; a picture dropped: the picture
    const dt = new DataTransfer();
    dt.setData("text/uri-list", "file://" + encodeURI(dir + "/outside/Lecture notes.pdf") + "\r\nfile://" + encodeURI(dir + "/outside/photo.png") + "\r\nfile://" + encodeURI(dir + "/outside/other.md"));
    const r = el().getBoundingClientRect();
    stage.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 320, clientY: r.top + 480 }));
    const fileCard = () => st().things.find((t) => t.k === "file"), pic = () => st().things.find((t) => t.k === "image");
    ok("a PDF, a picture and a note dropped: a card for the PDF, the picture as itself, the note left out", await until(() => fileCard() && pic(), 4000) && fileCard().src === "Lecture notes.pdf" && pic().src === "photo.png" && st().things.length === 3, st().things);
    opened = null;
    B().pick([fileCard().id]);
    q('.bd-fbar [data-f="open"]').click();
    ok("the file's card opened: the host is asked for the file kept beside the board", opened && decodeURIComponent(opened.href).endsWith("/assets/Lecture notes.pdf"), opened);
    window.MdHost.post = real;

    // ---- a picture cut
    await until(() => el().querySelector(".bd-world .bd-img")?.naturalWidth === 240, 4000);
    B().pick([pic().id]);
    let was = pic();
    q('.bd-fbar [data-f="crop"]').click(); await sleep(100);
    ok("Crop in a picture's bar: its frame is its edge now", st().crop === pic().id && q(".bd-pick").hasAttribute("data-crop") && q('.bd-fbar [data-f="crop"]').getAttribute("aria-pressed") === "true", st().crop);
    await drag(steps(at(was.x + was.w, was.y + was.h / 2), at(was.x + was.w - 60, was.y + was.h / 2)));
    ok("its right edge pulled in: a quarter is cut off there, the rest stands where it stood", pic().crop && Math.abs(pic().crop[2] - 0.25) < 0.01 && pic().crop[0] === 0 && pic().w === was.w - 60 && pic().x === was.x && pic().h === was.h, pic());
    const img = el().querySelector(".bd-world .bd-img"), frame = img.parentNode.getBoundingClientRect(), ir = img.getBoundingClientRect();
    ok("… drawn so: the whole picture behind a frame that hides the cut", Math.abs(ir.width - was.w) < 1 && Math.abs(ir.left - frame.left) < 1 && Math.abs(frame.width - (was.w - 60)) < 1 && getComputedStyle(img.parentNode).overflow === "hidden", [ir.width, frame.width]);
    await drag(steps(at(pic().x + pic().w, pic().y + pic().h / 2), at(pic().x + pic().w + 300, pic().y + pic().h / 2)));
    ok("pulled out again: no further than the whole picture", !pic().crop && pic().w === was.w, pic());
    key("z", { ctrlKey: true });
    q('.bd-fbar [data-f="crop"]').click(); await sleep(80);
    ok("Crop again ends it; the bar offers the whole picture back", !st().crop && !!q('.bd-fbar [data-f="uncrop"]'), st().crop);
    q('.bd-fbar [data-f="uncrop"]').click(); await sleep(80);
    ok("Show the Whole Picture: as it was dropped", !pic().crop && pic().w === was.w && pic().x === was.x, pic());
    key("z", { ctrlKey: true });
    key("Escape");

    // ---- a look kept for new items
    q('[data-do="shapes"]').click(); await sleep(300);
    q('.bd-spop [data-shape="rect"]').click(); await sleep(150);
    q('.bd-fbar [data-f="fill"]').click(); await sleep(300);
    q('.bd-fpop [data-fill="#52b85a"]').click();
    q('.bd-fbar [data-f="arrange"]').click(); await sleep(300);
    ok("Arrange offers to make an item's look the look of new ones", !!q('.bd-fpop [data-f="insertStyle"]'), q(".bd-fpop").innerHTML.slice(-300));
    q('.bd-fpop [data-f="insertStyle"]').click(); await sleep(80);
    key("Escape");
    q('[data-do="shapes"]').click(); await sleep(300);
    q('.bd-spop [data-shape="star"]').click(); await sleep(150);
    const star = st().things[st().things.length - 1];
    ok("the next shape begins green, whatever its form", star.shape === "star" && star.fill === "#52b85a" && st().insert && st().insert.shape.fill === "#52b85a", star);
    key("Escape");
    out("more", {});
    await sleep(400);
    const kept = JSON.stringify(st().things), count = st().items;
    ok("kept by itself", await until(() => st() && !st().dirty, 3000), st().dirty);
    key("Escape"); key("Escape");
    await until(() => el().hidden, 2000);
    MdActive.islands.open(MdActive.view.pm, (() => { let p = -1; MdActive.view.pm.state.doc.descendants((n, pos) => { if (n.type.name === "island" && /board\.svg/.test(n.attrs.raw || "")) p = pos; }); return p; })());
    ok("opened again: cards, the cut picture, the strokes and the kept look are there", await until(() => st() && el().hasAttribute("data-ready")) && JSON.stringify(st().things) === kept && st().items === count && st().insert && st().insert.shape.fill === "#52b85a", [kept.slice(0, 200), st() && JSON.stringify(st().things).slice(0, 200)]);
    key("Escape");
    await until(() => el().hidden, 2000);
    MdView.core.post("reload");
    await sleep(500);
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  out("board-more", o);
})();
