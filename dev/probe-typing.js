/* Development probe (dev/rig.sh typing FILE…): how long a keystroke takes in
 * the active mode (transaction, plugins, redraw, layout) and how long writing
 * the document back to Markdown takes. Works on a copy of the file. */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = {};
  try {
    await document.fonts.ready;
    await sleep(600);
    MdView.setMode("active");
    for (let i = 0; i < 400 && !(window.MdActive && MdActive.view && document.body.dataset.view === "active"); i++) await sleep(10);
    const V = MdActive.view, view = V.pm;
    o.file = MdView.core.current.name;
    o.lines = MdView.core.current.text.split("\n").length;
    o.blocks = view.state.doc.childCount;
    // a caret in a text block in the middle of the document
    const spots = [];
    view.state.doc.descendants((n, pos) => { if (n.isTextblock && n.content.size > 20) spots.push(pos + 5); return !n.isTextblock; });
    const at = spots[Math.floor(spots.length / 2)];
    view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, at)).scrollIntoView());
    V.focus();
    await sleep(300);
    const times = [];
    for (const ch of "The quick brown fox jumps over the lazy dog and keeps on typing. ") {
      const t = performance.now();
      const { from, to } = view.state.selection;
      if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) view.dispatch(view.state.tr.insertText(ch, from, to).scrollIntoView()); // (as the editor does for typed text)
      void view.dom.offsetHeight; // layout, as a frame would
      times.push(performance.now() - t);
      await sleep(15);
    }
    times.sort((a, b) => a - b);
    const r1 = (n) => Math.round(n * 10) / 10;
    o.keystrokeMs = { median: r1(times[times.length >> 1]), p95: r1(times[Math.floor(times.length * 0.95)]), max: r1(times[times.length - 1]) };
    let t = performance.now();
    const text = V.serialize();
    o.serializeMs = r1(performance.now() - t);
    t = performance.now();
    V.serialize();
    o.serializeAgainMs = r1(performance.now() - t);
    o.changedLines = text.split("\n").filter((l, i) => l !== MdView.core.current.raw.split("\n")[i]).length;
  } catch (e) { o.error = String(e && e.stack || e); }
  window.MdHost.post(JSON.stringify({ type: "probe", name: "typing", text: JSON.stringify(o) }));
})();
