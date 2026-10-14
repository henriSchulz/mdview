/* Development probe (dev/rig.sh panel): the panel at the window's right — its Document tab (the
 * note counted, a ground and a wide page chosen beside the reading view and in the active mode:
 * written into the note's properties, shown by the page), its Insert tab (tiles, search, a click,
 * a drop between blocks) and its Format tab (what is on, and changing it). At its end the note
 * says "background: green" and "wide: true" — the rig looks for them in the file. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready; await sleep(700);
    // (the wide column beside the panel wants a window of 1400 px: in a narrower one the page is made smaller until it has them)
    if (innerWidth < 1400) { window.MdHost.post(JSON.stringify({ type: "zoom", step: -Math.ceil((1 - innerWidth / 1400) * 10) })); await sleep(600); }
    // (no button of its own in the toolbar any more — the rail at the window's edge, and Ctrl+Alt+P: that key stands in for it here)
    ok("the toolbar has no button for the panel", !document.querySelector('#toolbar [data-act="panel"]'));
    const btn = { click: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, altKey: true, bubbles: true, cancelable: true })) };
    MdView.setMode("read");
    for (let i = 0; i < 300 && document.body.dataset.view === "active"; i++) await sleep(10);
    await sleep(400);
    // --- Document, beside the reading view
    const core = MdView.core, root = document.documentElement, content = document.getElementById("content");
    const text = () => core.current.text, fact = (k) => document.querySelector(`#rpanel [data-fact="${k}"]`).textContent;
    const ground = (name) => [...document.querySelectorAll("#rpanel .rp-ground")].find((b) => b.getAttribute("aria-label") === name);
    const tabs = () => [...document.querySelectorAll("#rrail .rp-tab")].map((b) => b.getAttribute("aria-label") + (b.disabled ? "-" : "") + (b.getAttribute("aria-selected") === "true" ? "*" : "")).join(" ");
    // (a colour as the screen has it, whatever way the browser writes it; the text column: as wide as the note's title)
    const rgb = (c) => { const x = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data]; };
    const bgOf = (el) => rgb(getComputedStyle(el).backgroundColor).join(), widthBox = () => document.querySelector("#rpanel .rp-width"), width = (v) => { const b = widthBox(); b.value = v; b.dispatchEvent(new Event("change", { bubbles: true })); };
    const colW = (el) => el.querySelector("h1").getBoundingClientRect().width;
    const plain = bgOf(document.body), narrow = colW(content);
    // (a ground lies around the note: the window shows it, and the note is a sheet of the theme's own ground on it)
    const sheet = () => document.querySelector(document.body.dataset.view === "active" ? "#active" : "#content"), around = () => getComputedStyle(root).backgroundImage;
    btn.click();
    for (let i = 0; i < 400 && !document.getElementById("rpanel"); i++) await sleep(10);
    await sleep(500);
    const panel0 = document.getElementById("rpanel");
    ok("in the reading view the key opens it on Document, the other tabs dimmed, the mode stays", document.body.dataset.view !== "active" && document.body.hasAttribute("data-panel") && panel0.dataset.tab === "style" && tabs() === "Insert- Format- Style* Information" && window.MdPrefs.panel === true && window.MdPrefs.panelTab === "style", [document.body.dataset.view, tabs(), window.MdPrefs.panelTab]);
    ok("the note made room", content.getBoundingClientRect().right <= panel0.getBoundingClientRect().left + 1 && getComputedStyle(panel0).visibility === "visible", [content.getBoundingClientRect().right, panel0.getBoundingClientRect().left]);
    ok("the note counted: words, characters, reading time, blocks, headings", fact("words") === "582" && fact("chars") === (3108).toLocaleString() && fact("minutes") === "3 min" && fact("blocks") === "46" && fact("headings") === "1", ["words", "chars", "minutes", "blocks", "headings"].map(fact));
    ok("what the note has none of is not listed", document.querySelector('#rpanel [data-fact="tasks"]').parentNode.offsetHeight === 0 && document.querySelector('#rpanel [data-fact="pages"]').parentNode.offsetHeight === 0);
    ok("twelve grounds, none chosen but the theme's own; the page's width normal, of four", document.querySelectorAll("#rpanel .rp-ground").length === 12 && ground("None").getAttribute("aria-checked") === "true" && widthBox().value === "normal" && [...widthBox().options].map((o) => o.value).join() === "narrow,normal,wide,full" && !root.dataset.docBg);
    scrollTo(0, 300); await sleep(100);
    const y0 = scrollY;
    ground("Blue").click();
    await sleep(500);
    ok("a ground chosen beside the reading view: written into the note's properties", text().startsWith("---\nbackground: blue\n---\n\n# Polish") && core.current.raw === text(), text().slice(0, 50));
    ok("… it lies around the note, which is a sheet of the theme's own ground with round corners, and its properties show", root.dataset.docBg === "blue" && around().includes("linear-gradient") && bgOf(document.body) === "0,0,0,0" && bgOf(sheet()) === plain && parseFloat(getComputedStyle(sheet()).borderTopLeftRadius) > 8 && ground("Blue").getAttribute("aria-checked") === "true" && ground("None").getAttribute("aria-checked") === "false" && !!content.querySelector("details.props"), [root.dataset.docBg, bgOf(document.body), plain]);
    ok("… the note stays where it was (but for the properties' own height)", Math.abs(scrollY - y0) < 140 && scrollY > 100, [scrollY, y0]);
    ok("… the text is still read on it", (() => { const c = (s) => rgb(s).slice(0, 3), lum = (v) => { const [r, g, b] = v.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }; const a = lum(c(getComputedStyle(document.body).color)), b2 = lum(c(getComputedStyle(sheet()).backgroundColor)); return (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05) >= 7; })(), [getComputedStyle(document.body).color, bgOf(sheet())]);
    width("wide");
    await sleep(400);
    ok("Page width › Wide: a property too, and the column is a larger share of the window", /^---\nbackground: blue\nwidth: wide\n---\n/.test(text()) && widthBox().value === "wide" && colW(content) > narrow + 100, [text().slice(0, 40), narrow, colW(content)]);
    width("narrow");
    await sleep(300);
    ok("… Narrow: narrower than the normal one", /\nwidth: narrow\n/.test(text()) && colW(content) < narrow - 40, [text().slice(0, 40), colW(content), narrow]);
    width("full");
    await sleep(300);
    ok("… Full Width: as wide as the room the note has", /\nwidth: full\n/.test(text()) && getComputedStyle(content).maxWidth === "none", [text().slice(0, 40), getComputedStyle(content).maxWidth]);
    width("wide");
    await sleep(300);
    const wideRead = colW(content);
    out("shot-document", {});
    await sleep(1500); // screenshot
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
    const before = md().replace(/^---\n[\s\S]*?\n---\n\n/, "");
    // --- Document, in the active mode
    const first = () => view.state.doc.firstChild, keyz = () => view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    ok("into the active mode: the panel stays, its tabs can all be chosen, the ground and the width are the same", document.body.hasAttribute("data-panel") && tabs() === "Insert Format Style* Information" && root.dataset.docBg === "blue" && Math.abs(colW(view.dom) - wideRead) < 1 && first().attrs.kind === "frontmatter", [tabs(), root.dataset.docBg, colW(view.dom), wideRead]);
    caret("Second paragraph");
    scrollTo(0, 260); await sleep(150);
    const y1 = scrollY, sel = () => view.state.selection.$from.parent.textContent + "@" + view.state.selection.$from.parentOffset, sel1 = sel();
    press(ground("Dots"));
    await sleep(300);
    ok("a ground chosen in the active mode: the properties say it, saved at once", /^---\nbackground: dots\nwidth: wide\n---\n\n# Polish/.test(text()) && md().startsWith("---\nbackground: dots\nwidth: wide\n---\n\n# Polish") && !A.view.dirty, text().slice(0, 60));
    ok("… paper: drawn around the note, the body lets it through, the sheet stays plain", root.dataset.docBg === "dots" && around().includes("radial-gradient") && bgOf(document.body) === "0,0,0,0" && bgOf(sheet()) === plain && getComputedStyle(sheet()).backgroundImage === "none", [around().slice(0, 40), bgOf(document.body), bgOf(sheet())]);
    ok("… the caret, the focus and the place in the note stay", sel() === sel1 && view.hasFocus() && scrollY === y1, [sel(), sel1, scrollY, y1]);
    keyz();
    await sleep(1300);
    ok("Ctrl+Z takes it back: one step, and the page follows", /^---\nbackground: blue\nwidth: wide\n---\n/.test(md()) && root.dataset.docBg === "blue" && ground("Blue").getAttribute("aria-checked") === "true", [md().slice(0, 50), root.dataset.docBg]);
    press(ground("None")); width("normal");
    await sleep(300);
    ok("the theme's own ground, the page's width normal: the properties are gone with the last of them", md().startsWith("# Polish") && text().startsWith("# Polish") && !root.dataset.docBg && bgOf(document.body) === plain && Math.abs(colW(view.dom) - narrow) < 2 && first().type.name === "heading", [md().slice(0, 30), root.dataset.docBg, colW(view.dom), narrow]);
    ok("… the caret is where it was", sel() === sel1 && view.hasFocus(), [sel(), sel1]);
    width("wide");
    await sleep(300);
    ok("a note without properties gets them", md().startsWith("---\nwidth: wide\n---\n\n# Polish") && first().attrs.kind === "frontmatter" && sel() === sel1 && Math.abs(colW(view.dom) - wideRead) < 1, [md().slice(0, 40), sel()]);
    width("normal");
    view.dispatch(view.state.tr.insertText(" three more words"));
    await sleep(200);
    ok("while it is typed the numbers wait", fact("words") === "582", fact("words"));
    await sleep(1400);
    ok("… and count after a pause", fact("words") === "585", fact("words"));
    for (let i = 0; i < 12 && md() !== before; i++) keyz();
    await sleep(1300);
    ok("all of it taken back: the note as it was, the page too", md() === before && !root.dataset.docBg && fact("words") === "582", [md().slice(0, 60), root.dataset.docBg, fact("words")]);
    // (dark: the grounds follow the theme's colours)
    {
      const css = document.getElementById("theme").textContent, mode = document.body.dataset.mode, c = (n) => getComputedStyle(root).getPropertyValue("--c-" + n).trim();
      press(ground("Green"));
      await sleep(300);
      const light = around();
      MdView.setTheme(css + `\n:root { --c-background: ${mode === "dark" ? "#f5f5f7" : "#1c1c1e"}; --c-foreground: ${mode === "dark" ? "#1d1d1f" : "#f2f2f7"}; }`, mode === "dark" ? "light" : "dark");
      await sleep(500);
      ok("in the other theme the ground is made of that theme's colours, and the sheet is its own ground", around() !== light && around().includes("linear-gradient") && bgOf(sheet()) === rgb(c("background")).join() && root.dataset.docBg === "green", [light.slice(0, 60), around().slice(0, 60), bgOf(sheet())]);
      out("shot-document-dark", {});
      await sleep(1500); // screenshot
      MdView.setTheme(css, mode);
      press(ground("None"));
      await sleep(300);
    }
    document.querySelector('#rrail .rp-tab[data-tab="insert"]').click();
    btn.click();
    await sleep(500);
    for (let i = 0; i < 12 && md() !== before; i++) keyz();
    await sleep(300);
    ok("closed again, the note as it was", !document.body.hasAttribute("data-panel") && window.MdPrefs.panel === false && md() === before, md().slice(0, 40));

        btn.click();
    await sleep(400);
    ok("in the active mode the key opens it", document.body.hasAttribute("data-panel") && window.MdPrefs.panel === true);
    ok("the Insert tab shows, with its tiles in sections", panel.dataset.tab === "insert" && panel.querySelectorAll(".rp-tile").length === 34 && [...panel.querySelectorAll('[data-pane="insert"] .rp-sec')].map((h) => h.textContent).join("|") === "Blocks|Lists|Decorations|Callout|Columns|Media|Insert Line|Insert Table", [...panel.querySelectorAll('[data-pane="insert"] .rp-sec')].map((h) => h.textContent));
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
    press(tile("Thin Line")); // (a rule, in the look it always had)
    await sleep(200);
    ok("Divider: below the caret's block", /First paragraph[^\n]*\n\n---\n\n> \[!info\]/.test(md()), md().slice(0, 200));
    A.panel.run(A.panel.items.findIndex((i) => i[1][0] === "menu.task"), 0); // (dropped above the first block)
    await sleep(150);
    ok("something dropped above the first block goes there", md().startsWith("- [ ]\n\n# Polish"), md().slice(0, 40));
    for (let i = 0; i < 8 && !md().startsWith("# "); i++) view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    out("shot-insert", {});
    await sleep(1500); // screenshot

    // --- Format
    document.querySelector('#rrail .rp-tab[data-tab="format"]').click();
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
    ok("the key closes it, and the settings know", !document.body.hasAttribute("data-panel") && window.MdPrefs.panel === false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await sleep(300);
    ok("Ctrl+Alt+P opens it again, on the tab it had", document.body.hasAttribute("data-panel") && panel.dataset.tab === "format");
    MdView.setMode("edit");
    await sleep(600);
    ok("beside the source it is not shown, nor its rail", !document.body.hasAttribute("data-panel") && !document.body.hasAttribute("data-rail") && getComputedStyle(panel).visibility === "hidden" && window.MdPrefs.panel === true, [document.body.hasAttribute("data-panel"), document.body.hasAttribute("data-rail")]);
    MdView.setMode("read");
    await sleep(600);
    ok("… nor beside the reading view while its tab is Format", !document.body.hasAttribute("data-panel"));
    MdView.setMode("active");
    await sleep(700);
    ok("… and back in the active mode it is there again", document.body.hasAttribute("data-panel") && panel.dataset.tab === "format");
    document.querySelector('#rrail .rp-tab[data-tab="style"]').click();
    press(ground("Green")); width("wide");
    await sleep(400);
    MdView.setMode("read");
    await sleep(700);
    ok("on Document it stays beside the reading view; the page there as the note says", document.body.hasAttribute("data-panel") && tabs() === "Insert- Format- Style* Information" && root.dataset.docBg === "green" && colW(content) > narrow + 100 && /^---\nbackground: green\nwidth: wide\n---\n/.test(text()), [tabs(), root.dataset.docBg, text().slice(0, 50)]);
    btn.click(); MdView.setMode("active"); await sleep(600);
    // the rail: a press on another sign changes the part, a press on the open part's sign closes the panel
    const sign = (t) => document.querySelector(`#rrail .rp-tab[data-tab="${t}"]`);
    const places = () => [view.dom, document.getElementById("toolbar"), document.getElementById("tabs")].map((x) => (x ? Math.round(x.getBoundingClientRect().left) + ":" + Math.round(x.getBoundingClientRect().width) : "")).join(" ");
    const closedAt = places();
    sign("info").click(); await sleep(500);
    ok("the panel lies over the window: the text column, the toolbar and the tabs stand where they stood", places() === closedAt && getComputedStyle(document.body).paddingRight === "0px", [closedAt, places()]);
    ok("… under the toolbar and beside the rail, covering neither", (() => { const p = panel0.getBoundingClientRect(), t = document.getElementById("toolbar").getBoundingClientRect(), r = document.getElementById("rrail").getBoundingClientRect(); return p.top >= t.bottom && p.right <= r.left; })(), [panel0.getBoundingClientRect().top, document.getElementById("toolbar").getBoundingClientRect().bottom]);
    ok("the rail's sign opens the panel at its part, and the part's name stands at its head", document.body.hasAttribute("data-rail") && document.body.hasAttribute("data-panel") && panel0.dataset.tab === "info" && panel0.querySelector(".rp-title").textContent === "Information" && sign("info").getAttribute("aria-selected") === "true", [panel0.dataset.tab, tabs()]);
    sign("format").click(); await sleep(300);
    ok("another sign: the panel stays and shows that part", document.body.hasAttribute("data-panel") && panel0.dataset.tab === "format" && sign("format").getAttribute("aria-selected") === "true" && sign("info").getAttribute("aria-selected") === "false", tabs());
    sign("format").click(); await sleep(500);
    ok("the open part's sign closes the panel; the rail stays, nothing marked", !document.body.hasAttribute("data-panel") && document.body.hasAttribute("data-rail") && !tabs().includes("*") && window.MdPrefs.panel === false, [tabs(), window.MdPrefs.panel]);
    sign("insert").click(); await sleep(300); btn.click();
    await sleep(900);
    // the rail is the active mode's: away beside the reading view, sliding out to the window's edge — and in again with the active mode
    const rr = document.getElementById("rrail"), railAt = () => [Number(getComputedStyle(rr).opacity).toFixed(2), getComputedStyle(rr).translate];
    if (document.body.dataset.view !== "active") { MdView.setMode("active"); await sleep(900); }
    const shownAt = railAt();
    MdView.setMode("read"); await sleep(70);
    const going = railAt();
    await sleep(700);
    ok("in the reading view no rail at all — it goes out sliding to the edge", !document.body.hasAttribute("data-rail") && getComputedStyle(rr).visibility === "hidden" && shownAt[0] === "1.00" && Number(going[0]) < 1 && going[1] !== "0px" && going[1] !== "none", [shownAt, going, railAt()]);
    MdView.setMode("active"); await sleep(90);
    const coming = railAt();
    await sleep(800);
    ok("… and comes in with the active mode", document.body.hasAttribute("data-rail") && Number(coming[0]) < 1 && /^\d/.test(coming[1]) && coming[1] !== "0px" && railAt()[0] === "1.00", [coming, railAt()]);
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("panel", o);
})();
