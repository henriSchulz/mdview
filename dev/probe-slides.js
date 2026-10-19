/* Development probe (dev/rig.sh slides): a presentation in a folder — its tile in All Notes is a presentation with its first
 * slide on it, a click shows it in the PDF viewer (every slide a page, read only), and one LibreOffice cannot read says so.
 * The folder: Deck.pptx (12 slides, made by the rig), Broken.pptx (the start of a zip, and no more), Note.md. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const until = async (f, ms = 4000) => { for (let t = 0; t < ms; t += 50) { if (f()) return true; await sleep(50); } return !!f(); };
  try {
    await document.fonts.ready;
    await until(() => window.MdOverview && MdOverview.isOpen && document.querySelector("#overview .ov-tile"), 8000);
    await sleep(600);
    const ov = document.getElementById("overview"), tile = (name) => ov.querySelector(`.ov-item[data-path$="/${name}"]`);
    const deck = tile("Deck.pptx");
    ok("a presentation has a tile of its own: a presentation", !!deck && deck.dataset.kind === "slides" && deck.querySelector(".ov-sub")?.textContent === "Presentation", deck && [deck.dataset.kind, deck.querySelector(".ov-sub")?.textContent]);
    await until(() => tile("Deck.pptx")?.querySelector(".ov-pic img.on"), 60000);
    const img = tile("Deck.pptx")?.querySelector(".ov-pic img");
    ok("… with its first slide on it (made by LibreOffice)", !!img && img.naturalWidth > img.naturalHeight, img && [img.naturalWidth, img.naturalHeight]);
    out("shot-tile", {}); await sleep(1300);
    tile("Deck.pptx").click();
    await until(() => document.querySelectorAll("#content .pdf-page").length > 0, 60000);
    await sleep(800);
    const pages = document.querySelectorAll("#content .pdf-page").length;
    ok("a click shows it in the PDF viewer, a page for every slide", !MdOverview.isOpen && pages === 12, [MdOverview.isOpen, pages]);
    ok("… read only, as a presentation", MdView.core.current?.readonly === "a presentation", MdView.core.current?.readonly);
    await until(() => document.querySelector("#content .pdf-page canvas, #content .pdf-page img"), 8000);
    out("shot-viewer", {}); await sleep(1300);
    window.MdHost.post(JSON.stringify({ type: "note", path: MdView.core.folder.root + "/Broken.pptx" }));
    await until(() => /can't be shown/.test(document.querySelector("#content .pdfv")?.textContent || ""), 60000);
    ok("a presentation LibreOffice cannot read: it says so", /This presentation can't be shown/.test(document.querySelector("#content .pdfv")?.textContent || ""), document.querySelector("#content .pdfv")?.textContent.slice(0, 160));
  } catch (e) { o.error = String(e && e.stack || e); }
  out("slides", o);
})();
