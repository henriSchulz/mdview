/* Development probe (dev/rig.sh more): the formula dialog's shape switch and
 * picture copy, a dialog pulled larger, search / brackets / LaTeX completion
 * in a dialog's editor, the tick drawn on a task, the window's own tooltips.
 * Works on a copy of tests/fixtures/more.md. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    const original = MdView.core.current.raw;
    // the window's own tooltips (reading mode, before anything else)
    const tb = document.querySelector('#toolbar [data-act="outline"]');
    tb.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await sleep(850);
    const tip = document.getElementById("apptip");
    ok("a toolbar button gets the app's own tooltip, not the browser's", tip.hasAttribute("data-open") && tip.textContent === "Outline (Ctrl+Shift+O)" && !tb.hasAttribute("title"), [tip.textContent, tb.getAttribute("title")]);
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm;
    const md = () => V.serialize(false);
    const dlg = document.getElementById("dlg");
    const ed = () => dlg.querySelector(".ce-in");
    const key = (target, k, mods = {}) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }); Object.defineProperty(e, "keyCode", { get: () => ({ Enter: 13, Escape: 27, ArrowDown: 40, Tab: 9 })[k] || k.toUpperCase().charCodeAt(0) }); target.dispatchEvent(e); };
    const island = (kind) => { let f = -1; view.state.doc.forEach((n, p) => { if (f < 0 && n.type.name === "island" && n.attrs.kind === kind) f = p; }); return f; };
    const undo = () => key(view.dom, "z", { ctrlKey: true });
    V.focus();

    // --- the formula: block -> in the line, and back
    A.islands.open(view, island("math"));
    await sleep(450);
    dlg.querySelector('.dlg-seg [data-shape="inline"]').click();
    key(dlg, "Enter", { ctrlKey: true });
    await sleep(300);
    ok("a formula block made a formula in a line", md().includes("# More\n\n$\\frac{a}{b} + (c + d)$\n\nA line"), md().slice(0, 80));
    undo();
    ok("… one undo", md() === original);
    let atom = -1;
    view.state.doc.descendants((n, p) => { if (atom < 0 && n.type.name === "iatom") atom = p; });
    A.islands.open(view, atom);
    await sleep(300);
    key(document.querySelector("#atompop input"), "Enter", { shiftKey: true });
    await sleep(450);
    dlg.querySelector('.dlg-seg [data-shape="block"]').click();
    key(dlg, "Enter", { ctrlKey: true });
    await sleep(300);
    ok("a formula in a line made a block: the line is cut there", md().includes("A line with\n\n$$\nx^2\n$$\n\nin it."), md().slice(30, 120));
    undo();
    ok("… one undo", md() === original, md().slice(30, 120));

    // --- copy as picture
    A.islands.open(view, island("math"));
    await sleep(500);
    [...dlg.querySelectorAll(".dlg-tools .btn")].find((b) => b.textContent === "Copy as Picture").click();
    await sleep(800);
    out("picture", {}); // (the rig looks at the picture the application made)
    ok("copy as picture: it says so", /picture/.test(document.getElementById("toast")?.textContent || ""), document.getElementById("toast")?.textContent);

    // --- the editor: brackets, search, completion
    const t = ed();
    t.focus(); t.setSelectionRange(6, 6); // after "\frac{"
    t.dispatchEvent(new Event("select"));
    await sleep(50);
    const pair = [...dlg.querySelectorAll(".ce-hl .ce-match")].map((s) => s.textContent);
    ok("the caret at a bracket shows its partner", pair.join("") === "{}", pair);
    key(t, "f", { ctrlKey: true });
    await sleep(100);
    const field = dlg.querySelector(".ce-find input");
    field.value = "b"; field.dispatchEvent(new Event("input"));
    await sleep(50);
    ok("Ctrl+F searches in the editor", dlg.querySelectorAll(".ce-hl .ce-hit").length === 1 && dlg.querySelector(".ce-count").textContent === "1 of 1", dlg.querySelector(".ce-count")?.textContent);
    key(field, "Escape");
    await sleep(50);
    ok("Esc ends the search and selects what was found; the dialog stays", dlg.hasAttribute("data-open") && !dlg.querySelector(".ce-find") && t.value.slice(t.selectionStart, t.selectionEnd) === "b");
    t.setSelectionRange(t.value.length, t.value.length);
    document.execCommand("insertText", false, " \\sq");
    await sleep(50);
    const opts = [...document.querySelectorAll(".ce-comp .ce-opt")].map((x) => x.textContent);
    ok("typing \\sq offers LaTeX commands", opts[0] === "\\sqrt{…}", opts);
    key(t, "Enter");
    ok("Enter takes one, the caret inside its braces", t.value.endsWith(" \\sqrt{}") && t.selectionStart === t.value.length - 1, t.value.slice(-10));
    key(dlg, "Escape");
    await sleep(350);

    // --- a dialog pulled larger, kept
    A.islands.open(view, island("code"));
    await sleep(600);
    const grip = dlg.querySelector(".dlg-grip"), g = grip.getBoundingClientRect(), w0 = dlg.offsetWidth;
    grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: g.left + 6, clientY: g.top + 6 })); await sleep(30);
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: g.left + 46, clientY: g.top + 66 })); await sleep(30);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: g.left + 46, clientY: g.top + 66 })); await sleep(300);
    const w1 = dlg.offsetWidth;
    ok("pulled at its corner, the dialog grows", w1 > w0 + 40, [w0, w1]);
    key(dlg, "Escape");
    await sleep(400);
    A.islands.open(view, island("code"));
    await sleep(600);
    ok("… and opens at that size again", Math.abs(dlg.offsetWidth - w1) < 2, [dlg.offsetWidth, w1]);
    dlg.querySelector(".dlg-grip").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await sleep(100);
    ok("a double click on the corner: its own size again", Math.abs(dlg.offsetWidth - w0) < 2 && window.MdPrefs.dialogWidth === 0, [dlg.offsetWidth, w0]);
    key(dlg, "Escape");
    await sleep(400);

    // --- the tick
    const box = view.dom.querySelector("input.task");
    box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await sleep(30);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    ok(reduced ? "a task ticked (movement reduced here: no drawing)" : "a task ticked: its check is drawn (a cover slides off it)", !!document.querySelector(".tick-cover.go") !== reduced && md().includes("- [x] a task to tick"), [reduced, md().slice(60, 140)]);
    await sleep(500);
    ok("… and is gone after", !document.querySelector(".tick-cover"));
    undo();
    ok("all undone", md() === original, md());
    await sleep(1100);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("more", o);
})();
