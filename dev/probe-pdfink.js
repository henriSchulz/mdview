/* Development probe (dev/rig.sh pdfink): a PDF drawn on — the whiteboard over its pages, where
 * they stood; a stroke kept by the host; the pages larger under the hand; the ink on the page
 * in the viewer, and there again when the PDF is opened anew (the rig starts the app twice). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const ok = (name, cond, detail) => (post("log", { text: (cond ? "ok " : "FAIL ") + name }), o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail))));
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v)); };
  const close = (a, b, by = 2) => a.every((v, i) => Math.abs(v - b[i]) <= by);
  let phase = "drawn";
  try {
    await document.fonts.ready;
    ok("the PDF is shown", await until(() => window.MdPdf && MdPdf.shown && MdPdf.shown.pages.length === 6 && MdPdf.shown.pages[0].state === "done"), !!window.MdPdf);
    const V = MdPdf.shown, page = (n) => V.pages[n - 1].div, ink = (n) => page(n).querySelector("svg.pdf-ink");
    await until(() => window.MdBoard && MdBoard.pdfInk, 4000);
    const had = await MdBoard.pdfInk(V.p.path);
    const B = MdBoard, st = () => B.state();
    const stage = () => document.querySelector("#board .bd-stage");
    const ev = (type, x, y, more = {}) => stage().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5, ...more }));
    const stroke = async (pts) => { ev("pointerdown", ...pts[0]); for (const p of pts.slice(1)) { ev("pointermove", ...p); await sleep(8); } ev("pointerup", ...pts[pts.length - 1]); await sleep(60); };
    const key = (k, more = {}) => document.querySelector("#board").dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
    const draw = V.bar.querySelector('[data-do="draw"]');
    if (!had) {
      // --- the first time: nothing drawn yet
      ok("the toolbar has the pen", !!draw && !!draw.getAttribute("aria-label"));
      ok("nothing lies on the pages", !document.querySelector(".pdf-ink"));
      MdPdf.test.go(2);
      await until(() => V.pages[1].state === "done");
      await sleep(200);
      const before = box(page(2)), next = box(page(3)), first = box(page(1));
      const seen = [1, 2, 3, 4].filter((n) => { const r = page(n).getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
      draw.click();
      // (the moment the board is there: its pages are not bare — the viewer's pictures lie on them)
      await until(() => B.shown && st().pdf && document.querySelectorAll("#board .bd-sheet").length === 6, 4000);
      ok("the board comes up with the pages on it, none bare", seen.includes(2) && seen.every((n) => { const c = document.querySelectorAll("#board .bd-sheet")[n - 1].querySelector("canvas"); return c && c.width > 100; }), st() && st().pdf);
      ok("the whiteboard comes up over the PDF", await until(() => B.shown && st().pdf && document.querySelector("#board[data-open][data-pdf]")), st());
      const sheet = (n) => document.querySelectorAll("#board .bd-sheet")[n - 1];
      ok("with a sheet for every page", document.querySelectorAll("#board .bd-sheet").length === 6);
      ok("the page stands where it stood in the viewer", close(box(sheet(2)), before), [box(sheet(2)), before]);
      ok("… and so do the pages before and after it: nothing jumps", close(box(sheet(3)), next) && close(box(sheet(1)), first), [box(sheet(1)), first, box(sheet(3)), next]);
      { // the board's bars come in moving, each from its edge — and come to rest where they belong
        const bars = [...document.querySelectorAll("#board .bd-bar")].filter((b) => b.getBoundingClientRect().width), title = document.querySelector("#board .bd-title"), zoom = document.querySelector("#board .bd-zoom");
        const first = (b) => (b.getAnimations().flatMap((a) => a.effect.getKeyframes()).find((k) => k.translate && /16px/.test(k.translate)) || {}).translate || "";
        const rest = new Map(bars.map((b) => [b, b.style.translate])), firsts = bars.map(first);
        ok("the board's bars come in moving", bars.length >= 3 && firsts.every(Boolean), firsts);
        ok("… those at the top from above, those at the bottom from below", first(title).endsWith("(-16px)") && first(zoom).endsWith("(16px)"), [first(title), first(zoom)]);
        ok("… and come to rest where they stand", await until(() => bars.every((b) => !b.getAnimations().length), 3000) && bars.every((b) => b.style.translate === rest.get(b)) && Math.abs(title.getBoundingClientRect().top - 12) < 30, bars.map((b) => b.getAnimations().length));
      }
      ok("the viewer's bar goes as the board comes", await until(() => getComputedStyle(V.bar).opacity === "0", 1500), getComputedStyle(V.bar).opacity);
      ok("the pages in sight are drawn", await until(() => st().pdf.drawn.includes(2) && sheet(2).querySelector("canvas")), st().pdf);
      ok("no bar at the lower right over a PDF (joining, the dots)", !document.querySelector("#board .bd-viewbar").getBoundingClientRect().width);
      ok("it is named as the PDF is, and has no dots", document.querySelector("#board .bd-name").textContent === "paper.pdf" && !stage().hasAttribute("data-grid"));
      out("open", {});
      await sleep(700);
      // --- a stroke with the pen, on page 2
      document.querySelector('#board [data-kind="pen"]').click();
      const r = sheet(2).getBoundingClientRect(), x0 = r.left + r.width * 0.3, y0 = Math.max(120, r.top + 60);
      await stroke(Array.from({ length: 24 }, (_v, i) => [x0 + i * 8, y0 + Math.sin(i / 3) * 20]));
      ok("a stroke is drawn on the page", st().items === 1 && st().dirty, st().items);
      ok("ink on paper is dark, whatever the theme", st().inks[0] === "auto" && getComputedStyle(document.querySelector("#board .bd-world")).getPropertyValue("--fg").trim() === "#1d1d1f");
      ok("it is kept", await until(() => !st().dirty && !document.querySelector("#board .bd-chip[data-bad]"), 3000), st().dirty);
      // --- larger under the hand: the sheet is stretched at once, and drawn sharper when the hand rests
      const w0 = sheet(2).querySelector("canvas").width, z0 = st().zoom, r0 = sheet(2).getBoundingClientRect();
      for (let i = 0; i < 4; i++) { stage().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: r0.left + 100, clientY: y0, deltaY: -40, ctrlKey: true })); await sleep(16); }
      await sleep(60);
      ok("Ctrl and the wheel: larger", st().zoom > z0 * 1.3, [z0, st().zoom]);
      ok("… the sheet with it at once", sheet(2).getBoundingClientRect().width > r0.width * 1.3);
      ok("… and sharper once it rests", await until(() => sheet(2).querySelector("canvas").width > w0 * 1.2, 5000), [w0, sheet(2).querySelector("canvas").width]);
      // --- the size pulled on a touchpad (the host says how much, not where): what is under the pointer stays under it
      {
        const px = Math.round(r0.left + 140), py = 420, c = stage().getBoundingClientRect(), wheel = (dy) => stage().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: px, clientY: py, deltaY: dy, ctrlKey: true }));
        stage().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: px, clientY: py, pointerId: 1, pointerType: "mouse", isPrimary: true }));
        const under = () => { const v = st().view; return [v.x + (px - c.left) / v.z, v.y + (py - c.top) / v.z]; }, was = under(), zw = st().zoom;
        MdView.pinch("begin", 1); MdView.pinch("move", 1.2); MdView.pinch("move", 1.5);
        await sleep(60);
        ok("a pinch on the touchpad: larger", Math.abs(st().zoom - zw * 1.5) < 0.01, [zw, st().zoom]);
        ok("… around what is under the pointer, not the window's middle", close(under(), was, 1), [was, under()]);
        // --- a notch of a mouse's wheel: the size glides there
        const z1 = st().zoom;
        wheel(-120);
        await sleep(30);
        const soon = st().zoom;
        ok("a notch of the wheel is a glide, not a jump", soon > z1 && soon < z1 * 1.2 && await until(() => Math.abs(st().zoom - z1 * Math.exp(0.3)) < 0.01, 1500), [z1, soon, st().zoom]);
        ok("… around the pointer", close(under(), was, 1), [was, under()]);
        // --- far in: closer than a board goes, and sharp there
        for (let i = 0; i < 9; i++) { wheel(-120); await sleep(30); }
        ok("far in: more than four times", await until(() => st().zoom > 6, 3000), st().zoom);
        ok("… still around the pointer", close(under(), was, 1), [was, under()]);
        const dpr = window.devicePixelRatio || 1, detail = () => document.querySelector("#board .bd-sheet .bd-detail");
        ok("… and what is in sight is drawn as sharp as the screen shows it", await until(() => detail() && detail().width / detail().getBoundingClientRect().width > dpr * 0.95, 8000), [st().pdf, detail() && detail().width / detail().getBoundingClientRect().width]);
        ok("… with no picture much larger than the window", [...document.querySelectorAll("#board .bd-sheet canvas")].every((cv) => cv.width * cv.height <= Math.max(4.2e6, innerWidth * innerHeight * dpr * dpr * 2.4)), [...document.querySelectorAll("#board .bd-sheet canvas")].map((cv) => cv.width * cv.height));
        out("far", {});
        await sleep(700);
        for (let i = 0; i < 30 && st().zoom > 1.7; i++) { wheel(120); await sleep(120); }
        await sleep(400);
        ok("and out again: the page's own picture, no detail over it", await until(() => !detail(), 3000), st().pdf);
      }
      // --- down the pages, smoothly: a notch is a glide, and a push on the touchpad runs on when the fingers leave
      {
        const roll = (dy) => stage().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 300, clientY: 300, deltaY: dy })), y = () => st().view.y * st().zoom;
        const y0 = y();
        roll(120);
        const at = y();
        await sleep(30);
        const soon = y();
        ok("a notch of the wheel: the pages glide down, they do not jump", at === y0 && soon > y0 && soon < y0 + 100 && await until(() => Math.abs(y() - (y0 + 120)) < 1.5, 1500), [y0, at, soon, y()]);
        for (let i = 0; i < 8; i++) { roll(18); await sleep(10); }
        const left = y();
        await sleep(450);
        ok("two fingers lifted while the pages move: they run on, slower and slower", y() > left + 40, [left, y()]);
        await until(() => { const a = y(); return new Promise((r) => setTimeout(() => r(Math.abs(y() - a) < 0.5), 120)); }, 3000);
        await sleep(300);
        for (const d of [18, 14, 10, 7, 5, 3, 2, 1, 1]) { roll(d); await sleep(16); }
        const rest = y();
        await sleep(350);
        ok("… brought to rest by the hand, they stay", Math.abs(y() - rest) < 2, [rest, y()]);
      }
      // the wheel alone moves down the pages; pages come into sight and are drawn
      for (let i = 0; i < 30; i++) { stage().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 300, clientY: 300, deltaY: 120 })); await sleep(8); }
      ok("the wheel moves down the pages, and they are drawn as they come", await until(() => st().pdf.drawn.some((n) => n >= 4), 5000), st().pdf);
      out("large", {});
      await sleep(700);
      for (let i = 0; i < 30; i++) { stage().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 300, clientY: 300, deltaY: -120 })); await sleep(8); }
      await sleep(900);
      const left = box(sheet(2)), zoom = st().zoom;
      // --- the eraser takes what is drawn: a shape and a line too, met where they are drawn — and a text is not rubbed out
      {
        const things = () => st().things, at = (t) => { const v = st().view; return [(t.x - v.x) * v.z, (t.y - v.y) * v.z, t.w * v.z, t.h * v.z]; };
        const eraser = async () => { document.querySelector('#board [data-kind="eraser"]').click(); await sleep(80); };
        B.put("sticky"); await sleep(120); key("Escape"); await sleep(60);
        const note = things().find((t) => t.k === "sticky"), [tx, ty, tw, th] = at(note);
        await eraser();
        await stroke([[tx + tw / 2 - 30, ty + th / 2], [tx + tw / 2, ty + th / 2], [tx + tw / 2 + 30, ty + th / 2]]);
        ok("the eraser over a note: it stays", things().some((t) => t.k === "sticky"), things().map((t) => t.k));
        B.pick([note.id]); await sleep(60); key("Delete"); await sleep(80); // (taken away by hand)
        B.put("shape"); await sleep(120); key("Escape"); await sleep(60);
        const shape = things().find((t) => t.k === "shape"), [sx, sy, sw, sh] = at(shape);
        ok("a shape is on the page", !!shape && sw > 20, things().map((t) => t.k));
        await eraser();
        await stroke([[sx - 30, sy + sh / 2], [sx - 10, sy + sh / 2], [sx + 2, sy + sh / 2], [sx + 12, sy + sh / 2]]);
        ok("the eraser over a shape's outline: the shape is gone", !things().some((t) => t.k === "shape") && st().items === 1, things().map((t) => t.k));
        key("z", { ctrlKey: true }); await sleep(80);
        ok("… and Ctrl+Z brings it back", things().some((t) => t.k === "shape"));
        document.querySelector('#board .bd-palette [data-mode="pixel"]').click(); await sleep(60);
        await stroke([[sx - 30, sy + sh / 2], [sx - 10, sy + sh / 2], [sx + 2, sy + sh / 2], [sx + 12, sy + sh / 2]]);
        ok("set to parts it takes a shape whole as well", !things().some((t) => t.k === "shape"), things().map((t) => t.k));
        document.querySelector('#board .bd-palette [data-mode="object"]').click();
        ok("the page holds the stroke alone again", st().items === 1 && !things().length, things().map((t) => t.k));
        await until(() => !st().dirty, 3000);
      }
      // --- back to the PDF
      key("Escape");
      if (B.shown) document.querySelector('#board [data-do="back"]').click();
      ok("back: the board is gone", await until(() => !B.shown && document.querySelector("#board").hidden, 3000));
      ok("… and the viewer's bar is back", await until(() => getComputedStyle(V.bar).opacity === "1", 1500), getComputedStyle(V.bar).opacity);
      ok("the stroke lies on page 2, and on no other", await until(() => ink(2) && ink(2).querySelectorAll("path").length === 1) && !ink(1) && !ink(3), document.querySelectorAll(".pdf-ink").length);
      ok("the PDF is as large as the board was left", Math.abs(V.scale - zoom * B.pdf.UNIT) < 0.02, [V.scale, zoom * B.pdf.UNIT]);
      ok("… and the page at the height it was", Math.abs(box(page(2))[1] - left[1]) <= 3, [box(page(2)), left]);
      ok("text can be selected through the ink", getComputedStyle(ink(2)).pointerEvents === "none");
      // --- the board left without Back: the window's focus lost and got again (another window clicked, a tap outside) does not
      // leave it; left quickly (a tab, a note chosen) the PDF stands where the board was, not where it stood before the pen
      {
        const mx = innerWidth / 2, my = innerHeight / 2;
        const middle = (els) => { const i = els.findIndex((d) => { const r = d.getBoundingClientRect(); return r.top <= my && r.bottom >= my; }); if (i < 0) return null; const r = els[i].getBoundingClientRect(); return { n: i + 1, fx: (mx - r.left) / r.width, fy: (my - r.top) / r.height, h: r.height, w: r.width }; };
        const sheets = () => [...document.querySelectorAll("#board .bd-sheet")], pages = () => V.pages.map((x) => x.div);
        const same = (a, b) => a && b && a.n === b.n && Math.abs((a.fy - b.fy) * b.h) <= 3 && Math.abs((a.fx - b.fx) * b.w) <= 3;
        const roll = (dy, ctrl = false) => stage().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: mx, clientY: my, deltaY: dy, ctrlKey: ctrl }));
        const rest = async () => { for (let t = 0; t < 40; t++) { const a = JSON.stringify(st().view); await sleep(150); if (JSON.stringify(st().view) === a) return; } };
        const open = async () => { draw.click(); await until(() => B.shown && document.querySelector("#board[data-open]") && sheets().length === 6, 4000); await sleep(500); };
        MdPdf.test.go(1);
        await sleep(300);
        const before = middle(pages());
        await open();
        for (let i = 0; i < 12; i++) { roll(120); await sleep(30); } // (down the pages, to page 3 or so)
        await rest();
        const was = middle(sheets());
        window.dispatchEvent(new FocusEvent("blur")); await sleep(80); window.dispatchEvent(new FocusEvent("focus"));
        await sleep(600);
        ok("the window's focus lost and back while drawing on the PDF: the board stays", B.shown && !!document.querySelector("#board[data-open]"), B.shown);
        ok("… where it was", same(middle(sheets()), was), [was, middle(sheets())]);
        B.leave(); // (what a tab or a note chosen does: no way back to watch)
        await sleep(400);
        ok("left quickly: the board is gone", !B.shown);
        ok("… and the PDF stands where the board was, not where it stood before", was && was.n !== before.n && same(middle(pages()), was), [before, was, middle(pages())]);
        // larger on the board than the viewer goes (500 %): the place in the window's middle is kept
        await open();
        for (let i = 0; i < 14; i++) { roll(-120, true); await sleep(60); }
        await rest();
        const far = middle(sheets()), z = st().zoom;
        key("Escape");
        if (B.shown) document.querySelector('#board [data-do="back"]').click();
        await until(() => !B.shown, 3000);
        await sleep(300);
        ok("back from larger than the viewer goes: as large as it goes", z * B.pdf.UNIT > 5.2 && Math.abs(V.scale - 5) < 0.01, [z, V.scale]);
        ok("… and the place in the window's middle is the same", same(middle(pages()), { ...far, h: V.pages[0].div.getBoundingClientRect().height, w: V.pages[0].div.getBoundingClientRect().width }), [far, middle(pages())]);
      }
    } else {
      // --- the app started anew: what was drawn is on the page
      phase = "again";
      ok("opened anew: what was drawn is there", had.items.length === 1, had.items.length);
      MdPdf.test.go(2);
      ok("… on page 2, as it was drawn", await until(() => V.pages[1].state === "done" && ink(2) && ink(2).querySelectorAll("path").length === 1), document.querySelectorAll(".pdf-ink").length);
      out("shown", {});
      await sleep(700);
      // rubbed out again: nothing is kept
      draw.click();
      await until(() => B.shown && st().items === 1 && document.querySelector("#board[data-open]"));
      ok("the board has the stroke", st().items === 1, st());
      key("a", { ctrlKey: true });
      await sleep(100);
      ok("all of it is chosen", st().chosen === 1, st());
      key("Delete");
      ok("and taken away", await until(() => st().items === 0 && !st().dirty, 3000), st());
      B.close();
      ok("the page is bare again", await until(() => !document.querySelector(".pdf-ink"), 3000));
      await sleep(300);
    }
    if (errs.length) ok("no script errors", false, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out(phase, o);
})();
