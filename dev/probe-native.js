/* Development probe (dev/rig.sh native): the browser's own typing path in the
 * active mode — characters, spaces at the end of a line and in a row,
 * deleting, a hard break — and that putting the caret into a block moves
 * nothing. Works on a copy of tests/fixtures/editing.md. */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(800);
    MdView.setMode("active");
    for (let i = 0; i < 200 && !(window.MdActive && MdActive.view && document.body.dataset.view === "active"); i++) await sleep(10);
    const V = MdActive.view, view = V.pm, { TextSelection } = PM.state;
    const original = MdView.core.current.raw;
    const find = (text) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + text.length; }); return f; };
    const rects = () => [...view.dom.querySelectorAll("p, h1, li, blockquote")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top * 10), Math.round(r.height * 10)].join(); }).join("|");
    view.dom.blur();
    await sleep(100);
    const rest = rects();
    V.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, find("soft break"))));
    await sleep(150);
    o.focused = document.activeElement === view.dom;
    ok("the editor has the focus", o.focused);
    ok("focusing a paragraph moves nothing", rects() === rest);
    // the browser's own typing path: characters, a space at the end, two spaces, then more text
    const para = () => view.state.selection.$from.parent.textContent;
    document.execCommand("insertText", false, "X");
    await sleep(60);
    ok("native typing reaches the document", para().includes("soft breakX"), para());
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.$from.end())));
    for (const ch of " word") { document.execCommand("insertText", false, ch); await sleep(30); }
    ok("a space typed at the end of a block, then a word", para().endsWith("in it. word"), para());
    for (const ch of "  two") { document.execCommand("insertText", false, ch); await sleep(30); }
    ok("two spaces stay two plain spaces", para().endsWith("word  two"), JSON.stringify(para().slice(-12)));
    ok("no no-break space got in", !/ /.test(view.state.doc.textContent));
    document.execCommand("insertText", false, " ");
    await sleep(60);
    ok("a trailing space is in the model", para().endsWith("two "), JSON.stringify(para().slice(-6)));
    ok("… and not in the file", !/ \n/.test(V.serialize(false)) , V.serialize(false).split("\n")[3]);
    // native delete
    document.execCommand("delete");
    document.execCommand("delete");
    await sleep(60);
    ok("native backspace", para().endsWith("tw"), JSON.stringify(para().slice(-6)));
    // Shift+Enter: a hard break, written with the backslash form
    const e = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(e, "keyCode", { get: () => 13 });
    view.dom.dispatchEvent(e);
    document.execCommand("insertText", false, "n");
    await sleep(60);
    ok("Shift+Enter is a hard break", /tw\\\nn/.test(V.serialize(false)), V.serialize(false).split("\n").slice(2, 6));
    // click position: the editor finds the place under the pointer
    const h = view.dom.querySelector("li");
    const r = h.getBoundingClientRect();
    const hit = view.posAtCoords({ left: r.left + 12, top: r.top + r.height / 2 });
    ok("a point in a list item maps into it", hit && view.state.doc.resolve(hit.pos).parent.textContent === "one", hit);
    o.text = V.serialize(false).split("\n").slice(0, 7);
  } catch (e) { o.error = String(e.stack || e); }
  window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name: "native", text: JSON.stringify(o) }));
})();
