/* Development probe (dev/rig.sh link): the link popover in the active mode —
 * it shows under a link the caret rests in, edits text and address, keeps a
 * reference link a reference by changing its definition, makes a new link
 * over a selection, removes one. Works on a copy of tests/fixtures/editing.md. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(800);
    MdView.setMode("active");
    for (let i = 0; i < 200 && !(window.MdActive && MdActive.view && document.body.dataset.view === "active"); i++) await sleep(10);
    const V = MdActive.view, view = V.pm, { TextSelection } = PM.state;
    const pop = document.getElementById("linkpop");
    const md = () => V.serialize(false);
    const find = (text) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + text.length; }); return f; };
    const caret = (a, b = a) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a, b)));
    const key = (target, k, mods = {}) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }); Object.defineProperty(e, "keyCode", { get: () => (k === "Enter" ? 13 : k === "Escape" ? 27 : k.toUpperCase().charCodeAt(0)) }); target.dispatchEvent(e); };
    const open = () => pop.hasAttribute("data-open");
    V.focus();

    caret(find("Last"));
    await sleep(600);
    ok("no popover outside a link", !open());
    caret(find("referen"));
    ok("it waits before it shows", !open());
    await sleep(650);
    ok("the caret resting in a link shows its address", open() && pop.dataset.kind === "info" && pop.querySelector(".lp-url").textContent === "https://example.com", pop.outerHTML.slice(0, 200));
    const r = pop.getBoundingClientRect(), a = view.coordsAtPos(find("referen"));
    ok("it sits under the link", r.top >= a.bottom && r.top - a.bottom < 16 && r.left <= a.left, [r.top, a.bottom, r.left, a.left]);
    out("info", {});
    await sleep(1600); // screenshot

    // edit: the address of a reference link changes in its definition
    pop.querySelector('[data-do="edit"]').click();
    await sleep(350);
    const fields = () => pop.querySelectorAll("input");
    ok("Edit opens the form with text and address", open() && pop.dataset.kind === "form" && fields()[0].value === "reference" && fields()[1].value === "https://example.com");
    out("form", {});
    await sleep(1600); // screenshot
    fields()[1].value = "https://example.net/new";
    key(fields()[1], "Enter");
    await sleep(100);
    ok("a reference link stays one; its definition has the new address", md().includes("A [reference][ref] here.") && md().includes("[ref]: https://example.net/new"), md().split("\n").slice(-6));
    ok("the form is closed, the editor has the focus again", !open() && view.hasFocus());

    // Ctrl+K over a selection: a new link
    caret(find("Last ") , find("Last paragraph"));
    key(view.dom, "k", { ctrlKey: true });
    await sleep(100);
    ok("Ctrl+K opens the form for the selection", open() && fields()[0].value === "paragraph" && fields()[1].value === "" && document.activeElement === fields()[1]);
    fields()[1].value = "https://example.org/p";
    key(fields()[1], "Enter");
    await sleep(100);
    ok("the selection is a link now", md().includes("Last [paragraph](https://example.org/p)."), md().split("\n").slice(-2));

    // text changed in the form; Escape leaves things alone
    caret(find("Last ") + 3);
    key(view.dom, "k", { ctrlKey: true });
    await sleep(100);
    fields()[0].value = "words";
    key(fields()[0], "Escape");
    await sleep(100);
    ok("Escape changes nothing", !open() && md().includes("Last [paragraph](https://example.org/p)."));
    ok("… and the caret is back where it was", view.hasFocus() && view.state.selection.from === find("Last ") + 3, [view.hasFocus(), view.state.selection.from]);
    key(view.dom, "k", { ctrlKey: true });
    await sleep(100);
    ok("Ctrl+K opens the form again", open() && pop.dataset.kind === "form" && fields()[0].value === "paragraph", [open(), pop.dataset.kind, fields()[0]?.value, view.state.selection.from, view.hasFocus()]);
    fields()[0].value = "words";
    key(fields()[0], "Enter");
    await sleep(100);
    ok("Enter takes the new text", md().includes("Last [words](https://example.org/p)."), md().split("\n").slice(-2));

    // remove
    caret(find("wor"));
    await sleep(650);
    pop.querySelector('[data-do="remove"]').click();
    await sleep(100);
    ok("Remove leaves the text", md().includes("Last words.") && !open(), md().split("\n").slice(-2));

    // an empty address removes the link as well
    caret(find("referen"));
    key(view.dom, "k", { ctrlKey: true });
    await sleep(100);
    fields()[1].value = "";
    key(fields()[1], "Enter");
    await sleep(100);
    ok("an empty address removes the link", md().includes("A reference here."), md().split("\n").slice(-4));
  } catch (e) { o.error = String(e.stack || e); }
  out("link", o);
})();
