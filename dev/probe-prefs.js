/* Development probe (dev/rig.sh prefs): the active mode's settings and what
 * follows them — the formatting bar, the "/" menu, typographic quotes,
 * Markdown at the caret, wrapping, the style of new Markdown. Works on a copy
 * of tests/fixtures/m5.md; the settings are put back at the end. */
(async () => {
  const out = (name, o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    const original = MdView.core.current.raw;
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm, { TextSelection } = PM.state;
    const md = () => V.serialize(false);
    const pos = (text) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + text.length; }); if (f < 0) throw new Error("not in the document: " + text); return f; };
    const type = (text) => { for (const ch of text) { const { from, to } = view.state.selection; if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) view.dispatch((view.state.selection instanceof TextSelection ? view.state.tr.insertText(ch, from, to) : view.state.tr.insertText(ch)).scrollIntoView()); } };
    const key = (target, k, mods = {}) => {
      const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods });
      Object.defineProperty(e, "keyCode", { get: () => ({ Enter: 13, Escape: 27, Backspace: 8, Tab: 9, ArrowDown: 40, ArrowUp: 38 })[k] || k.toUpperCase().charCodeAt(0) });
      target.dispatchEvent(e);
    };
    const undo = () => key(view.dom, "z", { ctrlKey: true });
    const dlg = document.getElementById("dlg"), menu = document.getElementById("actmenu"), bar = document.getElementById("fmtbar");
    const end = () => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("Last paragraph."))));
    const set = async (changes) => { // through the dialog, as a user would
      key(view.dom, ",", { ctrlKey: true });
      await sleep(450);
      for (const [k, v] of Object.entries(changes)) {
        const row = [...dlg.querySelectorAll(".pf-row")].find((r) => r.querySelector(".pf-name").textContent === k);
        if (!row) throw new Error("no setting " + k);
        const input = row.querySelector("input, select");
        if (input.type === "checkbox") input.checked = v; else input.value = String(v);
        input.dispatchEvent(new Event("change"));
      }
      key(dlg, "Enter", { ctrlKey: true });
      await sleep(500);
    };
    V.focus();

    // --- the dialog
    key(view.dom, ",", { ctrlKey: true });
    await sleep(450);
    ok("Ctrl+, opens the settings", dlg.hasAttribute("data-open") && document.getElementById("dlg-title").textContent === "Active Mode Settings" && dlg.querySelectorAll(".pf-row").length >= 10, document.getElementById("dlg-title").textContent);
    ok("the style choices show only with a fixed style", [...dlg.querySelectorAll(".pf-row.pf-sub")].every((r) => r.hidden));
    out("dialog", {});
    await sleep(1400); // screenshot
    key(dlg, "Escape");
    await sleep(400);

    // --- the formatting bar off
    await set({ "Formatting bar over a selection": false });
    ok("settings are kept by the application", window.MdPrefs.bar === false);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("bar and the menu") - 16, pos("bar and the menu"))));
    await sleep(450);
    ok("with the bar off, a selection shows none", !bar.hasAttribute("data-open"));
    await set({ "Formatting bar over a selection": true });

    // --- the "/" menu
    await set({ "Insert menu with “/”": false });
    end();
    key(view.dom, "Enter");
    type("/");
    await sleep(200);
    ok("switched off: a / is a /", !menu.hasAttribute("data-open"));
    undo(); undo();
    await set({ "Insert menu with “/”": true });
    end();
    key(view.dom, "Enter");
    type("/");
    await sleep(300);
    ok("on: / at the start of an empty line opens the insert menu", menu.hasAttribute("data-open") && menu.querySelectorAll(".menu-item").length === 13 && view.hasFocus(), menu.querySelectorAll(".menu-item").length);
    out("slash", {});
    await sleep(1400); // screenshot
    type("ta");
    await sleep(150);
    ok("typing on filters it", [...menu.querySelectorAll(".menu-item")].map((b) => b.textContent).join("|") === "Task List|Table", [...menu.querySelectorAll(".menu-item")].map((b) => b.textContent));
    key(view.dom, "ArrowDown");
    key(view.dom, "Enter");
    await sleep(300);
    ok("↓ and Enter choose: the /ta is gone, a table is there", !md().includes("/ta") && /Last paragraph\.\n\n\| +\| +\|\n\| -+ \| -+ \|/.test(md()), md().slice(-90));
    for (let i = 0; i < 10 && md() !== original; i++) undo();
    end();
    key(view.dom, "Enter");
    type("/x");
    await sleep(200);
    key(view.dom, "Escape");
    await sleep(200);
    ok("Esc closes it and the text stays", !menu.hasAttribute("data-open") && md().trimEnd().endsWith("/x"), md().slice(-30));
    for (let i = 0; i < 10 && md() !== original; i++) undo();
    ok("undone", md() === original, md().slice(-60));

    // --- typographic quotes
    await set({ "Typographic quotes while typing": true });
    end();
    type(` He said "it's fine" and 'ok'.`);
    ok("quotes become typographic, an apostrophe too", md().includes("He said “it’s fine” and ‘ok’."), md().slice(-50));
    type(" `\"code\"`");
    ok("… but not in code", md().includes('`"code"`'), md().slice(-30));
    for (let i = 0; i < 40 && md() !== original; i++) undo();

    // --- Markdown at the caret
    await set({ "Show Markdown at the caret": true });
    view.dispatch(view.state.tr.addMark(pos("plain words") - 11, pos("plain words"), A.schema.marks.strong.create()));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("plain wo"))));
    await sleep(100);
    const syn = [...view.dom.querySelectorAll(".syn")].map((s) => s.textContent);
    ok("the caret in bold text: its ** show", syn.join("") === "****" && md().includes("**plain words**"), syn);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("Second par"))));
    await sleep(100);
    ok("… elsewhere they do not; they are never in the file", !view.dom.querySelector(".syn") && !/\*\*\*\*/.test(md()));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("Poli"))));
    await sleep(100);
    ok("in a heading its # shows", view.dom.querySelector("h1 .syn")?.textContent === "# ");
    undo();
    await set({ "Show Markdown at the caret": false });

    // --- wrapping and the style of new Markdown
    await set({ "Wrap new paragraphs at": 72, "Style for new elements": "fixed", "Bullets": "*", "Bold": "__" });
    end();
    key(view.dom, "Enter");
    type("A new paragraph that is long enough to be wrapped at seventy-two characters, as the settings say.");
    key(view.dom, "Enter");
    type("one");
    key(view.dom, "8", { ctrlKey: true, shiftKey: true }); // a list made by the menu or the keys, not by typing a marker
    view.dispatch(view.state.tr.addMark(view.state.selection.from - 3, view.state.selection.from, A.schema.marks.strong.create()));
    const tail = md().split("Last paragraph.")[1];
    ok("a new paragraph is wrapped", tail.includes("\n\nA new paragraph that is long enough to be wrapped at seventy-two\ncharacters, as the settings say.\n"), tail);
    ok("new Markdown takes the fixed style: * bullets, __ bold", /\n\* __one__\s*$/.test(tail), tail.slice(-30));
    ok("the paragraphs that were there stay as they were", md().startsWith(original.split("Last paragraph.")[0]));
    for (let i = 0; i < 40 && md() !== original; i++) undo();
    ok("all of it undone", md() === original, md().slice(-80));

    // --- back as they were
    post("prefs", { prefs: { bar: true, slash: true, syntax: false, quotes: false, wrap: 0, style: "auto", bullet: "-", strongMark: "**" } });
    await sleep(400);
    ok("the settings are back", window.MdPrefs.slash === true && window.MdPrefs.wrap === 0 && window.MdPrefs.style === "auto");
    await sleep(1100);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("prefs", o);
})();
