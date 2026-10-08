/* Development probe (dev/rig.sh edges): the spec's edge cases that need the
 * running app — an empty document, a document that is one island, a file
 * that changes under an open dialog, a narrow window, keyboard-only use,
 * what assistive technology is told. Works on copies of fixtures. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    const file = MdView.core.current.name, original = MdView.core.current.raw;
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm, { TextSelection, NodeSelection } = PM.state;
    const md = () => V.serialize(false);
    // (as the editor does for a typed character: in a text selection the browser's own way, elsewhere the selection is replaced)
    const type = (text) => { for (const ch of text) { const { from, to } = view.state.selection; if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) view.dispatch((view.state.selection instanceof TextSelection ? view.state.tr.insertText(ch, from, to) : view.state.tr.insertText(ch)).scrollIntoView()); } };
    const key = (target, k, mods = {}) => {
      const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods });
      Object.defineProperty(e, "keyCode", { get: () => ({ Enter: 13, Escape: 27, Backspace: 8, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, F10: 121 })[k] || k.toUpperCase().charCodeAt(0) });
      target.dispatchEvent(e);
    };
    const undo = () => key(view.dom, "z", { ctrlKey: true });
    const pos = (text) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + text.length; }); if (f < 0) throw new Error("not in the document: " + text); return f; };
    const dlg = document.getElementById("dlg"), menu = document.getElementById("actmenu");
    V.focus();

    if (file === "empty.md") {
      // --- 1: an empty document
      const p = view.dom.querySelector("p");
      const ph = getComputedStyle(p, "::before");
      ok("an empty document shows a placeholder", p.classList.contains("placeholder") && /Start writing/.test(ph.content) && view.dom.textContent === "", [p.className, ph.content]);
      ok("… which is not text of the document", md().trim() === "" && view.state.doc.textContent === "");
      type("Hello");
      ok("typing takes it away", !view.dom.querySelector(".placeholder") && md() === "Hello\n", md());
      await sleep(1100);
      o.saved = md();
    } else if (file === "only-code.md") {
      // --- 2: a document that is one island: text above and below it
      ok("the document is one code block", view.state.doc.childCount === 1 && view.state.doc.firstChild.type.name === "island");
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
      key(view.dom, "ArrowDown");
      ok("ArrowDown from the block: a place to type below it", view.state.selection instanceof PM.gapcursor.GapCursor && view.state.selection.from === view.state.doc.content.size, view.state.selection.toJSON());
      type("below");
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
      key(view.dom, "ArrowUp");
      ok("ArrowUp: above it", view.state.selection instanceof PM.gapcursor.GapCursor && view.state.selection.from === 0, view.state.selection.toJSON());
      type("above");
      ok("text above and below, the block untouched", md() === "above\n\n" + original.replace(/\n*$/, "\n") + "\nbelow\n", md());
      await sleep(1100);
      o.saved = md();
    } else {
      // --- 13: the file changes on disk while a dialog is open
      let ip = -1;
      view.state.doc.forEach((n, p) => { if (ip < 0 && n.type.name === "island" && n.attrs.kind === "code") ip = p; });
      A.islands.open(view, ip);
      await sleep(450);
      const ed = dlg.querySelector(".ce-in");
      ed.value = "let a = 3;";
      ed.dispatchEvent(new Event("input"));
      await sleep(100);
      const changed = original.replace("# Polish\n", "# Polish\n\nA paragraph added by another program.\n");
      const cur = MdView.core.current;
      MdView.render({ ...cur, text: changed, raw: undefined, keepScroll: true, seq: 1e9, startMode: null });
      await sleep(300);
      ok("the file changes on disk under an open dialog: the dialog stays, the document shows the new text", dlg.hasAttribute("data-open") && ed.value === "let a = 3;" && md().includes("added by another program"), md().slice(0, 120));
      key(dlg, "Enter", { ctrlKey: true });
      await sleep(300);
      ok("… and its change lands in the block it was opened for", md() === changed.replace("let a = 1;", "let a = 3;"), md().slice(0, 200));
      // the block itself is gone from the file
      await sleep(1200); // (saved: nothing unsaved here that would win over the file)
      view.state.doc.forEach((n, p) => { if (n.type.name === "island" && n.attrs.kind === "code") ip = p; });
      A.islands.open(view, ip);
      await sleep(450);
      dlg.querySelector(".ce-in").value = "let a = 4;";
      dlg.querySelector(".ce-in").dispatchEvent(new Event("input"));
      const without = md().replace(/```js\n[\s\S]*?```\n\n/, "");
      MdView.render({ ...MdView.core.current, text: without, raw: undefined, keepScroll: true, seq: 1e9, startMode: null });
      await sleep(300);
      key(dlg, "Enter", { ctrlKey: true });
      await sleep(300);
      await sleep(100);
      ok("the block gone from the file: nothing is overwritten, the user is told", md() === without && /no longer in the file/.test(document.getElementById("toast")?.textContent || ""), [md() === without, document.getElementById("toast")?.textContent]);
      await sleep(1200);
      MdView.render({ ...MdView.core.current, text: original, raw: undefined, keepScroll: true, seq: 1e9, startMode: null });
      await sleep(300);
      ok("the file as it was again", md() === original);

      // --- 14: assistive technology
      const isl = (kind) => view.dom.querySelector(`.isl[data-kind="${kind}"]`);
      ok("the editor is a multi-line text box with a name", view.dom.getAttribute("role") === "textbox" && view.dom.getAttribute("aria-multiline") === "true" && view.dom.getAttribute("aria-label") === "Document");
      ok("a code block says its language and length", isl("code").getAttribute("role") === "button" && isl("code").getAttribute("aria-label") === "Code block, js, one line. Press Enter to edit.", isl("code").getAttribute("aria-label"));
      A.islands.open(view, ip = (() => { let p = -1; view.state.doc.forEach((n, q) => { if (p < 0 && n.type.name === "island") p = q; }); return p; })());
      await sleep(450);
      ok("a dialog is modal, labelled, and holds the focus", dlg.getAttribute("role") === "dialog" && dlg.getAttribute("aria-modal") === "true" && document.getElementById(dlg.getAttribute("aria-labelledby"))?.textContent === "Code block" && dlg.contains(document.activeElement));
      key(dlg, "Escape");
      await sleep(350);
      ok("… and hands it back to the editor, the block selected", view.hasFocus() && view.state.selection instanceof NodeSelection);

      // --- keyboard only: the menu at the caret, an action from it
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("plain words") - 11, pos("plain words"))));
      key(view.dom, "F10", { shiftKey: true });
      await sleep(300);
      const r = menu.getBoundingClientRect(), c = view.coordsAtPos(view.state.selection.to);
      ok("Shift+F10 opens the menu at the caret", menu.hasAttribute("data-open") && A.menu.panel === "root" && view.hasFocus() && Math.abs(r.top - c.bottom) < 12, [r.top, c.bottom]);
      for (let i = 0; i < 7; i++) key(menu, "ArrowDown"); // (… Select All, Add Link…, Format)
      key(menu, "ArrowRight");
      await sleep(200);
      key(document.getElementById("actsub"), "Enter");
      await sleep(300);
      ok("… and Bold is reached with the arrow keys alone", md().includes("**plain words**") && view.hasFocus(), md().slice(0, 80));
      undo();

      // --- typing that looks like syntax: prices, code, and taking a rule back
      const end = () => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("Last paragraph."))));
      end();
      type(" It costs $5 and $10 now");
      ok("prices are not a formula", !view.dom.querySelector("p:last-of-type .ia") && /costs \\?\$5 and \\?\$10 now/.test(md()), md().slice(-60));
      type(" `**not bold**` x");
      ok("in code, stars are stars", /`\*\*not bold\*\*` x/.test(md()) && !!view.dom.querySelector("p:last-of-type code") && !view.dom.querySelector("p:last-of-type strong"), md().slice(-60));
      type(" **b**");
      ok("**b** typed is bold", !!view.dom.querySelector("p:last-of-type strong"));
      undo();
      ok("… and one undo makes it the characters again", !view.dom.querySelector("p:last-of-type strong") && view.dom.querySelector("p:last-of-type").textContent.endsWith("**b**"), view.dom.querySelector("p:last-of-type").textContent.slice(-20));
      for (let i = 0; i < 40 && md() !== original; i++) undo();
      ok("all of it undone", md() === original, md().slice(-80));

      // --- $$…$$ typed: a formula on its own lines
      end();
      key(view.dom, "Enter");
      type("$$x^2 $$");
      ok("$$…$$ typed in a line of its own becomes a formula", view.state.doc.lastChild.type.name === "paragraph" && view.state.doc.child(view.state.doc.childCount - 2).attrs.kind === "math" && !!view.dom.querySelector(".isl[data-kind='math'] .katex") && md().endsWith("Last paragraph.\n\n$$x^2 $$\n"), md().slice(-60));
      ok("… and the caret is on a new line below it", view.state.selection.empty && view.state.selection.$from.parent === view.state.doc.lastChild && view.state.doc.lastChild.content.size === 0);
      type("Text with $$a+b$$");
      ok("typed behind text, the formula goes below that text", /\n\nText with\n\n\$\$a\+b\$\$\n$/.test(md()), md().slice(-60));
      type("then $5 and `$$` stay");
      ok("… and writing goes on below it; dollars in code stay", /\$\$a\+b\$\$\n\nthen \\?\$5 and `\$\$` stay\n$/.test(md()), md().slice(-70));
      for (let i = 0; i < 60 && md() !== original; i++) undo();
      ok("all of it undone again", md() === original, md().slice(-80));

      // --- 17: a narrow window (the page zoomed: fewer CSS pixels across)
      const wide = innerWidth;
      for (let i = 0; i < 15; i++) post("zoom", { step: 1 });
      for (let i = 0, last = -1, still = 0; i < 80 && still < 6; i++) { await sleep(100); still = innerWidth === last ? still + 1 : 0; last = innerWidth; }
      o.narrow = [wide, innerWidth];
      const inside = (el) => { const b = el.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 0.5 && b.top >= 0 && b.bottom <= innerHeight + 0.5 && b.width > 40; };
      ok("the page is narrow now", innerWidth < 640, innerWidth);
      view.dom.querySelector(".isl[data-kind='code']").scrollIntoView({ block: "center" });
      view.state.doc.forEach((n, p) => { if (n.type.name === "island" && n.attrs.kind === "code") ip = p; });
      A.islands.open(view, ip);
      await sleep(600);
      ok("narrow: the dialog is inside the window", dlg.hasAttribute("data-open") && inside(dlg), dlg.getBoundingClientRect());
      const dr = dlg.getBoundingClientRect();
      ok("… with all of its fields and buttons", [...dlg.querySelectorAll(".dlg-head input, .dlg-foot button")].every((x) => { const b = x.getBoundingClientRect(); return b.left >= dr.left && b.right <= dr.right && b.width > 30; }), [...dlg.querySelectorAll(".dlg-head input, .dlg-foot button")].map((x) => [Math.round(x.getBoundingClientRect().left), Math.round(x.getBoundingClientRect().right)]));
      out("narrow", {});
      await sleep(1400); // screenshot
      key(dlg, "Escape");
      await sleep(400);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("Second paragraph for the bar and the menu") - 16, pos("Second paragraph for the bar and the menu"))).scrollIntoView());
      await sleep(450);
      const bar = document.getElementById("fmtbar");
      ok("narrow: the formatting bar is inside the window", bar.hasAttribute("data-open") && inside(bar), bar.getBoundingClientRect());
      const sc = view.coordsAtPos(view.state.selection.to);
      view.dom.querySelector("p").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: view.dom.getBoundingClientRect().right - 3, clientY: sc.top + 4 }));
      await sleep(300);
      ok("narrow: a menu opened at the right edge is inside the window", menu.hasAttribute("data-open") && inside(menu), menu.getBoundingClientRect());
      [...menu.querySelectorAll(".menu-item")].find((b) => b.querySelector(".menu-label").textContent === "Paragraph").dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      await sleep(300);
      const sub = document.getElementById("actsub");
      ok("… and so is the menu beside it", sub.hasAttribute("data-open") && inside(sub), sub.getBoundingClientRect());
      key(sub, "Escape"); key(menu, "Escape");
      await sleep(250);
      A.link.edit(view);
      await sleep(350);
      const lp = document.getElementById("linkpop");
      ok("narrow: the link form is inside the window", inside(lp), lp.getBoundingClientRect());
      key(lp.querySelector("input") || lp, "Escape");
      await sleep(200);
      post("zoom", { step: 0 });
      for (let i = 0; i < 40 && innerWidth !== wide; i++) await sleep(100);
      await sleep(300);
      ok("zoom back: the file was never touched", md() === original && innerWidth === wide, [innerWidth, wide]);
      o.saved = md();
    }
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("edges", o);
})();
