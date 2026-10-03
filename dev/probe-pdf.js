/* Development probe (dev/rig.sh pdf): PDFs in the window — embeds in a note,
 * a link into the PDF, highlights from the links in the notes, a link to a
 * selection, outline, pages, links inside the PDF, back to the note. */
(async () => {
  const out = (name, o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    const content = document.getElementById("content");
    // --- the note: PDFs embedded in it
    const embeds = () => [...content.querySelectorAll(".pdf-embed")];
    ok("the note has its three embeds", embeds().length === 3, embeds().length);
    ok("they are drawn", await until(() => embeds().every((e) => e.classList.contains("ready") && e.querySelector("img"))), embeds().map((e) => e.className + ":" + e.textContent.slice(0, 60)));
    const sizes = embeds().map((e) => { const c = e.querySelector("img"); return c ? [Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)] : null; });
    ok("a whole page is as tall as a page; a selection and a region are cut to what they show", sizes[0] && sizes[0][1] > sizes[0][0] && sizes[1][1] < 120 && sizes[2][1] < sizes[0][1] / 3 && sizes[2][0] < sizes[0][0] * 0.7, sizes);
    out("note", { opacity: getComputedStyle(content).opacity, cls: content.className, y: scrollY, h: document.documentElement.scrollHeight, vis: document.visibilityState }); await sleep(2200);
    ok("a link to a PDF is a link like any other", !!content.querySelector('a.wikilink[data-wiki^="paper.pdf#page=2"]'));

    // --- into the PDF, by the link to a selection
    content.querySelector('a.wikilink[data-wiki^="paper.pdf#page=2"]').click();
    ok("the PDF opens in the window", await until(() => window.MdPdf && MdPdf.shown && MdPdf.shown.pages.length === 6 && MdView.core.current.kind === "pdf"), [MdView.core.current && MdView.core.current.name]);
    const V = MdPdf.shown, T = MdPdf.test;
    ok("on the page the link points to, the selection shown", await until(() => T.pageNow(true) === 2 && V.root.querySelector('.pdf-page[data-page="2"] .pdf-focus')), T.pageNow(true));
    const page = (n) => V.root.querySelector(`.pdf-page[data-page="${n}"]`);
    ok("the page has its picture and its text", await until(() => page(2).querySelector("canvas") && page(2).querySelectorAll(".textLayer [data-i]").length > 20));
    const marks2 = () => [...page(2).querySelectorAll(".pdf-backlink")];
    ok("the links in the notes show as highlights, in their colours", marks2().length === 2 && marks2().some((m) => m.style.getPropertyValue("--hl") === "#ea5252") && marks2().some((m) => m.style.getPropertyValue("--hl") === "#ffd000"), marks2().map((m) => m.style.getPropertyValue("--hl")));
    {
      const span = page(2).querySelector('.textLayer [data-i="4"]').getBoundingClientRect(), m = marks2().find((x) => x.style.getPropertyValue("--hl") === "#ea5252").getBoundingClientRect();
      ok("a highlight lies on its text", Math.abs(m.left - span.left) < 4 && Math.abs(m.top - span.top) < 8 && m.width > 40 && m.width < span.width, [m.left, span.left, m.top, span.top, m.width, span.width]);
    }
    ok("the mode buttons do not turn a PDF into text", (MdView.setMode("active"), document.body.dataset.view || "read") === "read");
    out("pdf", {}); await sleep(1300);

    // --- a link to a selection
    {
      const sp = page(2).querySelector('.textLayer [data-i="7"]'), r = new Range();
      r.setStart(sp.firstChild, 5); r.setEnd(sp.firstChild, 21);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      const at = T.selectionNow();
      ok("the selection as a place in the PDF", at && at.page === 2 && at.selection.join() === "7,5,7,21" && at.text === sp.textContent.slice(5, 21), at);
      const l = T.linkText(at, "red");
      ok("its link", l.linkWithDisplay === "[[paper.pdf#page=2&selection=7,5,7,21&color=red|paper, page 2]]" && T.linkText(at, "yellow").link === "[[paper.pdf#page=2&selection=7,5,7,21]]", l);
      window.__copied = null;
      out("select", {}); await sleep(2600); // the rig presses Ctrl+Shift+C and reads the clipboard
      ok("copied: shown as a highlight at once", page(2).querySelectorAll(".pdf-backlink.fresh").length === 1 && getSelection().isCollapsed, page(2).querySelectorAll(".pdf-backlink.fresh").length);
    }
    // two lines selected
    {
      const a = page(2).querySelector('.textLayer [data-i="10"]'), b = page(2).querySelector('.textLayer [data-i="11"]'), r = new Range();
      r.setStart(a.firstChild, 8); r.setEnd(b.firstChild, 6);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      const at = T.selectionNow();
      ok("a selection over two lines", at && at.selection.join() === "10,8,11,6" && at.text.startsWith("f page 2:") && at.text.endsWith(". Line 1"), at);
      s.removeAllRanges();
    }

    // --- zoom, pages, outline, links inside the PDF
    const w0 = page(2).getBoundingClientRect().width;
    T.act("in"); await sleep(300);
    ok("zoom in: the page grows, stays the page on screen", page(2).getBoundingClientRect().width > w0 * 1.1 && T.pageNow(true) === 2, [w0, page(2).getBoundingClientRect().width, T.pageNow(true)]);
    T.zoomTo("width"); await sleep(300);
    ok("fit width again", Math.abs(page(2).getBoundingClientRect().width - w0) < 16, [w0, page(2).getBoundingClientRect().width, V.box.clientWidth, V.scale]);
    await until(() => V.outline);
    T.sidePanel("outline"); await sleep(200);
    const items = [...V.side.querySelectorAll(".pdf-out")];
    ok("the outline lists the chapters", items.length === 6 && items[3].textContent === "Chapter 4", items.map((i) => i.textContent));
    items[3].click();
    ok("a click goes to the chapter", await until(() => T.pageNow(true) === 4), T.pageNow(true));
    T.sidePanel("pages");
    ok("the pages as small pictures", await until(() => V.side.querySelectorAll(".pdf-thumb canvas").length >= 3) && V.side.querySelectorAll(".pdf-thumb").length === 6, V.side.querySelectorAll(".pdf-thumb canvas").length);
    V.side.querySelector('.pdf-thumb[data-page="1"]').click();
    ok("a click on one goes to the page", await until(() => T.pageNow(true) === 1), T.pageNow(true));
    ok("the link inside the PDF is there", await until(() => page(1).querySelector(".pdf-link")));
    page(1).querySelector(".pdf-link").click();
    ok("… and goes to its chapter", await until(() => T.pageNow(true) === 3), T.pageNow(true));
    T.act("back");
    ok("back: where one was", await until(() => T.pageNow(true) === 1), T.pageNow(true));
    T.sidePanel("notes"); await sleep(150);
    const notes = [...V.side.querySelectorAll(".pdf-note")];
    ok("the notes that link here are listed, with their text", notes.length === 6 && notes.some((n) => n.textContent.includes("An important line: says it.")) && notes.some((n) => n.textContent.includes("Line 10 of page 2")), notes.map((n) => n.textContent.slice(0, 50)));

    // --- from a highlight back to the note, at the link
    T.go(2); await until(() => marks2().length >= 2);
    const m = marks2().find((x) => x.style.getPropertyValue("--hl") === "#ea5252").getBoundingClientRect();
    page(2).querySelector(".textLayer").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: m.left + 5, clientY: m.top + 4 }));
    ok("a double click on a highlight opens its note", await until(() => MdView.core.current && MdView.core.current.name === "note.md" && !document.querySelector(".pdfv")), MdView.core.current && MdView.core.current.name);
    ok("… with its embeds drawn again", await until(() => embeds().length === 3 && embeds().every((e) => e.classList.contains("ready"))));
    window.scrollTo(0, 0);
    embeds()[1].scrollIntoView({ block: "start" }); window.scrollBy(0, -90);
    out("noteagain", { rects: embeds().map((e) => { const r = e.getBoundingClientRect(), c = e.querySelector("img"); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), c && c.width, c && c.height]; }), dpr: devicePixelRatio, w: innerWidth });
    await sleep(1500);
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  o.errs = errs;
  out("pdfdone", o);
})();
