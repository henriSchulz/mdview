/* Development probe (dev/rig.sh cut): text and a picture of svg, cut together and put in elsewhere —
 * selected as text across them, and selected as blocks. Both arrive. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(900); MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, view = A.view.pm, S = PM.state, md = () => A.view.serialize(false);
    const posOf = (test) => { let at = -1; view.state.doc.forEach((n, p) => { if (at < 0 && test(n)) at = p; }); return at; };
    const SVG = '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="120"><rect width="120" height="60" fill="teal"/></svg>\n```';
    // what a cut puts on the clipboard, and that put in at the note's end
    const cutPaste = async () => {
      const dt = new DataTransfer();
      view.dom.dispatchEvent(new ClipboardEvent("cut", { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(200);
      const gone = md();
      view.dispatch(view.state.tr.setSelection(S.Selection.atEnd(view.state.doc)));
      const dt2 = new DataTransfer(); dt2.setData("text/plain", dt.getData("text/plain")); dt2.setData("text/html", dt.getData("text/html"));
      view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt2, bubbles: true, cancelable: true }));
      await sleep(300);
      return { gone, text: dt.getData("text/plain"), html: dt.getData("text/html") };
    };
    // selected as blocks: the paragraph before the picture, and the picture
    A.blocks.select(view, posOf((n) => n.textContent.includes("Before the picture")), false);
    A.blocks.select(view, posOf((n) => n.type.name === "island" && n.attrs.kind !== "frontmatter"), true);
    let c = await cutPaste();
    ok("blocks — a paragraph and a picture of svg — cut: both are gone from where they stood", !c.gone.includes("Before the picture") && !c.gone.includes("<svg"), c.gone);
    ok("… and put in elsewhere, both arrive: the text and the picture", md().trimEnd().endsWith("Before the picture here.\n\n" + SVG) && (md().match(/<svg/g) || []).length === 1 && !!view.dom.querySelector(".svg-block svg, .isl svg"), [md(), c.html.slice(0, 200)]);
    // selected as text, from inside one paragraph across the picture into the next
    const isl = posOf((n) => n.type.name === "island" && n.attrs.kind !== "frontmatter");
    view.dispatch(view.state.tr.setSelection(S.TextSelection.create(view.state.doc, isl - 6, isl + 1)));
    c = await cutPaste();
    ok("text and the picture selected as text, cut and put in: both arrive", (md().match(/<svg/g) || []).length === 1 && md().trimEnd().endsWith(SVG) && /here\.\n\n```svg/.test(md().slice(-220)), [md(), c.text]);
    // ---- a picture pressed and pulled: the block moves, and no text gets selected on the way
    {
      const at = posOf((n) => n.type.name === "island" && n.attrs.kind !== "frontmatter"), dom = view.nodeDOM(at), r = dom.getBoundingClientRect();
      const last = view.nodeDOM(posOf((n) => n.type.name === "paragraph")), lr = last.getBoundingClientRect(); // (the first paragraph: the picture stands further down)
      const m = (type, x, y, buttons = 1) => { const t = document.elementFromPoint(x, y) || document.body, ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons, detail: 1 }); t.dispatchEvent(ev); return ev; };
      const x = r.left + r.width / 2, y = r.top + r.height / 2, before = md();
      m("mousedown", x, y);
      const seen = [];
      for (let i = 1; i <= 12; i++) { const yy = y + ((lr.top + 2 - y) * i) / 12 - (i === 12 ? 0 : 0); const ev = m("mousemove", x - 40, yy); seen.push([ev.defaultPrevented, String(getSelection()).length, view.state.selection.empty]); await sleep(30); }
      m("mouseup", x - 40, lr.top + 2, 0);
      await sleep(400);
      const t = md(), iSvg = t.indexOf("<svg"), iAfter = t.indexOf("After the picture");
      ok("a picture of svg pressed and pulled upward past a paragraph: it stands above it now", t !== before && (t.match(/<svg/g) || []).length === 1 && t.length === before.length, [before, t]);
      ok("… and on the way no text was selected", seen.slice(2).every((x) => x[0] && x[1] === 0) && String(getSelection()) === "", seen);
      ok("… what was moved is selected as a block, as after its handle", !!A.blocks.selection(view.state), A.blocks.selection(view.state));
      // a press let go where it was is still a click
      const dom2 = view.nodeDOM(posOf((n) => n.type.name === "island" && n.attrs.kind !== "frontmatter")), r2 = dom2.getBoundingClientRect(), c = t;
      m("mousedown", r2.left + 20, r2.top + 10); m("mouseup", r2.left + 20, r2.top + 10, 0);
      await sleep(200);
      ok("a press let go where it was moves nothing", md() === c, md());
    }
  } catch (e) { o.error = String(e && e.stack || e); }
  out("cut", o);
})();
