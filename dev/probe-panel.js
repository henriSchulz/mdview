/* Development probe (dev/rig.sh panel): the panel at the window's right — its Insert tab (tiles,
 * search, a click, a drop between blocks) and its Format tab (what is on, and changing it). */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready; await sleep(700);
    const btn = document.querySelector('#toolbar [data-act="panel"]');
    ok("the toolbar has the panel's button", !!btn);
    MdView.setMode("read");
    for (let i = 0; i < 300 && document.body.dataset.view === "active"; i++) await sleep(10);
    await sleep(400);
    btn.click(); // in the reading view: nothing
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await sleep(400);
    ok("in the reading view it is dimmed and opens nothing, the mode stays", document.body.dataset.view !== "active" && !document.body.hasAttribute("data-panel") && getComputedStyle(btn).pointerEvents === "none" && !(window.MdPrefs || {}).panel, [document.body.dataset.view, getComputedStyle(btn).pointerEvents]);
    MdView.setMode("active");
    for (let i = 0; i < 400 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(500);
    const A = MdActive, view = A.view.pm, { TextSelection } = PM.state, panel = document.getElementById("rpanel");
    const md = () => A.view.serialize(false);
    const at = (text) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + text.length; }); return f; };
    const caret = (text) => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at(text)))); view.focus(); };
    const tile = (name) => [...panel.querySelectorAll(".rp-tile")].find((t) => t.querySelector(".rp-name").textContent === name);
    const fbtn = (name) => [...panel.querySelectorAll('[data-pane="format"] .rp-btn')].find((b) => b.getAttribute("aria-label") === name);
    const press = (b) => { b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); b.click(); };
    ok("the active mode alone does not open it", !document.body.hasAttribute("data-panel") && getComputedStyle(btn).pointerEvents !== "none");
    btn.click();
    await sleep(400);
    ok("in the active mode the button opens it", document.body.hasAttribute("data-panel") && btn.getAttribute("aria-pressed") === "true" && window.MdPrefs.panel === true);
    ok("the Insert tab shows, with its tiles in sections", panel.dataset.tab === "insert" && panel.querySelectorAll(".rp-tile").length === 27 && [...panel.querySelectorAll('[data-pane="insert"] .rp-sec')].map((h) => h.textContent).join("|") === "Blocks|Lists|Decorations|Callout|Columns|Separators|Media", [...panel.querySelectorAll('[data-pane="insert"] .rp-sec')].map((h) => h.textContent));
    ok("every tile has its picture", [...panel.querySelectorAll(".rp-tile")].every((t) => t.querySelector(".rp-card svg")));
    ok("the text column made room", view.dom.getBoundingClientRect().right <= panel.getBoundingClientRect().left + 1, [view.dom.getBoundingClientRect().right, panel.getBoundingClientRect().left]);

    const search = panel.querySelector(".rp-search input");
    search.value = "wa"; search.dispatchEvent(new Event("input"));
    ok("the search leaves what is called so, and its section", [...panel.querySelectorAll(".rp-tile:not([hidden])")].map((t) => t.textContent).join("|") === "Warning" && [...panel.querySelectorAll('[data-pane="insert"] .rp-sec:not([hidden])')].map((h) => h.textContent).join() === "Callout", [...panel.querySelectorAll(".rp-tile:not([hidden])")].map((t) => t.textContent));
    search.value = "zzz"; search.dispatchEvent(new Event("input"));
    ok("nothing found says so", !panel.querySelector(".rp-none").hidden && !panel.querySelector(".rp-tile:not([hidden])"));
    search.value = ""; search.dispatchEvent(new Event("input"));

    caret("First paragraph");
    press(tile("Info"));
    await sleep(200);
    ok("a click on Info puts a callout below the caret's block, the caret in it", /First paragraph[^\n]*\n\n> \[!info\]\n>\n/.test(md()) && view.state.selection.$from.node(1).attrs.callout === "info" && view.hasFocus(), md().slice(0, 120));
    view.dispatch(view.state.tr.insertText("typed"));
    ok("typed into", md().includes("> [!info]\n> typed\n"));
    press(tile("Table"));
    await sleep(200);
    ok("Table, the caret being in the callout: in there, as the / menu would put it", /> typed\n>\n> \|/.test(md()), md().slice(0, 200));
    caret("First paragraph");
    press(tile("Divider"));
    await sleep(200);
    ok("Divider: below the caret's block", /First paragraph[^\n]*\n\n---\n\n> \[!info\]/.test(md()), md().slice(0, 200));
    A.panel.run(A.panel.items.findIndex((i) => i[1][0] === "menu.task"), 0); // (dropped above the first block)
    await sleep(150);
    ok("something dropped above the first block goes there", md().startsWith("- [ ]\n\n# Polish"), md().slice(0, 40));
    for (let i = 0; i < 8 && !md().startsWith("# "); i++) view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    out("shot-insert", {});
    await sleep(1500); // screenshot

    // --- Format
    panel.querySelector('.rp-tab[data-tab="format"]').click();
    caret("Polish");
    await sleep(120);
    ok("Format shows what the block is", panel.dataset.tab === "format" && fbtn("Heading 1")?.getAttribute("aria-pressed") === "true" && fbtn("Text")?.getAttribute("aria-pressed") === "false" && window.MdPrefs.panelTab === "format");
    caret("Second paragraph");
    await sleep(120);
    ok("… and follows the caret", fbtn("Text").getAttribute("aria-pressed") === "true" && fbtn("Heading 1").getAttribute("aria-pressed") === "false");
    press(fbtn("Heading 2"));
    await sleep(120);
    ok("a click makes the block that, the text keeps the focus", md().includes("## Second paragraph") && fbtn("Heading 2").getAttribute("aria-pressed") === "true" && view.hasFocus(), md().slice(0, 160));
    press(fbtn("Text"));
    press(fbtn("Block")); press(fbtn("Focus"));
    await sleep(120);
    ok("Block and Focus, both on", md().includes("> [!block-focus]\n> Second paragraph") && fbtn("Block").getAttribute("aria-pressed") === "true" && fbtn("Focus").getAttribute("aria-pressed") === "true", md().slice(0, 200));
    press(fbtn("Green"));
    await sleep(120);
    ok("a colour", md().includes("> [!block-focus|green]") && fbtn("Green").getAttribute("aria-pressed") === "true");
    press(fbtn("Warning"));
    await sleep(120);
    ok("a callout instead; colours are not for it", md().includes("> [!warning]\n> Second paragraph") && fbtn("Warning").getAttribute("aria-pressed") === "true" && fbtn("Green").disabled && !!fbtn("Edit Title"), md().slice(0, 200));
    press(fbtn("Warning"));
    press(fbtn("Bold"));
    await sleep(120);
    ok("bold at the caret shows as on", fbtn("Bold").getAttribute("aria-pressed") === "true");
    press(fbtn("Bold"));
    press(fbtn("Bulleted List"));
    await sleep(120);
    ok("a list; its indent can be changed now", md().includes("- Second paragraph") && fbtn("Bulleted List").getAttribute("aria-pressed") === "true" && !fbtn("Increase Indent").disabled);
    press(fbtn("Bulleted List"));
    out("shot-format", {});
    await sleep(1500); // screenshot

    btn.click();
    await sleep(300);
    ok("the button closes it, and the settings know", !document.body.hasAttribute("data-panel") && window.MdPrefs.panel === false && btn.getAttribute("aria-pressed") === "false");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await sleep(300);
    ok("Ctrl+Alt+P opens it again, on the tab it had", document.body.hasAttribute("data-panel") && panel.dataset.tab === "format");
    btn.click(); panel.querySelector('.rp-tab[data-tab="insert"]').click();
    await sleep(900);
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("panel", o);
})();
