/* Development probe (dev/rig.sh perf FILE…): the figures of the spec's
 * performance table, measured in the running app on a copy of the file —
 * mode change, a keystroke, opening a dialog, the formula preview, writing
 * the document back — and whether a hundred dialogs or thirty quick mode
 * changes leave anything behind. */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const r1 = (n) => Math.round(n * 10) / 10;
  const stats = (times) => { times.sort((a, b) => a - b); return { median: r1(times[times.length >> 1]), p95: r1(times[Math.floor(times.length * 0.95)]), max: r1(times[times.length - 1]) }; };
  const o = {};
  try {
    await document.fonts.ready;
    await sleep(800);
    const original = MdView.core.current.raw;
    o.file = MdView.core.current.name;
    o.lines = original.split("\n").length;
    let t = performance.now();
    MdView.setMode("active");
    for (let i = 0; i < 2000 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    o.firstActiveMs = r1(performance.now() - t); // with loading the editor's code
    const A = MdActive, V = A.view, view = V.pm;
    o.blocks = view.state.doc.childCount;
    o.hint = /Large document/.test(document.getElementById("toast")?.textContent || ""); // said for very large files
    await sleep(500);
    // --- changing the mode (the document already built: what a change of mode costs from then on)
    const sw = { toRead: [], toActive: [] };
    for (let i = 0; i < 5; i++) {
      t = performance.now(); MdView.setMode("read"); void document.body.offsetHeight; sw.toRead.push(performance.now() - t);
      await frame(); await sleep(120);
      t = performance.now(); MdView.setMode("active"); void document.body.offsetHeight; sw.toActive.push(performance.now() - t);
      await frame(); await sleep(120);
    }
    o.toReadMs = stats(sw.toRead);
    o.toActiveMs = stats(sw.toActive);

    // --- a keystroke in the middle of the document
    const spots = [];
    view.state.doc.descendants((n, pos) => { if (n.type.name === "paragraph" && n.content.size > 20) spots.push(pos + 5); return !n.isTextblock; });
    const at = spots[Math.floor(spots.length / 2)];
    view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, at)).scrollIntoView());
    V.focus();
    await sleep(400);
    const keys = [];
    for (const ch of "The quick brown fox jumps over the lazy dog and keeps on typing. ") {
      t = performance.now();
      const { from, to } = view.state.selection;
      if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) view.dispatch(view.state.tr.insertText(ch, from, to).scrollIntoView()); // (as the editor does for typed text)
      void view.dom.offsetHeight; // layout, as a frame would
      keys.push(performance.now() - t);
      await sleep(15);
    }
    o.keystrokeMs = stats(keys);
    t = performance.now();
    const text = V.serialize();
    o.serializeMs = r1(performance.now() - t);
    o.changedLines = text.split("\n").filter((l, i) => l !== original.split("\n")[i]).length;
    const z = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(z, "keyCode", { get: () => 90 });
    for (let i = 0; i < 80 && V.serialize(false) !== original.replace(/\r\n/g, "\n"); i++) view.dom.dispatchEvent(z);
    o.undone = V.serialize() === original;

    // --- back to reading after an edit: the reading view has to be drawn again
    {
      const { from } = view.state.selection;
      view.dispatch(view.state.tr.insertText("Q", from).scrollIntoView());
      await sleep(50);
      t = performance.now(); MdView.setMode("read"); void document.body.offsetHeight; o.toReadAfterEditMs = r1(performance.now() - t);
      await frame(); await sleep(300);
      t = performance.now(); MdView.setMode("active"); void document.body.offsetHeight; o.toActiveAfterEditMs = r1(performance.now() - t);
      await frame(); await sleep(300);
      view.dispatch(view.state.tr.delete(from, from + 1));
      MdView.flush();
      await sleep(400);
      o.restored = V.serialize() === original;
    }

    // --- a dialog: until it can be typed in; the formula preview per keystroke
    const first = (kind) => { let p = -1; view.state.doc.forEach((n, pos) => { if (p < 0 && n.type.name === "island" && n.attrs.kind === kind && pos > at) p = pos; }); if (p < 0) view.state.doc.forEach((n, pos) => { if (p < 0 && n.type.name === "island" && n.attrs.kind === kind) p = pos; }); return p; };
    const dlg = document.getElementById("dlg");
    const esc = () => { const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); dlg.dispatchEvent(e); };
    const code = first("code"), math = first("math");
    if (code >= 0) {
      view.nodeDOM(code).scrollIntoView({ block: "center" });
      await sleep(200);
      const opens = [];
      for (let i = 0; i < 5; i++) {
        t = performance.now(); A.islands.open(view, code); void dlg.offsetHeight; opens.push(performance.now() - t);
        o.dialogFocused = document.activeElement === dlg.querySelector(".ce-in");
        await sleep(350); esc(); await sleep(350);
      }
      o.dialogOpenMs = stats(opens);
      // a hundred dialogs: nothing may stay behind
      const count = () => document.getElementsByTagName("*").length;
      const before = count();
      for (let i = 0; i < 100; i++) { A.islands.open(view, code); await sleep(10); esc(); await sleep(10); }
      await sleep(500);
      o.dialogs100 = { nodesBefore: before, nodesAfter: count() };
    }
    if (math >= 0) {
      view.nodeDOM(math).scrollIntoView({ block: "center" });
      await sleep(200);
      A.islands.open(view, math);
      await sleep(400);
      const ed = dlg.querySelector(".ce-in"), pv = [];
      for (const ch of " + \\frac{x^2}{\\sqrt{y}} + \\sum_{i=0}^{n} a_i") {
        ed.value += ch;
        t = performance.now(); ed.dispatchEvent(new Event("input")); void dlg.offsetHeight; pv.push(performance.now() - t);
        await sleep(20);
      }
      o.formulaPreviewMs = stats(pv);
      esc(); await sleep(350);
    }

    // --- thirty quick changes of mode, ten a second
    const nodes = document.getElementsByTagName("*").length;
    const errors = [];
    const onError = (e) => errors.push(String(e.message || e.reason));
    window.addEventListener("error", onError); window.addEventListener("unhandledrejection", onError);
    const order = ["read", "active", "edit", "active", "read", "edit"];
    for (let i = 0; i < 30; i++) { MdView.setMode(order[i % order.length]); await sleep(100); }
    MdView.setMode("active");
    await sleep(700);
    const once = document.getElementsByTagName("*").length; // (the source editor's lines are there now)
    for (let i = 0; i < 30; i++) { MdView.setMode(order[i % order.length]); await sleep(100); }
    MdView.setMode("active");
    await sleep(700);
    window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onError);
    o.quickModes = { errors, textKept: MdView.core.current.text === original.replace(/\r\n/g, "\n") && V.serialize() === original, view: document.body.dataset.view, nodesAfter30: once, nodesAfter60: document.getElementsByTagName("*").length };
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  window.MdHost.post(JSON.stringify({ type: "probe", name: "perf", text: JSON.stringify(o) }));
})();
