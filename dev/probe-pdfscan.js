/* Development probe (dev/rig.sh pdfscan): a scan at 1200 dpi — pages of one picture each, one bit a pixel, 135 million pixels
 * a page. pdf.js took such a picture as large as it is (630 MB a page as the browser holds it, in the GPU's memory where it
 * draws with it): four pages of one held 13 GB and the whole session went down (#44, Henri: „gerade gab es einen absturz.
 * ich glaube im zusammenhang mit einer laggy pdf in mdview“). Every picture made for the pages is counted — bitmaps, canvases
 * on and off the screen — none may be much larger than the page is drawn, and the page is drawn, sharp enough to read.
 * Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  const out = (o) => window.MdHost.post(JSON.stringify({ type: "probe", name: "pdfscan", text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const ok = (name, cond, detail) => results.push({ name, ok: !!cond, ...(cond ? {} : { detail }) });
  // (installed before pdf.js is loaded: it is loaded when the PDF is first shown)
  const made = [], note = (what, w, h) => made.push([what, w, h]);
  const cib = window.createImageBitmap;
  window.createImageBitmap = function (...a) { const p = cib.apply(this, a); p.then((b) => note("bitmap", b.width, b.height), () => {}); return p; };
  const OC = window.OffscreenCanvas;
  if (OC) { window.OffscreenCanvas = function (w, h) { note("offscreen", w, h); return new OC(w, h); }; window.OffscreenCanvas.prototype = OC.prototype; }
  const tall = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height");
  Object.defineProperty(HTMLCanvasElement.prototype, "height", { configurable: true, get() { return tall.get.call(this); }, set(v) { tall.set.call(this, v); note("canvas", this.width, v); } });
  try {
    const drawn = () => [...document.querySelectorAll(".pdfv canvas")].find((c) => c.width > 100 && c.height > 100);
    for (let i = 0; i < 300 && !drawn(); i++) await sleep(100);
    await sleep(3000);
    const c = drawn();
    ok("the scan's page is drawn", !!c);
    if (c) {
      // the thick bar across the top of the page: black where it is, white beside it
      const g = c.getContext("2d"), at = (fx, fy) => g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data[0];
      const bar = 650 / 13200;
      ok("what is black on the scan is black on the screen", at(0.5, bar) < 60, at(0.5, bar));
      ok("… and white white", at(0.5, 0.3) > 200, at(0.5, 0.3));
    }
    const px = made.map(([, w, h]) => w * h), most = Math.max(0, ...px), largest = made[px.indexOf(most)];
    ok("no picture made for the scan larger than 17 million pixels (the scan is 135 million)", most <= 17e6, largest);
    const bitmaps = made.filter(([what]) => what === "bitmap");
    ok("the scan is taken at 300 dpi or so, not less", bitmaps.length && Math.max(...bitmaps.map(([, w]) => w)) >= 2400, bitmaps);
    out({ pass: results.every((r) => r.ok), results, made: made.filter(([, w, h]) => w * h > 4e6) });
  } catch (e) {
    out({ pass: false, error: String((e && e.stack) || e), results });
  }
})();
