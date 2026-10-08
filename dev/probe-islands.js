/* Development probe (dev/rig.sh islands): islands and their dialogs in the
 * running app — code, formula, properties, raw Markdown, the popovers for an
 * inline formula and a picture, and blocks made by typing ``` or $$.
 * Works on a copy of tests/fixtures/islands.md. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    const original = MdView.core.current.raw;
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && document.body.dataset.view === "active"); i++) await sleep(10);
    const V = MdActive.view, view = V.pm;
    const dlg = document.getElementById("dlg"), pop = document.getElementById("atompop");
    const md = () => V.serialize(false);
    const isOpen = () => dlg.hasAttribute("data-open");
    // the position of the first node that fits
    const find = (test) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && test(n)) f = p; }); if (f < 0) throw new Error("no such node"); return f; };
    const island = (kind, nth = 0) => { let k = 0; return find((n) => n.type.name === "island" && n.attrs.kind === kind && k++ === nth); };
    const click = (pos, double) => view.someProp(double ? "handleDoubleClickOn" : "handleClickOn", (f) => f(view, pos, view.state.doc.nodeAt(pos), pos, { button: 0 }, true));
    const key = (target, k, mods = {}) => {
      const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods });
      Object.defineProperty(e, "keyCode", { get: () => ({ Enter: 13, Escape: 27, Backspace: 8 })[k] || k.toUpperCase().charCodeAt(0) });
      target.dispatchEvent(e);
    };
    const ed = () => dlg.querySelector(".ce-in");
    const setEditor = (text) => { const t = ed(); t.value = text; t.dispatchEvent(new Event("input")); };
    const done = async () => { key(dlg, "Enter", { ctrlKey: true }); await sleep(80); };
    const type = (text) => { for (const ch of text) { const { from, to } = view.state.selection; if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) view.dispatch(view.state.tr.insertText(ch, from, to)); } };
    V.focus();

    // --- code
    click(island("code"));
    await sleep(700);
    ok("a click on a code block opens its dialog", isOpen() && document.getElementById("dlg-title").textContent === "Code block");
    const r = dlg.getBoundingClientRect();
    ok("the dialog has settled inside the window", getComputedStyle(dlg).transform === "none" || getComputedStyle(dlg).transform === "matrix(1, 0, 0, 1, 0, 0)" ? r.top >= 0 && r.bottom <= innerHeight && r.width > 300 : false, [getComputedStyle(dlg).transform, r.top, r.bottom]);
    ok("language, info and code are there", dlg.querySelector(".dlg-lang").value === "js" && dlg.querySelector(".dlg-rest").value === 'title="a.js"' && ed().value === "let a = 1;");
    ok("the editor has the focus and highlights", document.activeElement === ed() && !!dlg.querySelector(".ce-back .hljs-keyword"));
    ok("the footer counts", /1 lines · 10 characters/.test(dlg.querySelector(".dlg-count").textContent), dlg.querySelector(".dlg-count").textContent);
    out("code", {});
    await sleep(1500); // screenshot
    setEditor("let b = 2;\nprint(b)");
    const lang = dlg.querySelector(".dlg-lang");
    lang.value = "python";
    lang.dispatchEvent(new Event("input"));
    await done();
    ok("Ctrl+Enter writes code and language, the info string stays", !isOpen() && md() === original.replace('```js title="a.js"\nlet a = 1;\n```', '```python title="a.js"\nlet b = 2;\nprint(b)\n```'), md().slice(0, 200));
    ok("the island shows the new code", view.dom.querySelector(".code-lang")?.textContent === "python" && view.dom.querySelector(".code-block code").textContent.includes("print(b)"));
    key(view.dom, "z", { ctrlKey: true });
    ok("it is one undo step", md() === original);
    click(island("code"));
    await sleep(300);
    setEditor("thrown away");
    key(dlg, "Escape");
    await sleep(80);
    ok("Esc leaves the block alone", !isOpen() && md() === original);
    click(island("code"));
    await sleep(300);
    const back = [...dlg.querySelectorAll(".dlg-info .btn")].find((b) => b.textContent === "Restore Discarded Changes");
    ok("opened again: what was thrown away can come back", !!back);
    back.click();
    ok("… and does", ed().value === "thrown away");
    key(dlg, "Escape");
    await sleep(300);
    click(island("code"));
    await sleep(300);
    setEditor("let a = 1;\n```\nfence inside");
    document.getElementById("dlg-scrim").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await sleep(80);
    ok("a click beside the dialog takes the edit; a fence in the code makes the fence longer", !isOpen() && md().includes('````js title="a.js"\nlet a = 1;\n```\nfence inside\n````'), md().slice(40, 160));
    key(view.dom, "z", { ctrlKey: true });

    // --- code in a list keeps its indentation; indented code becomes fenced with a language
    click(island("code", 2));
    await sleep(300);
    ok("code in a list item shows without its indentation", ed().value === "echo hi", ed().value);
    setEditor("echo ho\n\necho again");
    await done();
    ok("… and gets it back", md().includes("- item\n\n  ```sh\n  echo ho\n\n  echo again\n  ```"), md().slice(-120));
    key(view.dom, "z", { ctrlKey: true });
    click(island("code", 1));
    await sleep(300);
    ok("indented code opens without a language", ed().value === "indented code" && dlg.querySelector(".dlg-lang").value === "");
    dlg.querySelector(".dlg-lang").value = "text";
    await done();
    ok("a language turns indented code into a fenced block", md().includes("```text\nindented code\n```"), md().slice(150, 260));
    key(view.dom, "z", { ctrlKey: true });
    ok("all undone again", md() === original);

    // --- formula
    click(island("math"));
    await sleep(400);
    ok("a click on a formula opens the formula dialog with a preview", isOpen() && ed().value === "E = mc^2" && !!dlg.querySelector(".dlg-preview .katex"));
    setEditor("\\frac{1}{");
    await sleep(60);
    ok("an error shows, the last good preview stays (dimmed)", dlg.querySelector(".dlg-error").textContent.length > 5 && dlg.querySelector(".dlg-preview").classList.contains("stale") && !!dlg.querySelector(".dlg-preview .katex") && !!dlg.querySelector(".ce-err"), dlg.querySelector(".dlg-error").textContent);
    out("math", {});
    await sleep(1500); // screenshot
    setEditor("\\frac{1}{2}");
    await sleep(60);
    ok("corrected: no error", dlg.querySelector(".dlg-error").textContent === "" && !dlg.querySelector(".dlg-preview").classList.contains("stale"));
    dlg.querySelector('.dlg-symbols [data-i="1"]').click();
    ok("a symbol button inserts its command", ed().value.includes("\\sqrt{}"), ed().value);
    setEditor("\\frac{1}{2}");
    await done();
    ok("the formula is written between its dollars as before", md() === original.replace("$$\nE = mc^2\n$$", () => "$$\n\\frac{1}{2}\n$$"), md().slice(60, 140));
    key(view.dom, "z", { ctrlKey: true });

    // --- inline formula
    const atom = find((n) => n.type.name === "iatom" && n.attrs.kind === "math");
    click(atom);
    await sleep(350);
    const field = () => pop.querySelector("input");
    ok("a click on an inline formula opens its popover", pop.hasAttribute("data-open") && field().value === "x^2" && !!pop.querySelector(".ap-preview .katex"));
    out("atom", {});
    await sleep(1500); // screenshot
    field().value = "y_1";
    field().dispatchEvent(new Event("input", { bubbles: true }));
    key(field(), "Enter");
    await sleep(80);
    ok("Enter takes it", md().includes("Inline $y_1$ here"), md().split("\n").find((l) => l.startsWith("Inline")));
    key(view.dom, "z", { ctrlKey: true });

    // --- picture
    const img = find((n) => n.type.name === "image");
    ok("one click on a picture opens nothing", !click(img) && !pop.hasAttribute("data-open"));
    // (a double click shows it large — probe graphic; its fields open from its menu's Edit, or Enter)
    MdActive.islands.open(view, img);
    await sleep(350);
    ok("Edit opens the picture's fields", pop.hasAttribute("data-open") && pop.querySelectorAll("input").length === 3 && pop.querySelector("input").value === "alt");
    pop.querySelector("input").value = "a description";
    key(pop.querySelector("input"), "Enter");
    await sleep(80);
    ok("the description is written", md().includes("![a description](missing.png)"), md().split("\n").find((l) => l.startsWith("Inline")));
    key(view.dom, "z", { ctrlKey: true });

    // --- properties (they stand at the note's head and are no block to click open: from their menu — Edit Properties…)
    MdActive.islands.open(view, island("frontmatter"));
    await sleep(400);
    const form = dlg.querySelector(".fm-form");
    ok("simple properties open as a form", isOpen() && !form.hidden && [...form.querySelectorAll(".fm-key")].map((k) => k.textContent).join(",") === "title,tags" && form.querySelector(".fm-value").value === "Test", form.textContent);
    const fv = form.querySelectorAll(".fm-value");
    fv[0].value = "From the form"; fv[0].dispatchEvent(new Event("input"));
    await done();
    ok("the form writes the changed line only", md().startsWith("---\ntitle: From the form\ntags: [a, b]\n---"), md().slice(0, 60));
    key(view.dom, "z", { ctrlKey: true });
    MdActive.islands.open(view, island("frontmatter"));
    await sleep(400);
    dlg.querySelector('.dlg-seg [data-shape="yaml"]').click();
    await sleep(100);
    ok("properties as YAML", isOpen() && ed().value === "title: Test\ntags: [a, b]");
    setEditor("title: [unclosed");
    await sleep(60);
    ok("invalid YAML is said", dlg.querySelector(".dlg-error").textContent.length > 5);
    setEditor("title: Changed\ntags: [a, b]");
    await done();
    ok("the properties are written and shown", md().startsWith("---\ntitle: Changed\ntags: [a, b]\n---\n\n# Islands") && view.dom.querySelector(".props")?.textContent.includes("Changed"), md().slice(0, 60));
    key(view.dom, "z", { ctrlKey: true });

    // --- a callout that folds: a block like the others; its title's bar folds and unfolds it
    const fold = view.dom.querySelector("details.callout");
    ok("a callout that folds is drawn as the reading view draws it, folded at first", !!fold && !fold.open && !isOpen(), [!!fold, fold && fold.open]);
    fold.querySelector(".callout-fold").click();
    await sleep(300);
    ok("a click on its title's bar unfolds it, and writes nothing", view.dom.querySelector("details.callout").open && md() === original);
    ok("everything undone: the file is the original", md() === original, md());

    // --- made by typing
    view.dispatch(view.state.tr.setSelection(PM.state.Selection.atEnd(view.state.doc)));
    key(view.dom, "Enter");
    type("```py");
    key(view.dom, "Enter");
    await sleep(450);
    ok("``` and Enter make a code block and open it", isOpen() && dlg.querySelector(".dlg-lang").value === "py" && ed().value === "");
    key(dlg, "Escape");
    await sleep(80);
    ok("left empty, it goes again", !md().includes("```py"), md().slice(-60));
    type("```py");
    key(view.dom, "Enter");
    await sleep(450);
    setEditor("print(1)");
    await done();
    ok("with code, it stays", md().trimEnd().endsWith("```py\nprint(1)\n```"), md().slice(-60));
    // below the last block (an island): the caret in the gap there, as after ArrowDown
    view.dispatch(view.state.tr.setSelection(new PM.gapcursor.GapCursor(view.state.doc.resolve(view.state.doc.content.size))));
    type("$$");
    ok("typing below an island starts a paragraph", view.state.selection.$from.parent.type.name === "paragraph" && view.state.selection.$from.parent.textContent === "$$", view.state.selection.$from.parent.textContent);
    key(view.dom, "Enter");
    await sleep(450);
    ok("$$ and Enter open a new formula", isOpen() && document.getElementById("dlg-title").textContent === "Formula");
    setEditor("a^2 + b^2");
    await done();
    ok("the formula is written on its own lines", md().trimEnd().endsWith("$$\na^2 + b^2\n$$"), md().slice(-60));

    // --- a diagram: the code dialog previews it
    view.dispatch(view.state.tr.setSelection(new PM.gapcursor.GapCursor(view.state.doc.resolve(view.state.doc.content.size))));
    type("```mermaid");
    key(view.dom, "Enter");
    await sleep(450);
    setEditor("graph TD\n  A --> B");
    for (let i = 0; i < 60 && !dlg.querySelector(".dlg-preview svg"); i++) await sleep(150);
    ok("a mermaid block previews in the dialog", !!dlg.querySelector(".dlg-preview svg"));
    await done();
    for (let i = 0; i < 40 && !view.dom.querySelector(".mermaid-block svg"); i++) await sleep(150);
    ok("… and is drawn in the document", !!view.dom.querySelector(".mermaid-block svg") && md().trimEnd().endsWith("```mermaid\ngraph TD\n  A --> B\n```"), md().slice(-60));

    // --- leaving the mode with a dialog open takes what was entered
    click(island("math"));
    await sleep(350);
    setEditor("E = h\\nu");
    document.querySelector('.seg-btn[data-mode="read"]').click();
    await sleep(400);
    ok("leaving the mode closes the dialog and keeps its content", !isOpen() && document.body.dataset.view === "read" && MdView.core.current.text.includes("$$\nE = h\\nu\n$$"), MdView.core.current.text.slice(60, 120));
    document.querySelector('.seg-btn[data-mode="active"]').click();
    await sleep(400);
    ok("islands say what they are", /^Code block, \w+, (one line|\d+ lines)\. Press Enter to edit\.$/.test(view.dom.querySelector('.isl[data-kind="code"]')?.getAttribute("aria-label") || ""), view.dom.querySelector('.isl[data-kind="code"]')?.getAttribute("aria-label"));

    // --- keyboard: a selected island opens with Enter
    const m = island("math");
    view.dispatch(view.state.tr.setSelection(PM.state.NodeSelection.create(view.state.doc, m)));
    key(view.dom, "Enter");
    await sleep(350);
    ok("Enter on a selected island opens it", isOpen());
    key(dlg, "Escape");
    await sleep(350);
    ok("after closing, the editor has the focus", view.hasFocus());
    await sleep(1300);
    o.saved = md();
  } catch (e) { o.error = String(e && e.stack || e); }
  out("islands", o);
})();
