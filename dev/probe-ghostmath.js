/* Development probe (dev/rig.sh ghostmath): a suggestion that closes a formula — taken, it is a
 * formula, not text between dollars. The model is a fixed answer (MDVIEW_AI_FAKE). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const V = MdActive.view, view = V.pm;
    const type = async (text) => { for (const ch of text) { view.dispatch(view.state.tr.insertText(ch).scrollIntoView()); await sleep(15); } };
    const ghost = () => { const g = view.dom.querySelector("[data-ghost]"); return g ? g.dataset.ghost : null; };
    V.focus();
    view.dispatch(view.state.tr.setSelection(PM.state.Selection.atEnd(view.state.doc)));
    post("prefs", { prefs: { aiComplete: true } });
    await sleep(400);
    await type(" The sum $a +");
    for (let t = 0; t < 9000 && ghost() === null; t += 25) await sleep(25);
    ok("a continuation that closes the formula is offered", ghost() === " b$ is known.", ghost());
    view.dom.dispatchEvent(Object.defineProperty(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }), "keyCode", { get: () => 9 }));
    await sleep(400);
    let math = null;
    view.state.doc.descendants((n) => { if (n.type.name === "iatom" && n.attrs.kind === "math") math = n.attrs.raw; });
    ok("taken, it is a formula", math === "$a + b$", [math, V.serialize(false).slice(-60)]);
    ok("and what followed it is text behind it", /\$a \+ b\$ is known\.\n?$/.test(V.serialize(false)), V.serialize(false).slice(-60));
    post("prefs", { prefs: { aiComplete: false } });
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("ghostmath", o);
})();
