/* Development probe (dev/rig.sh latex): LaTeX Suite in the formula editor,
 * typed with real keys by the rig (wtype): "mk" and "dm" in the text,
 * snippets, tabstops, auto-fraction, matrix keys, tabout out of the formula.
 * The probe only sets the caret, says when it is ready, and reports what
 * stands in the document and the dialog at each stage. */
(async () => {
  const out = (name, o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { stages: {} }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  try {
    await document.fonts.ready;
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm;
    V.focus();
    const end = PM.state.Selection.atEnd(view.state.doc);
    view.dispatch(view.state.tr.setSelection(end).scrollIntoView());
    const dlg = document.getElementById("dlg");
    o.keys = [];
    document.addEventListener("keyup", (e) => { const i = dlg.querySelector(".ce-in"); o.keys.push(e.key + (i && dlg.hasAttribute("data-open") ? " «" + i.value.slice(Math.max(0, i.selectionStart - 12), i.selectionStart) + "|" + i.value.slice(i.selectionStart, i.selectionStart + 8) + "»" : " (doc)")); }, true);
    const snap = () => ({ md: V.serialize(false), open: dlg.hasAttribute("data-open"), tex: dlg.hasAttribute("data-open") ? (dlg.querySelector(".ce-in") || {}).value : null, w: dlg.offsetWidth, h: dlg.offsetHeight,
      caret: dlg.hasAttribute("data-open") && dlg.querySelector(".ce-in") ? dlg.querySelector(".ce-in").selectionStart : null,
      colours: dlg.querySelectorAll(".ce-b0, .ce-b1, .ce-b2").length, stops: dlg.querySelectorAll(".ce-stop").length, preview: !!dlg.querySelector(".dlg-preview .katex") });
    // the rig types between the stages; each stage is asked for by a file it writes into the page's title
    for (const name of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
      out("ready-" + name, {});
      await sleep(3200); // (the rig types now; it cannot reach into the page, so the time is fixed)
      o.stages[name] = snap();
    }
    await sleep(900);
    o.saved = V.serialize(false);
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  o.errs = errs;
  out("latex", o);
})();
