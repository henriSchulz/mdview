/* Development probe (screenshots of a look, no checks): a note with the sidebar pinned and shut, a selection with the
 * formatting bar, the "/" menu filtered by "tab", the assistant, find, All Notes — laid beside the Velum lab's
 * ~/Projects/velum/lab/web/mdview.html (proposals A Refined, B Home, C Focus). Each "shot-…" is a moment the rig takes a picture. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { shots: [] };
  const shot = async (name) => { await sleep(1500); o.shots.push(name); out("shot-" + name, {}); await sleep(1200); };
  const side = () => document.querySelector('#tabs [data-act="sidebar"], #toolbar [data-act="sidebar"]')?.click();
  const esc = () => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  try {
    await document.fonts.ready; await sleep(1500);
    const root = window.MdView.core.folder && window.MdView.core.folder.root;
    window.MdHost.post(JSON.stringify({ type: "note", path: root + "/Uni/Analysis II/Fourier Series.md" }));
    await sleep(1500);
    if (document.body.dataset.sidebar !== "open") side();
    await shot("note");
    side(); await shot("note-wide"); side(); await sleep(600);
    // the active mode: a selection, then "/" filtered by "tab"
    window.MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(500);
    const A = MdActive, view = A.view.pm, { TextSelection } = PM.state;
    const at = (text, end = true) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + (end ? text.length : 0); }); return f; };
    A.view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at("The coefficients", false), at("frequency"))));
    await shot("select");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at("itself."))));
    const type = (text) => { for (const ch of text) { const { from, to } = view.state.selection; if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) view.dispatch(view.state.tr.insertText(ch, from, to)); } };
    type(" /tab"); await shot("slash");
    esc(); await sleep(300);
    window.MdView.setMode("read"); await sleep(1200);
    // the assistant, find
    document.querySelector("#ai-bubble")?.click(); await shot("ai");
    esc(); await sleep(500);
    document.querySelector('#toolbar [data-act="find"]')?.click(); await sleep(300);
    const f = document.querySelector("#findbar input"); if (f) { f.value = "series"; f.dispatchEvent(new Event("input", { bubbles: true })); }
    await shot("find");
    esc(); await sleep(400);
    document.querySelector('#tabs [data-act="overview"], #toolbar [data-act="overview"]')?.click();
    await new Promise((r) => setTimeout(r, 800)); document.getElementById("overview").scrollTop = 0;
    await shot("home");
    document.getElementById("overview").scrollTop = 1e5;
    await shot("home-low");
  } catch (e) { o.error = String(e && e.stack || e); }
  out("refined", o);
})();
