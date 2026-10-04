/* Development probe (dev/rig.sh zoom): a note larger and smaller with Ctrl or Super and + / −,
 * Ctrl+0 — the note's text only, in every mode; the app around it keeps its size. */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(900);
    MdView.setMode("read"); await sleep(600);
    const line = () => document.querySelector("#content p").getBoundingClientRect().height, bar = () => document.getElementById("toolbar").getBoundingClientRect().width;
    const key = (target, k, more = {}) => { const e = new KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...more }); target.dispatchEvent(e); return e.defaultPrevented; };
    const h0 = line(), b0 = bar(), w0 = innerWidth;
    const held = key(document.body, "+"); await sleep(400);
    ok("Ctrl and +: the note's text is a step larger", held && Math.abs(line() / h0 - 1.1) < 0.03 && window.MdPrefs.docZoom === 110, [line() / h0, window.MdPrefs.docZoom]);
    ok("the toolbar and the window's own size stay as they are", bar() === b0 && innerWidth === w0, [bar(), b0, innerWidth, w0]);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "=", metaKey: true, shiftKey: true, bubbles: true, cancelable: true })); await sleep(400);
    ok("Super and + (typed as Shift+=): the next step", Math.abs(line() / h0 - 1.25) < 0.03, line() / h0);
    key(document.body, "-"); await sleep(400);
    ok("Ctrl and −: a step smaller", Math.abs(line() / h0 - 1.1) < 0.03, line() / h0);
    // the other modes show the same size
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(600);
    const view = MdActive.view.pm, aline = () => view.dom.querySelector("p").getBoundingClientRect().height, text = view.state.doc.textContent;
    ok("the active mode has the same size", Math.abs(aline() / h0 - 1.1) < 0.03, aline() / h0);
    MdActive.view.focus();
    key(view.dom, "+"); await sleep(400);
    ok("with the caret in the text the keys work, and nothing is typed", Math.abs(aline() / h0 - 1.25) < 0.03 && view.state.doc.textContent === text, aline() / h0);
    key(view.dom, "0"); await sleep(400);
    ok("Ctrl+0: its own size again", Math.abs(aline() / h0 - 1) < 0.02 && window.MdPrefs.docZoom === 100, aline() / h0);
    // the settings' choice is the same value
    key(view.dom, ","); await sleep(900);
    const st = document.getElementById("settings"), sel = st.querySelector('.pf-row[data-key="docZoom"] select');
    ok("the settings show it under Appearance", !!sel && sel.value === "100", sel && sel.value);
    sel.value = "150"; sel.dispatchEvent(new Event("change")); await sleep(500);
    ok("chosen there, the note follows at once", Math.abs(aline() / h0 - 1.5) < 0.04, aline() / h0);
    sel.value = "100"; sel.dispatchEvent(new Event("change")); await sleep(400);
    st.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await sleep(400);
  } catch (e) { o.error = String(e && e.stack || e); }
  window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name: "zoom", text: JSON.stringify(o) }));
})();
