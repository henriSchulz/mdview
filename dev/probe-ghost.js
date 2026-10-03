/* Development probe (dev/rig.sh ghost): the continuation offered while
 * typing. The model is replaced by a fixed answer (MDVIEW_AI_FAKE), or — with
 * `dev/rig.sh ghost real` — asked for real. Works on a copy of m5.md. */
(async () => {
  const out = (name, o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 25) { if (f()) return t; await sleep(25); } return -1; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const REAL = !!window.__ghostReal;
  try {
    await document.fonts.ready;
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm;
    const md = () => V.serialize(false);
    const type = async (text) => { for (const ch of text) { view.dispatch(view.state.tr.insertText(ch).scrollIntoView()); await sleep(15); } };
    const key = (k, mods = {}) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }); Object.defineProperty(e, "keyCode", { get: () => ({ Tab: 9, Escape: 27, ArrowRight: 39 })[k] || 0 }); view.dom.dispatchEvent(e); return e; };
    const ghost = () => { const g = view.dom.querySelector(".ghost"); return g ? g.textContent : null; };
    const endOf = (text) => { let pos = -1; view.state.doc.descendants((n, p) => { if (n.isTextblock && n.textContent.startsWith(text)) pos = p + n.nodeSize - 1; }); view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, pos)).scrollIntoView()); };
    V.focus();
    endOf("Last paragraph.");

    // off unless switched on
    await type(" It");
    await sleep(700);
    ok("off as it comes: nothing is suggested", ghost() === null);
    post("prefs", { prefs: { aiComplete: true } });
    await sleep(400);
    await type(" was");
    const t = await until(() => ghost() !== null, 9000);
    o.wait = t;
    if (REAL) {
      ok("switched on: in the pause, the model's continuation shows in grey", t >= 0 && ghost().trim().length > 2, [t, ghost()]);
      o.real = { suggestion: ghost(), ms: t };
      out("shown", {}); await sleep(1500);
      key("Tab"); await sleep(100);
      ok("Tab takes it", ghost() === null && md().includes("It was" + o.real.suggestion.trimEnd()), md().slice(-160));
    } else {
      ok("switched on: in the pause, a continuation shows in grey", ghost() === " a good day for writing.", [t, ghost()]);
      ok("… after the pause, not at once", t >= 250 && t < 1500, t);
      ok("it is not part of the note", md().trimEnd().endsWith("Last paragraph. It was"), md().slice(-60));
      out("shown", {}); await sleep(1400);
      // typing what it says keeps it
      await type(" a");
      ok("typing what it says keeps it, shortened", ghost() === " good day for writing.", ghost());
      key("ArrowRight", { ctrlKey: true }); await sleep(60);
      ok("Ctrl+→ takes the next word", ghost() === " day for writing." && md().trimEnd().endsWith("It was a good"), [ghost(), md().slice(-40)]);
      key("Tab"); await sleep(60);
      ok("Tab takes the rest", ghost() === null && md().trimEnd().endsWith("Last paragraph. It was a good day for writing."), md().slice(-70));
      PM.history.undo(view.state, view.dispatch); await sleep(60);
      ok("undo takes back what Tab put in", md().trimEnd().endsWith("It was a good"), md().slice(-40));
      // Esc, and moving away
      await type(" one");
      await until(() => ghost() !== null, 3000);
      ok("it comes again after more typing", ghost() !== null, ghost());
      const e = key("Escape"); await sleep(60);
      ok("Esc dismisses it", ghost() === null && e.defaultPrevented);
      await type(" x");
      await until(() => ghost() !== null, 3000);
      view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, view.state.selection.from - 3))); await sleep(60);
      ok("moving the caret away: gone", ghost() === null);
      // in the middle of a line nothing is offered; nor in code
      await type("y");
      await sleep(800);
      ok("in the middle of a line nothing is suggested", ghost() === null, ghost());
      // Tab without a suggestion is still Tab (a list item goes in)
      post("prefs", { prefs: { aiComplete: false } }); await sleep(300);
    }
    await sleep(900);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  post("prefs", { prefs: { aiComplete: false } });
  await sleep(200);
  out("ghost", o);
})();
