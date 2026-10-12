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
      const before = box(page(2));
      draw.click();
      ok("the whiteboard comes up over the PDF", await until(() => B.shown && st().pdf && document.querySelector("#board[data-open][data-pdf]")), st());
      const sheet = (n) => document.querySelectorAll("#board .bd-sheet")[n - 1];
      ok("with a sheet for every page", document.querySelectorAll("#board .bd-sheet").length === 6);
      ok("the page stands where it stood in the viewer", close(box(sheet(2)), before), [box(sheet(2)), before]);
      ok("the pages in sight are drawn", await until(() => st().pdf.drawn.includes(2) && sheet(2).querySelector("canvas")), st().pdf);
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
      // the wheel alone moves down the pages; pages come into sight and are drawn
      for (let i = 0; i < 30; i++) { stage().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 300, clientY: 300, deltaY: 120 })); await sleep(8); }
      ok("the wheel moves down the pages, and they are drawn as they come", await until(() => st().pdf.drawn.some((n) => n >= 4), 5000), st().pdf);
      out("large", {});
      await sleep(700);
      for (let i = 0; i < 30; i++) { stage().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 300, clientY: 300, deltaY: -120 })); await sleep(8); }
      await sleep(300);
      const left = box(sheet(2)), zoom = st().zoom;
      // --- back to the PDF
      key("Escape");
      if (B.shown) document.querySelector('#board [data-do="back"]').click();
      ok("back: the board is gone", await until(() => !B.shown && document.querySelector("#board").hidden, 3000));
      ok("the stroke lies on page 2, and on no other", await until(() => ink(2) && ink(2).querySelectorAll("path").length === 1) && !ink(1) && !ink(3), document.querySelectorAll(".pdf-ink").length);
      ok("the PDF is as large as the board was left", Math.abs(V.scale - zoom * B.pdf.UNIT) < 0.02, [V.scale, zoom * B.pdf.UNIT]);
      ok("… and the page at the height it was", Math.abs(box(page(2))[1] - left[1]) <= 3, [box(page(2)), left]);
      ok("text can be selected through the ink", getComputedStyle(ink(2)).pointerEvents === "none");
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
