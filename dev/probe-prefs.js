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
    const st = () => document.getElementById("settings");
    const set = async (changes) => { // through the settings window, as a user would
      key(view.dom, ",", { ctrlKey: true });
      await sleep(450);
      for (const [k, v] of Object.entries(changes)) {
        const row = [...st().querySelectorAll(".pf-row")].find((r) => r.querySelector(".pf-name").textContent === k);
        if (!row) throw new Error("no setting " + k);
        const input = row.querySelector("input, select");
        if (input.type === "checkbox") input.checked = v; else input.value = String(v);
        input.dispatchEvent(new Event("change"));
      }
      key(st(), "Escape"); // (a change is taken at once: there is nothing to apply)
      await sleep(500);
    };
    V.focus();

    // --- the dialog
    key(view.dom, ",", { ctrlKey: true });
    await sleep(450);
    ok("Ctrl+, opens the settings: a window with its groups at the left", !!st() && st().hasAttribute("data-open") && st().querySelector(".st-name").textContent === "Settings" && st().querySelectorAll(".st-nav").length >= 8 && st().querySelectorAll(".pf-row").length >= 20 && document.getElementById("st-title").textContent === "General", st() && document.getElementById("st-title").textContent);
    {
      const shown = () => [...st().querySelectorAll(".st-page")].filter((p) => getComputedStyle(p).display !== "none").map((p) => p.dataset.page).join();
      st().querySelector('.st-nav[data-page="editing"]').click(); await sleep(250);
      ok("a group chosen at the left shows its settings, and only those", shown() === "editing" && document.getElementById("st-title").textContent === "Editing" && st().querySelector('.st-nav[data-page="editing"]').getAttribute("aria-current") === "page", shown());
      key(st().querySelector('.st-nav[data-page="editing"]'), "ArrowDown"); await sleep(250);
      ok("↓ in the groups goes to the next one", shown() === "newMarkdown" && document.activeElement === st().querySelector('.st-nav[data-page="newMarkdown"]'), shown());
      // the wheel belongs to the window: the note under it does not scroll
      const y0 = window.scrollY, wheel = (el, dy) => { const e = new WheelEvent("wheel", { deltaY: dy, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; };
      ok("the wheel beside the window, on its head and at the end of its list moves nothing under it", wheel(document.getElementById("settings-scrim"), 120) && wheel(st().querySelector(".st-head"), 120) && wheel(st().querySelector(".st-page[data-on] .pf-row"), 120) && window.scrollY === y0);
      // a choice is a button with the app's own menu; a press with the real pointer reaches it (the
      // page's block selection must not take it)
      {
        st().querySelector('.st-nav[data-page="general"]').click(); await sleep(300);
        const row = st().querySelector('.pf-row[data-key="startMode"]'), pop = row.querySelector(".pf-pop"), sel = row.querySelector("select"), r = pop.getBoundingClientRect();
        const menu = () => document.getElementById("st-menu");
        ok("a choice shows what is chosen, on a button — no control of the toolkit's", pop.textContent.trim() === sel.selectedOptions[0].textContent && sel.hidden && r.width > 100, pop.textContent);
        for (const kind of ["move", "down", "up"]) { post("probe-pointer", { kind, x: r.left + 20, y: r.top + 10 }); await sleep(180); }
        await sleep(300);
        const items = () => [...menu().querySelectorAll(".menu-item")];
        ok("a press on it opens the app's menu with the choices, the one in use ticked", !!menu() && menu().hasAttribute("data-open") && items().length === sel.options.length && items().filter((b) => b.getAttribute("aria-checked") === "true").length === 1 && menu().getBoundingClientRect().top >= r.bottom, menu() && items().length);
        out("slash-shot-menu", {}); await sleep(100);
        key(menu(), "ArrowDown"); key(menu(), "Enter"); await sleep(500);
        ok("↓ and Enter choose the next one: the button says it, the setting is taken", !menu().hasAttribute("data-open") && sel.selectedIndex === 1 && pop.textContent.trim() === sel.options[1].textContent && window.MdPrefs.startMode === sel.options[1].value && document.activeElement === pop, [sel.selectedIndex, window.MdPrefs.startMode]);
        pop.click(); await sleep(300);
        key(menu(), "Escape"); await sleep(300);
        ok("Esc closes the menu, not the settings", !menu().hasAttribute("data-open") && st().hasAttribute("data-open"));
        sel.value = sel.options[0].value; sel.dispatchEvent(new Event("change")); await sleep(300);
      }
      // the key for the model: asked of the application, never shown whole
      st().querySelector('.st-nav[data-page="ai"]').click(); await sleep(400);
      const keyRow = st().querySelector('.pf-row[data-key="aiKey"]'), field = keyRow.querySelector("input"), state = keyRow.querySelector(".pf-state");
      field.value = "test-key-1234567890abcd"; keyRow.querySelector(".pf-link").click(); await sleep(700);
      ok("a key typed in is stored: the row says how it ends, the field is empty again", /abcd$/.test(state.textContent) && !/1234567890/.test(st().textContent) && field.value === "" && !keyRow.querySelector(".pf-link.danger").hidden, state.textContent);
      keyRow.querySelector(".pf-link.danger").click(); await sleep(700);
      ok("Remove takes it out again", state.textContent === "No key" && keyRow.querySelector(".pf-link.danger").hidden, state.textContent);
      st().querySelector('.st-nav[data-page="about"]').click(); await sleep(300);
      ok("About says the version", /^[0-9a-f]{7,} · \d{4}-\d\d-\d\d$/.test(st().querySelector('.pf-row[data-key="version"] .pf-value').textContent), st().querySelector('.pf-row[data-key="version"] .pf-value').textContent);
      st().querySelector('.st-nav[data-page="newMarkdown"]').click(); await sleep(250);
    }
    ok("the style choices show only with a fixed style", [...st().querySelectorAll(".pf-row.pf-sub")].every((r) => r.hidden));
    st().querySelector('.st-nav[data-page="editing"]').click(); await sleep(300);
    out("dialog", {});
    await sleep(1400); // screenshot
    key(st(), "Escape");
    await sleep(400);
    ok("Esc closes it", !st().hasAttribute("data-open"));
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
    ok("on: / at the start of an empty line opens the insert menu", menu.hasAttribute("data-open") && menu.querySelectorAll(".menu-item").length === 15 && view.hasFocus(), menu.querySelectorAll(".menu-item").length);
    ok("every entry has its sign", [...menu.querySelectorAll(".menu-item")].every((b) => b.querySelector(".menu-icon svg")));
    ok("it is no taller than its panel allows, the rest scrolls", menu.scrollHeight > menu.clientHeight && menu.scrollTop === 0, [menu.scrollHeight, menu.clientHeight]);
    menu.querySelector(".menu-item").dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 60 }));
    ok("the wheel over the menu scrolls it and leaves it open", menu.hasAttribute("data-open"));
    const sub = document.getElementById("actsub"), tall = menu.offsetHeight;
    key(view.dom, "ArrowRight");
    await sleep(300);
    ok("→ opens the group's menu beside it", sub.hasAttribute("data-open") && [...sub.querySelectorAll(".menu-item")].map((b) => b.textContent).join("|") === "Text|Heading 1|Heading 2|Heading 3|Heading 4" && sub.querySelector(".menu-item.hl")?.textContent === "Text", [...sub.querySelectorAll(".menu-item")].map((b) => b.textContent));
    ok("what the block is has its tick there", sub.querySelector('[aria-checked="true"]')?.textContent === "Text");
    out("slash", {});
    await sleep(1400); // screenshot
    key(view.dom, "ArrowLeft");
    await sleep(250);
    ok("← leaves it", !sub.hasAttribute("data-open") && menu.hasAttribute("data-open") && md().endsWith("/\n"), md().slice(-12));
    for (let i = 0; i < 14; i++) key(view.dom, "ArrowDown");
    await sleep(60);
    const last = menu.querySelector(".menu-item.hl"), lr = last.getBoundingClientRect(), mr = menu.getBoundingClientRect();
    ok("↓ to the last entry brings it into sight", last.textContent === "Actions" && lr.bottom <= mr.bottom + 0.5 && lr.top >= mr.top, [last.textContent, lr.bottom, mr.bottom]);
    type("ta");
    await sleep(150);
    ok("typing on filters it", [...menu.querySelectorAll(".menu-item")].map((b) => b.textContent).join("|") === "Task List|Table", [...menu.querySelectorAll(".menu-item")].map((b) => b.textContent));
    ok("filtered, the panel keeps its height", menu.offsetHeight === tall, [menu.offsetHeight, tall]);
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
    // in a line that has text: what is chosen applies to that block
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("Second paragraph for the bar and the menu."))));
    type(" /");
    await sleep(300);
    ok("/ after a space in a line with text opens the menu too", menu.hasAttribute("data-open"));
    type("h");
    await sleep(100);
    key(view.dom, "ArrowDown");
    key(view.dom, "Enter");
    await sleep(300);
    ok("Heading 2 chosen: the line becomes that heading, the / is gone", md().includes("\n## Second paragraph for the bar and the menu.\n"), md().slice(40, 140));
    undo(); undo(); undo();
    for (let i = 0; i < 10 && md() !== original; i++) undo();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("Second paragraph"))));
    type("a/b and http://x");
    await sleep(200);
    ok("a / inside a word or an address opens nothing", !menu.hasAttribute("data-open"));
    for (let i = 0; i < 30 && md() !== original; i++) undo();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos("Second paragraph for the bar and the menu."))));
    type(" /tab");
    await sleep(200);
    key(view.dom, "Enter");
    await sleep(300);
    type("x");
    ok("a table chosen in a line with text: it goes below that line", /menu\.\n\n\| x +\| +\|\n/.test(md()), md().slice(60, 180));
    for (let i = 0; i < 30 && md() !== original; i++) undo();
    ok("undone again", md() === original, md().slice(40, 140));

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
