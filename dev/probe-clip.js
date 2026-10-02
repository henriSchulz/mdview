/* Development probe (dev/rig.sh clip): what goes through the application's
 * clipboard — Ctrl+Shift+V (text as text), a pasted picture — and a large
 * paste. Works on a copy of tests/fixtures/m4.md; the rig fills the nested
 * session's clipboard. */
(async () => {
  const out = (name, o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const V = MdActive.view, view = V.pm, { TextSelection, NodeSelection } = PM.state;
    const md = () => V.serialize(false);
    const after = (text) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + text.length; }); if (f < 0) throw new Error("not in the document: " + text); return f; };
    const caret = (pos) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    const until = async (cond, ms = 4000) => { for (let t = 0; t < ms && !cond(); t += 50) await sleep(50); return cond(); };
    const paste = (data) => {
      const dt = new DataTransfer();
      for (const [type, value] of Object.entries(data)) dt.setData(type, value);
      view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    };
    V.focus();

    // Ctrl+Shift+V: the application hands the clipboard's text over; it stays text
    caret(after("Paste here."));
    const e = new KeyboardEvent("keydown", { key: "V", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(e, "keyCode", { get: () => 86 });
    view.dom.dispatchEvent(e);
    ok("Ctrl+Shift+V pastes the clipboard's text as text", await until(() => md().includes("Paste here.\\*plain\\* \\[text\\]")), md().slice(150, 260));

    // a picture on the clipboard: saved beside the note, embedded by its name
    out("wantimage", {});
    await sleep(1800);
    caret(after("Typed here."));
    paste({});
    ok("a pasted picture is embedded by its file name", await until(() => /Typed here\.!\[\]\(pasted-\d{8}-\d{6}\.png\)/.test(md())), md().slice(150, 260));
    ok("… and shows", await until(() => { const im = view.dom.querySelector('img[src*="pasted-"]'); return !!im && im.complete && im.naturalWidth === 40; }), view.dom.querySelector('img[src*="pasted-"]')?.outerHTML);
    ok("nothing is embedded as data", !/data:image|base64/.test(md()));

    // an island copied is its Markdown
    let isl = -1;
    view.state.doc.forEach((n, p) => { if (isl < 0 && n.type.name === "table") isl = p; });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, isl)));
    const dt = new DataTransfer();
    view.dom.dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true }));
    ok("a selected table copied is its Markdown as in the file", dt.getData("text/plain") === "| Name  | Qty |\n|-------|----:|\n| apple |   3 |\n| pear  |  12 |", dt.getData("text/plain"));

    // a megabyte of Markdown
    const para = "Lorem *ipsum* dolor sit amet, `consectetur` adipiscing elit, sed do [eiusmod](https://example.com) tempor.\n\n- item one\n- item two\n\n";
    const big = para.repeat(Math.ceil(1048576 / para.length));
    view.dispatch(view.state.tr.setSelection(PM.state.Selection.atEnd(view.state.doc)));
    const before = view.state.doc.childCount, t0 = performance.now();
    paste({ "text/plain": big });
    const ms = Math.round(performance.now() - t0);
    o.bigPasteMs = ms;
    ok("1 MB of Markdown pasted (" + ms + " ms)", view.state.doc.childCount > before + 10000 && ms < 8000, [view.state.doc.childCount, ms]);
    const t1 = performance.now();
    const text = md();
    o.bigSerializeMs = Math.round(performance.now() - t1);
    ok("… and written as it was pasted (" + o.bigSerializeMs + " ms)", text.includes(big.trimEnd()), text.length);
    key: {
      const z = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
      Object.defineProperty(z, "keyCode", { get: () => 90 });
      view.dom.dispatchEvent(z);
    }
    ok("… one undo step", view.state.doc.childCount === before, view.state.doc.childCount);
    await sleep(1200);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("clip", o);
})();
