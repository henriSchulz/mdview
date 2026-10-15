/* Development probe (dev/rig.sh pdfscroll): a PDF full of words, scrolled and zoomed. Its text to select (a transparent layer of
 * thousands of words over each page) is not drawn while the pages move — where WebKit draws without its GPU way, the window is
 * drawn anew at each step and those words halved the rate (on Henri's screen 52 ms a frame, 17 without) — and it is back,
 * to be chosen and copied, as soon as the hand rests. Henri, 2026-10-15: "the PDF still lags badly when scrolling and
 * zooming". Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  const out = (o) => window.MdHost.post(JSON.stringify({ type: "probe", name: "pdfscroll", text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const ok = (name, cond, detail) => results.push({ name, ok: !!cond, ...(cond ? {} : { detail }) });
  try {
    for (let i = 0; i < 100 && !document.querySelector(".pdfv .textLayer span"); i++) await sleep(100);
    await sleep(800);
    const root = document.querySelector(".pdfv"), sc = document.scrollingElement;
    const layer = () => [...document.querySelectorAll(".pdfv .textLayer")].find((l) => { const r = l.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    ok("the page's words are there to select", layer() && layer().querySelectorAll("span").length > 300, layer() && layer().querySelectorAll("span").length);
    const frames = async (n, f) => { const gaps = [], hidden = []; let last = 0, i = 0; await new Promise((done) => { const step = (t) => { if (last) gaps.push(t - last); last = t; f(i); const l = layer(); if (i > 1 && l) hidden.push(getComputedStyle(l).visibility === "hidden"); if (++i < n) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); }); gaps.sort((a, b) => a - b); return { median: Math.round(gaps[gaps.length >> 1]), hidden: hidden.every(Boolean) && hidden.length > 0 }; };
    const y0 = sc.scrollTop + 200;
    const s = await frames(60, (i) => { sc.scrollTop = y0 + 150 * Math.sin(i / 8); });
    ok("while the pages are scrolled, their words are not drawn", s.hidden, s);
    await sleep(400);
    ok("… and back when the hand rests", getComputedStyle(layer()).visibility === "visible" && !root.hasAttribute("data-moving"));
    const wheel = () => root.dispatchEvent(new WheelEvent("wheel", { clientX: innerWidth / 2, clientY: innerHeight / 2, deltaY: -30, ctrlKey: true, bubbles: true, cancelable: true }));
    const z = await frames(30, wheel);
    ok("while the pages are zoomed, their words are not drawn", z.hidden, z);
    for (let i = 0; i < 60 && (root.hasAttribute("data-moving") || !layer() || !layer().querySelector("span")); i++) await sleep(100);
    await sleep(600);
    const l = layer(), span = l && [...l.querySelectorAll("span")].find((x) => x.textContent.trim().length > 4);
    ok("drawn anew at the new size, with its words", !!span && getComputedStyle(l).visibility === "visible");
    if (span) {
      const r = document.createRange(); r.selectNodeContents(span); getSelection().removeAllRanges(); getSelection().addRange(r);
      const y = sc.scrollTop; sc.scrollTop = y + 40; await sleep(50);
      ok("chosen words stay drawn while the page moves", getComputedStyle(l).visibility === "visible" && String(getSelection()).length > 4);
      getSelection().removeAllRanges();
    }
    out({ pass: results.every((r) => r.ok), results, scroll: s.median, zoom: z.median, width: innerWidth });
  } catch (e) {
    out({ pass: false, error: String(e && e.stack || e), results });
  }
})();
