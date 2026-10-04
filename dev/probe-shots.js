/* Development probe (dev/rig.sh shots): the newer parts of the active mode,
 * one after the other, for looking at (the rig takes a screenshot at each
 * step). Works on a copy of tests/fixtures/shots.md; nothing is checked. */
(async () => {
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => { await sleep(500); post("probe", { name: "shot-" + name, text: "{}" }); await sleep(1500); };
  const o = {};
  try {
    await document.fonts.ready;
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(400);
    const A = MdActive, V = A.view, view = V.pm, { TextSelection } = PM.state;
    const dlg = document.getElementById("dlg");
    const key = (target, k, mods = {}) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }); Object.defineProperty(e, "keyCode", { get: () => ({ Enter: 13, Escape: 27 })[k] || k.toUpperCase().charCodeAt(0) }); target.dispatchEvent(e); };
    const island = (kind) => { let f = -1; view.state.doc.forEach((n, p) => { if (f < 0 && n.type.name === "island" && n.attrs.kind === kind) f = p; }); return f; };
    const pos = (text) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + text.length; }); return f; };
    const at = (kind, x, y) => post("probe-pointer", { kind, x, y });
    V.focus();
    // properties as a form
    A.islands.open(view, island("frontmatter")); await shot("form");
    key(dlg, "Escape"); await sleep(400);
    // the formula dialog, with a search in its editor
    A.islands.open(view, island("math")); await sleep(500);
    await shot("formula");
    const t = dlg.querySelector(".ce-in");
    t.focus(); t.setSelectionRange(t.value.length, t.value.length);
    document.execCommand("insertText", false, " \\s"); await shot("completion");
    key(t, "Escape");
    key(t, "f", { ctrlKey: true }); await sleep(100);
    const field = dlg.querySelector(".ce-find input"); field.value = "a"; field.dispatchEvent(new Event("input")); await shot("find");
    key(field, "Escape"); key(dlg, "Escape"); await sleep(400);
    // a block's handle, and the line while it is dragged
    const para = [...view.dom.children].find((p) => p.textContent.startsWith("A paragraph to move"));
    const r = para.getBoundingClientRect();
    at("move", r.left + 30, r.top + 8); await sleep(300);
    await shot("blockhandle");
    const h = document.querySelector(".blk-h"), dt = new DataTransfer();
    h.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const target = [...view.dom.children].find((p) => p.textContent.startsWith("End."));
    const tr = target.getBoundingClientRect();
    view.dom.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: tr.left + 10, clientY: tr.top + 2, dataTransfer: dt }));
    await shot("dropline");
    h.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    view.dom.dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
    // a table row dragged
    const pear = [...view.dom.querySelectorAll("td")].find((c) => c.textContent === "pear"), apple = [...view.dom.querySelectorAll("td")].find((c) => c.textContent === "apple");
    const pr = pear.getBoundingClientRect(), ar = apple.getBoundingClientRect();
    at("move", pr.left + 6, pr.top + 6); await sleep(300);
    const hr = document.querySelector(".tbl-h-row").getBoundingClientRect();
    at("down", hr.left + 6, hr.top + 13); await sleep(80);
    at("move", hr.left + 6, ar.top + 8); await sleep(80);
    at("move", hr.left + 6, ar.top + 4); await shot("rowdrag");
    at("move", hr.left + 6, pr.top + 13); await sleep(80);
    at("up", hr.left + 6, pr.top + 13); await sleep(300);
    // Markdown at the caret
    window.MdPrefs = { ...window.MdPrefs, syntax: true };
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("bold wo"))));
    await shot("syntax");
    window.MdPrefs = { ...window.MdPrefs, syntax: false };
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  post("probe", { name: "shots", text: JSON.stringify(o) });
})();
