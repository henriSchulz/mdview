/* Development probe (dev/rig.sh edit): typing in the active mode of the
 * running app — text, input rules, Enter and Backspace, lists and tasks,
 * undo, saving, and what ends up in the file. Works on a copy of
 * tests/fixtures/editing.md. Evaluated by mdview.py (MDVIEW_PROBE). */
(async () => {
  const out = (o) => window.MdHost.post(JSON.stringify({ type: "probe", name: "edit", text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const ok = (name, cond, detail) => results.push({ name, ok: !!cond, ...(cond ? {} : { detail }) });
  const KEYCODE = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 46 };
  try {
    await document.fonts.ready;
    await sleep(600);
    const original = MdView.core.current.raw;
    MdView.setMode("active");
    for (let i = 0; i < 200 && !(window.MdActive && MdActive.view && document.body.dataset.view === "active"); i++) await sleep(10);
    const V = MdActive.view, view = V.pm, { TextSelection } = PM.state;
    const md = () => V.serialize(false);
    const doc = () => view.state.doc;
    // the position right after the first occurrence of `text`
    const after = (text) => {
      let found = -1;
      doc().descendants((node, pos) => {
        if (found < 0 && node.isText && node.text.includes(text)) found = pos + node.text.indexOf(text) + text.length;
      });
      if (found < 0) throw new Error("not in the document: " + text);
      return found;
    };
    const caret = (pos, to = pos) => view.dispatch(view.state.tr.setSelection(TextSelection.create(doc(), pos, to)));
    const type = (text) => {
      for (const ch of text) {
        const { from, to } = view.state.selection;
        if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) view.dispatch(view.state.tr.insertText(ch, from, to));
      }
    };
    const press = (key, mods = {}) => {
      const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
      const code = KEYCODE[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
      Object.defineProperty(e, "keyCode", { get: () => code });
      view.dom.dispatchEvent(e);
    };
    const ctrl = { ctrlKey: true };
    const endOfDoc = () => caret(PM.state.Selection.atEnd(doc()).from);
    const lastLines = (n) => md().trimEnd().split("\n").slice(-n).join("\n");
    V.focus();
    ok("the active document is editable", view.editable && view.dom.getAttribute("contenteditable") === "true");
    ok("nothing typed: the file comes back as it is", V.serialize() === original);

    // 1. a word typed into a wrapped paragraph: only that place changes
    caret(after("First paragraph"));
    type(" grows");
    ok("typing changes only its place", md() === original.replace("First paragraph", "First paragraph grows"), md());
    press("s", ctrl);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    await sleep(400);
    ok("Ctrl+S hands the text over", !V.dirty && MdView.core.current.raw === md());

    // 2. undo takes it back, and the file is the original again
    press("z", ctrl);
    ok("undo restores the original text exactly", md() === original, md());
    press("z", { ctrlKey: true, shiftKey: true });
    ok("redo", md().includes("First paragraph grows"));

    // 3. input rules at the end of the document
    endOfDoc();
    press("Enter");
    type("## New heading");
    ok("'## ' makes a heading", view.dom.querySelector("h2")?.textContent === "New heading" && lastLines(1) === "## New heading", lastLines(2));
    ok("the heading has an id", view.dom.querySelector("h2")?.id === "new-heading", view.dom.querySelector("h2")?.id);
    press("Enter");
    ok("Enter after a heading starts a paragraph", view.state.selection.$from.parent.type.name === "paragraph");
    type("**bold** and *em* and `code` and ~~gone~~ and ==marked==.");
    ok("inline rules", lastLines(1) === "**bold** and *em* and `code` and ~~gone~~ and ==marked==." &&
      !!view.dom.querySelector("p strong") && !!view.dom.querySelector("p mark") && !!view.dom.querySelector("p s"), lastLines(1));
    press("Enter");
    type("See [the site](https://example.org) and https://bare.example/x and #tag ");
    ok("link, bare address and tag", lastLines(1) === "See [the site](https://example.org) and https://bare.example/x and #tag" &&
      view.dom.querySelectorAll("p:last-of-type a").length === 2 && !!view.dom.querySelector("p:last-of-type .tag"), lastLines(1));
    press("Enter");
    type("Math $x^2$ and a [[");
    await sleep(200); // ("[[" opens the small window that asks for the note: its name typed on, the closing bracket ends it)
    { const f = document.querySelector('#atompop[data-open] input[data-key="target"]'); if (f) { f.value = "Wiki note"; f.dispatchEvent(new KeyboardEvent("keydown", { key: "]", bubbles: true, cancelable: true })); } }
    await sleep(150);
    type(".");
    ok("math and wikilink become atoms", view.dom.querySelectorAll("p:last-of-type .ia").length === 2 && lastLines(1) === "Math $x^2$ and a [[Wiki note]].", lastLines(1));

    // 4. an input rule undone leaves the typed characters, written so that they stay characters
    press("Enter");
    type("**literal**");
    press("z", ctrl);
    ok("undo of an input rule leaves the raw text", view.state.selection.$from.parent.textContent === "**literal**", view.state.selection.$from.parent.textContent);
    ok("… which is escaped in the file", lastLines(1) === "\\*\\*literal\\*\\*", lastLines(1));

    // 5. lists
    press("Enter");
    type("- apple");
    press("Enter");
    type("pear");
    press("Enter");
    press("Tab");
    type("seed");
    press("Enter");
    press("Enter"); // empty nested item: out one level
    type("plum");
    press("Enter");
    press("Enter"); // empty item at the top: out of the list
    ok("list: items, nesting, leaving", lastLines(4) === "- apple\n- pear\n  - seed\n- plum" && view.state.selection.$from.depth === 1, lastLines(5));
    type("1. first");
    press("Enter");
    type("second");
    press("Enter");
    press("Enter");
    ok("ordered list counts on", lastLines(2) === "1. first\n2. second", lastLines(3));

    // 6. tasks
    type("[ ] buy milk");
    ok("'[ ] ' makes a task", lastLines(1) === "- [ ] buy milk" && !!view.dom.querySelector("li.task-item:last-of-type input.task"), lastLines(1));
    press("Enter", ctrl);
    ok("Ctrl+Enter ticks it", lastLines(1) === "- [x] buy milk", lastLines(1));
    const box = [...view.dom.querySelectorAll("input.task")].pop();
    box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    ok("a click on the box unticks it", lastLines(1) === "- [ ] buy milk", lastLines(1));
    press("Enter");
    ok("the next task starts unticked", view.state.selection.$from.node(-1).attrs.task === " ");
    press("Enter");

    // 7. Backspace takes the formatting off first
    caret(after("New heading") - "New heading".length);
    press("Backspace");
    ok("Backspace at the start of a heading makes it a paragraph", !view.dom.querySelector("h2") && md().includes("\nNew heading\n"), md().slice(-400));
    press("z", ctrl);
    ok("… and undo brings the heading back", !!view.dom.querySelector("h2"));
    caret(after("New") , after("New"));
    press("Enter");
    ok("Enter inside a heading: the rest becomes a paragraph", md().includes("## New\n\nheading\n") || md().includes("## New\n\n heading\n"), md().slice(-420, -300));
    press("z", ctrl);

    // 8. marks from the keyboard
    caret(after("Last ") , after("Last paragraph"));
    press("b", ctrl);
    ok("Ctrl+B", md().includes("Last **paragraph**."), md());
    press("b", ctrl);
    caret(after("Last "), after("Last paragraph"));
    press("i", ctrl);
    ok("Ctrl+I uses the document's emphasis style", md().includes("Last _paragraph_."), md().split("\n").find((l) => l.startsWith("Last")));
    press("i", ctrl);

    // 9. a definition survives "select all, delete"; the reference link keeps its form when its text changes
    caret(after("referen"));
    type("XX");
    ok("an edited reference link stays a reference", md().includes("A [referenXXce][ref] here."), md().split("\n").find((l) => l.startsWith("A [")));
    press("z", ctrl);
    caret(after("reference"));
    type("!");
    ok("typing right after a link does not extend it", md().includes("A [reference][ref]! here."), md().split("\n").find((l) => l.startsWith("A [")));
    press("z", ctrl);

    // 10. autosave writes the file; reading and the source editor show the edit; undo survives the trip
    await sleep(1300);
    ok("autosave handed the document over", !V.dirty);
    const saved = md();
    ok("what was saved is the document", MdView.core.current.raw === saved);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "3", code: "Digit3", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await sleep(300);
    ok("reading shows the edit", document.body.dataset.view === "read" && [...document.querySelectorAll("#content li")].some((li) => li.textContent.includes("pear")));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await sleep(700);
    ok("the source editor has the same text", document.getElementById("ed-input").value === saved);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", code: "Digit2", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await sleep(700);
    ok("back in the active mode with the same document", document.body.dataset.view === "active" && md() === saved);
    const before = md();
    press("z", ctrl);
    ok("undo still works after changing modes", md() !== before);
    press("z", { ctrlKey: true, shiftKey: true });

    view.dispatch(view.state.tr.setSelection(new PM.state.AllSelection(doc())));
    press("Backspace");
    ok("select all + delete keeps the link definition", md().includes("[ref]: https://example.com"), md());
    press("z", ctrl);
    ok("… and undo brings everything back", md() === saved, md().slice(0, 200));
    await sleep(1200);
    out({ pass: results.every((r) => r.ok), results, saved });
  } catch (e) {
    out({ pass: false, error: String(e && e.stack || e), results });
  }
})();
