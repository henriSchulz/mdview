/* Development probe (dev/rig.sh split): a note and a PDF side by side, and nothing else — two notes, the note beside itself, are
 * not opened, and close when the window comes to hold them; a PDF's pages beside a note; swapped, a note beside a PDF, written in; a
 * link in the sheet at the right leads on there; closed, the note has the window again. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(1200);
    const P = window.MdPage, root = () => MdView.core.folder.root, open = (name) => window.MdHost.post(JSON.stringify({ type: "note", path: root() + "/" + name }));
    await until(() => MdView.core.folder && MdView.core.folder.root);
    if (window.MdOverview && MdOverview.shown) MdOverview.close();
    open("Alpha.md");
    ok("the note is in the window", await until(() => MdView.core.current && /Alpha\.md$/.test(MdView.core.current.path) && document.getElementById("content").textContent.includes("Some text")));
    // (the rig's window can be half as wide as a window is: the page is told it has room, and what is seen of the two halves is
    // checked only where it has — `wide`)
    const real = innerWidth; let said = real;
    Object.defineProperty(window, "innerWidth", { configurable: true, get: () => said });
    const wide = real >= 760, pane = () => document.getElementById("split"), sheet = () => pane().querySelector(".split-doc");
    const seen = () => { const c = getComputedStyle(pane()); return c.display !== "none" && c.visibility === "visible" && c.opacity === "1"; };
    ok("the toolbar has no button for it: it is asked for where the thing is", !document.querySelector("#toolbar .tb-split, #toolbar [data-act='split']"));
    // tabs beside the one in the window — a note, a PDF — and their menus
    window.MdHost.post(JSON.stringify({ type: "note", path: root() + "/sub/Beta.md", tab: true }));
    await until(() => document.querySelectorAll("#tabs .tab[data-path]").length >= 2 && /Beta\.md$/.test(MdView.core.current.path), 4000);
    window.MdHost.post(JSON.stringify({ type: "note", path: root() + "/paper.pdf", tab: true }));
    await until(() => document.querySelectorAll("#tabs .tab[data-path]").length >= 3 && /paper\.pdf$/.test(MdView.core.current.path), 6000);
    const tabOf = (name) => [...document.querySelectorAll("#tabs .tab")].find((t) => (t.dataset.path || "").endsWith(name));
    const menu = async (tab) => { tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: tab.getBoundingClientRect().left + 20, clientY: tab.getBoundingClientRect().top + 10 })); await sleep(250); return (cmd) => document.querySelector(`#ctxmenu [data-cmd="${cmd}"]`); };
    const shut = async () => { document.getElementById("ctxmenu").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(150); };
    window.MdHost.post(JSON.stringify({ type: "tab", op: "select", id: Number(tabOf("Alpha.md").dataset.id) }));
    await until(() => /Alpha\.md$/.test(MdView.core.current.path), 4000);
    // only a note and a PDF are side by side (Henri, 2026-10-26: "two notes side by side should no longer be possible")
    let entry = await menu(tabOf("Alpha.md"));
    ok("the menu of the tab in the window: Show in Split View is not for it (the note beside its own reading is the mode's)", !!entry("tab:split") && entry("tab:split").disabled && entry("tab:unsplit").hidden, entry("tab:split") && [entry("tab:split").disabled, entry("tab:split").hidden]);
    await shut();
    entry = await menu(tabOf("Beta.md"));
    ok("the menu of another note's tab: Show in Split View dimmed — two notes are not side by side", entry("tab:split").disabled, entry("tab:split").outerHTML.slice(0, 160));
    await shut();
    said = Math.max(real, 1200);
    P.splitOpen({ path: root() + "/sub/Beta.md" });
    await sleep(200);
    ok("… asked for all the same: nothing is opened, and it says what can be", !P.splitState() && !document.body.dataset.split && /a note and a PDF|eine Notiz und ein PDF/.test((document.querySelector("#toast, .toast") || {}).textContent || ""), [P.splitState(), (document.querySelector("#toast, .toast") || {}).textContent]);
    P.splitOpen(null);
    await sleep(100);
    ok("… nor the note beside itself", !P.splitState() && !document.body.dataset.split, P.splitState());
    said = real;
    const was = document.getElementById("content").getBoundingClientRect();
    // a window with no room for two: said, and nothing half shown
    said = 480;
    entry = await menu(tabOf("paper.pdf"));
    ok("the menu of a PDF's tab beside a note: Show in Split View", !entry("tab:split").disabled && !entry("tab:split").hidden && /Split View/.test(entry("tab:split").textContent), entry("tab:split").outerHTML.slice(0, 160));
    entry("tab:split").click();
    await sleep(200);
    ok("a window too narrow for two: nothing is opened, and it says why", !P.splitState() && !document.body.dataset.split && /narrow|schmal/.test((document.querySelector("#toast, .toast") || {}).textContent || ""), [P.splitState(), (document.querySelector("#toast, .toast") || {}).textContent]);
    said = Math.max(real, 1200);
    entry = await menu(tabOf("paper.pdf"));
    entry("tab:split").click();
    ok("chosen: that tab's PDF beside the note in the window, which stays", await until(() => pane() && P.splitState() && P.splitState().kind === "pdf" && sheet().querySelector(".split-page") && (!wide || seen()), 6000) && /Alpha\.md$/.test(MdView.core.current.path), [P.splitState(), MdView.core.current.path]);
    if (wide) ok("… the note keeps the room at the left of it: neither lies on the other", document.getElementById("content").getBoundingClientRect().right <= pane().getBoundingClientRect().left + 1 && pane().getBoundingClientRect().width > 200, [document.getElementById("content").getBoundingClientRect().right, pane().getBoundingClientRect().left]);
    entry = await menu(tabOf("Beta.md"));
    ok("while two are side by side a tab's menu closes the split view", !entry("tab:unsplit").hidden);
    entry("tab:unsplit").click(); await sleep(200);
    ok("… closed from there", !P.splitState() && !document.body.dataset.split);
    P.splitOpen({ path: root() + "/paper.pdf" });
    await until(() => P.splitState() && sheet().querySelector(".split-page"), 6000);
    // two halves of one kind: each with a run of its own, a line between them to pull
    {
      const grip = pane().querySelector(".split-grip");
      ok("the window's own scrollbar is put away: each half has its run", ["none"].includes(getComputedStyle(document.documentElement).scrollbarWidth) || !wide, getComputedStyle(document.documentElement).scrollbarWidth);
      ok("what the sheet is stands in a capsule in its corner, with what is done with it", !!pane().querySelector(".split-cap .split-name") && pane().querySelectorAll(".split-cap button").length === 3 && !pane().querySelector(".split-head"));
      // the line between the halves, pulled: the sheet's share follows, within what both need; a double click halves again
      const share = () => Number(getComputedStyle(document.documentElement).getPropertyValue("--split-r"));
      const at = (type, x) => grip.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 300, pointerId: 5, button: 0, isPrimary: true }));
      grip.setPointerCapture = () => {}; // (a made-up pointer cannot be held)
      at("pointerdown", innerWidth / 2); at("pointermove", innerWidth * 0.4); at("pointerup", innerWidth * 0.4);
      ok("the line pulled to the left: the sheet has more of the window", Math.abs(share() - 0.6) < 0.02, share());
      at("pointerdown", innerWidth * 0.4); at("pointermove", innerWidth * 0.98); at("pointerup", innerWidth * 0.98);
      ok("… pulled far to the right: it keeps room to be read in", Math.abs(share() - 0.3) < 0.01, share());
      grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      ok("a double click on the line: halves again", share() === 0.5, share());
    }
    // a PDF beside the note
    P.splitOpen({ path: root() + "/paper.pdf" });
    ok("a PDF beside the note: a place for each page, the first drawn", await until(() => sheet().querySelectorAll(".split-page").length === 3 && sheet().querySelector(".split-page img") && sheet().querySelector(".split-page img").naturalHeight > 0, 10000), sheet().innerHTML.slice(0, 160));
    out("pdf", {});
    await sleep(900);
    // the viewer's plain controls over the pages: the page, larger and smaller, fitted — and neither the side card nor the pen
    {
      const bar = pane().querySelector(".split-bar"), D = P.splitPdf(), st = () => P.splitState().pdf, b = pane().querySelector(".split-body");
      await until(() => D || P.splitPdf(), 3000);
      const doIt = P.splitPdf(), names = [...bar.querySelectorAll("button")].map((x) => x.getAttribute("aria-label"));
      ok("the PDF beside a note has the viewer's plain controls", !bar.hidden && !!bar.querySelector(".pdf-page-in") && bar.querySelector(".pdf-of").textContent.trim() === "/ 3" && names.join() === "Zoom out,Zoom in,Fit width,Fit page", names);
      ok("… and neither the side card nor the pen", !bar.querySelector('[data-do="side"], [data-do="draw"], [data-do="rect"]'));
      const w0 = st().wide;
      bar.querySelector('[data-pdf="in"]').click();
      ok("larger: the pages are broader, and no longer fitted", st().wide > w0 * 1.1 && st().fit === null && bar.querySelector('[data-pdf="width"]').getAttribute("aria-pressed") === "false" && /%$/.test(bar.querySelector(".pdf-zoom").textContent), st());
      ok("… and drawn as large as they are shown, once it rests", await until(() => Number(sheet().querySelector(".split-page").dataset.wide) === st().wide, 6000), [sheet().querySelector(".split-page").dataset.wide, st().wide]);
      bar.querySelector('[data-pdf="width"]').click();
      ok("Fit width: as broad as the half lets them be", st().fit === "width" && Math.abs(st().wide - (b.clientWidth - 48)) <= 2, [st(), b.clientWidth]);
      bar.querySelector('[data-pdf="page"]').click();
      ok("Fit page: a whole page in sight", st().fit === "page" && sheet().querySelector(".split-page").getBoundingClientRect().height <= b.clientHeight, [st(), sheet().querySelector(".split-page").getBoundingClientRect().height, b.clientHeight]);
      bar.querySelector('[data-pdf="width"]').click();
      const input = bar.querySelector(".pdf-page-in");
      input.value = "3"; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      ok("a page's number and Enter: there", await until(() => doIt.now() === 3 && input.value === "3", 2000), [doIt.now(), input.value]);
    }
    // over the pages, as in the viewer: their text to select and copy, a link to it, the PDF's own links (Henri, 2026-10-14)
    {
      const b = pane().querySelector(".split-body"), doIt = P.splitPdf();
      doIt.go(1);
      const first = () => sheet().querySelector('.split-page[data-page="1"]');
      ok("a page beside a note has its text over it, to be selected", await until(() => first().querySelectorAll(".textLayer [data-i]").length > 3, 6000), first().innerHTML.slice(0, 120));
      const span = [...first().querySelectorAll(".textLayer [data-i]")].find((x) => /Line 1 of page 1/.test(x.textContent)) || first().querySelector(".textLayer [data-i]");
      const r = document.createRange(); r.selectNodeContents(span); const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      ok("… selected, it is the page's text", /\S/.test(sel.toString()), sel.toString());
      document.getElementById("toast").textContent = "";
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "C", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      ok("Ctrl+Shift+C: a link to the selection copied, as from the viewer", await until(() => /Link to the selection copied/.test(document.getElementById("toast").textContent), 2000), document.getElementById("toast").textContent);
      const link = sheet().querySelector(".split-page .pdf-link");
      ok("the PDF's own links lie over its pages", !!link);
      if (link) { link.click(); ok("… one to another page goes there, beside the note", await until(() => doIt.now() === 3, 3000), doIt.now()); }
    }
    ok("a PDF's pages beside a note have round corners, as a sheet has", parseFloat(getComputedStyle(sheet().querySelector(".split-page")).borderRadius) >= 10, getComputedStyle(sheet().querySelector(".split-page")).borderRadius);
    // a note with a ground of its own: the rail at its right stands on its sheet, not across the sheet's edge
    open("Ground.md");
    await until(() => document.documentElement.dataset.docBg === "cyan" && /Ground\.md$/.test(MdView.core.current.path), 4000);
    await sleep(300);
    {
      const el = document.getElementById("content"), r = el.getBoundingClientRect(), edge = parseFloat(getComputedStyle(el).borderRightWidth), inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--split-in"));
      ok("the sheet's edge is measured for what floats beside the note", Math.abs(inset - (pane().getBoundingClientRect().left - (r.right - edge))) <= 1 && inset >= 10, [inset, pane().getBoundingClientRect().left, r.right, edge]);
      const rail = document.getElementById("rrail");
      if (rail && wide && getComputedStyle(rail).display !== "none") ok("… the rail stands on the sheet, within its edge", rail.getBoundingClientRect().right <= r.right - edge + 1, [rail.getBoundingClientRect().right, r.right - edge]);
    }
    // the two change places: the PDF in the window, the note beside it — read there, and written in
    open("Alpha.md");
    await until(() => /Alpha\.md$/.test(MdView.core.current.path), 4000);
    await sleep(300);
    ok("another note in the window beside the PDF: the PDF stays", P.splitState() && P.splitState().kind === "pdf", P.splitState());
    const left = MdView.core.current.path;
    pane().querySelector('[data-do="over"]').click();
    ok("Swap Sides: the PDF is the window's, and the window's note beside it", await until(() => /paper\.pdf$/.test(MdView.core.current.path) && P.splitState() && P.splitState().kind === "note" && P.splitState().path === left && /Some text/.test(sheet().textContent), 6000), [MdView.core.current.path, P.splitState(), left]);
    out("note", {});
    await sleep(900);
    P.splitOpen({ path: root() + "/sub/Beta.md" });
    ok("another note beside the PDF: its text, read from where it lies", await until(() => P.splitState().kind === "note" && /Beta/.test((sheet().querySelector("h1") || {}).textContent || "") && /More about it/.test(sheet().textContent), 4000), sheet().textContent.slice(0, 80));
    ok("… named in the sheet's head, and the PDF in the window is the same as before", pane().querySelector(".split-cap .split-name").textContent === "Beta" && /paper\.pdf$/.test(MdView.core.current.path));
    // written in, beside the PDF in the window: its source, kept a moment after the last key
    {
      const w = pane().querySelector('[data-do="write"]');
      ok("a note beside can be written in", !!w && !w.hidden);
      w.click();
      const ta = () => sheet().querySelector("textarea.split-src");
      ok("… its source, in the sheet", await until(() => ta() && ta().value.startsWith("# Beta"), 2000) && w.getAttribute("aria-pressed") === "true", sheet().innerHTML.slice(0, 120));
      ta().value = ta().value.replace("More about it", "More about it, written beside");
      ta().dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(1300);
      ta().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      ok("Esc: read again, as it was written", await until(() => !ta() && /written beside/.test(sheet().textContent), 2000), sheet().textContent.slice(0, 80));
      P.splitOpen({ path: root() + "/sub/Beta.md" });
      ok("… and kept: read anew from the file, it says so", await until(() => /written beside/.test(sheet().textContent), 4000), sheet().textContent.slice(0, 80));
      ok("the PDF in the window was left alone", /paper\.pdf$/.test(MdView.core.current.path));
    }
    const link = sheet().querySelector('a.wikilink[data-wiki]');
    ok("its links are found from its own place", !!link && link.dataset.wiki === "Gamma", sheet().innerHTML.slice(0, 200));
    link.click();
    ok("a link to a note in the sheet leads on in the sheet", await until(() => /Gamma\.md$/.test(P.splitState().path) && /Third/.test(sheet().textContent), 4000) && /paper\.pdf$/.test(MdView.core.current.path), [P.splitState(), MdView.core.current.path]);
    // back: the note in the window, written there in any mode, the PDF beside it
    P.splitOpen({ path: root() + "/sub/Beta.md" });
    await until(() => /More about it/.test(sheet().textContent), 4000);
    pane().querySelector('[data-do="over"]').click();
    ok("Swap Sides again: the note is the window's, the PDF beside it", await until(() => /Beta\.md$/.test(MdView.core.current.path) && P.splitState() && P.splitState().kind === "pdf", 6000), [MdView.core.current.path, P.splitState()]);
    MdView.setMode("active");
    ok("… where it is written in any mode, the active one too", await until(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm.editable && /More about it/.test(MdActive.view.pm.dom.textContent), 5000));
    MdView.setMode("read");
    await sleep(300);
    // the window comes to hold what would be two of a kind: the sheet closes
    open("other.pdf");
    ok("another PDF in the window beside the PDF: the sheet closes", await until(() => /other\.pdf$/.test(MdView.core.current.path) && !P.splitState() && !document.body.dataset.split, 6000), [MdView.core.current.path, P.splitState()]);
    P.splitOpen({ path: root() + "/sub/Beta.md" });
    await until(() => P.splitState() && P.splitState().kind === "note", 4000);
    open("Alpha.md");
    ok("a note in the window beside a note: the sheet closes", await until(() => /Alpha\.md$/.test(MdView.core.current.path) && !P.splitState() && !document.body.dataset.split, 6000), [MdView.core.current.path, P.splitState()]);
    void was;
    if (errs.length) ok("no script errors", false, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("split", o);
})();
