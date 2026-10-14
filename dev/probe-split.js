/* Development probe (dev/rig.sh split): two things side by side — the note as it reads beside its source, following what is typed;
 * another note; a PDF's pages; a link in the sheet at the right leads on there; closed, the note has the window again. */
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
    // a second tab, and its menu
    window.MdHost.post(JSON.stringify({ type: "note", path: root() + "/sub/Beta.md", tab: true }));
    await until(() => document.querySelectorAll("#tabs .tab[data-path]").length >= 2 && /Beta\.md$/.test(MdView.core.current.path), 4000);
    const tabOf = (name) => [...document.querySelectorAll("#tabs .tab")].find((t) => (t.dataset.path || "").endsWith(name));
    const menu = async (tab) => { tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: tab.getBoundingClientRect().left + 20, clientY: tab.getBoundingClientRect().top + 10 })); await sleep(250); return (cmd) => document.querySelector(`#ctxmenu [data-cmd="${cmd}"]`); };
    window.MdHost.post(JSON.stringify({ type: "tab", op: "select", id: Number(tabOf("Alpha.md").dataset.id) }));
    await until(() => /Alpha\.md$/.test(MdView.core.current.path), 4000);
    let entry = await menu(tabOf("Alpha.md"));
    ok("the menu of the tab in the window: Show in Split View — the note as it reads, beside itself", !!entry("tab:split") && !entry("tab:split").disabled && entry("tab:unsplit").hidden, entry("tab:split") && [entry("tab:split").disabled, entry("tab:split").hidden]);
    said = Math.max(real, 1200);
    entry("tab:split").click();
    ok("… chosen: the sheet at the right is the note in the window, as it reads", await until(() => P.splitState() && P.splitState().kind === "self" && /Some text/.test(sheet().textContent), 3000), P.splitState());
    P.splitClose(); await sleep(200);
    said = real;
    const was = document.getElementById("content").getBoundingClientRect();
    // a window with no room for two: said, and nothing half shown
    said = 480;
    entry = await menu(tabOf("Beta.md"));
    ok("the menu of a tab that is not in the window: Show in Split View", !entry("tab:split").disabled && !entry("tab:split").hidden && /Split View/.test(entry("tab:split").textContent), entry("tab:split").outerHTML.slice(0, 160));
    entry("tab:split").click();
    await sleep(200);
    ok("a window too narrow for two: nothing is opened, and it says why", !P.splitState() && !document.body.dataset.split && /narrow|schmal/.test((document.querySelector("#toast, .toast") || {}).textContent || ""), [P.splitState(), (document.querySelector("#toast, .toast") || {}).textContent]);
    said = Math.max(real, 1200);
    entry = await menu(tabOf("Beta.md"));
    entry("tab:split").click();
    ok("chosen: that tab's note beside the one in the window, which stays", await until(() => pane() && P.splitState() && P.splitState().kind === "note" && /More about it/.test(sheet().textContent) && (!wide || seen()), 4000) && /Alpha\.md$/.test(MdView.core.current.path), [P.splitState(), MdView.core.current.path]);
    entry = await menu(tabOf("Beta.md"));
    ok("while two are side by side a tab's menu closes the split view", !entry("tab:unsplit").hidden);
    entry("tab:unsplit").click(); await sleep(200);
    ok("… closed from there", !P.splitState() && !document.body.dataset.split);
    // the note beside its own reading (nothing in the window asks for it yet: the page's own way in)
    P.splitOpen(null);
    ok("the note as it reads, in a sheet at the window's right", await until(() => pane() && P.splitState().kind === "self" && /Some text/.test(sheet().textContent) && !!sheet().querySelector("h1") && (!wide || seen())), pane() && sheet().innerHTML.slice(0, 120));
    if (wide) ok("… the note keeps the room at the left of it: neither lies on the other", document.getElementById("content").getBoundingClientRect().right <= pane().getBoundingClientRect().left + 1 && pane().getBoundingClientRect().width > 200, [document.getElementById("content").getBoundingClientRect().right, pane().getBoundingClientRect().left]);
    // two halves of one kind: the same type, the first line at the same height, each with a run of its own, a line between them to pull
    {
      const l = document.querySelector("#content h1"), r = sheet().querySelector("h1"), grip = pane().querySelector(".split-grip");
      ok("the same type in both halves", getComputedStyle(document.querySelector("#content p")).fontSize === getComputedStyle(sheet().querySelector("p")).fontSize && getComputedStyle(l).fontSize === getComputedStyle(r).fontSize, [getComputedStyle(l).fontSize, getComputedStyle(r).fontSize]);
      if (wide) ok("… and their first lines at one height", Math.abs(l.getBoundingClientRect().top - r.getBoundingClientRect().top) <= 2, [l.getBoundingClientRect().top, r.getBoundingClientRect().top]);
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
    // the source written at the left, read at the right
    MdView.setMode("edit");
    await until(() => document.body.dataset.view === "edit");
    const ed = P.edInput;
    ed.value = ed.value + "\n\n## Typed just now\n\nA new line.\n";
    ed.dispatchEvent(new Event("input", { bubbles: true }));
    ok("the source written at the left is read at the right a moment later", await until(() => /Typed just now/.test((sheet().querySelector("h2:last-of-type") || {}).textContent || "") && /A new line\./.test(sheet().textContent), 3000), sheet().textContent.slice(-80));
    out("self", {});
    await sleep(900);
    MdView.setMode("read"); await until(() => (document.body.dataset.view || "read") === "read");
    // another note beside it
    P.splitOpen({ path: root() + "/sub/Beta.md" });
    ok("another note beside it: its text, read from where it lies", await until(() => P.splitState().kind === "note" && /Beta/.test((sheet().querySelector("h1") || {}).textContent || "") && /More about it/.test(sheet().textContent), 4000), sheet().textContent.slice(0, 80));
    ok("… named in the sheet's head, and the note at the left is the same as before", pane().querySelector(".split-cap .split-name").textContent === "Beta" && /Alpha\.md$/.test(MdView.core.current.path));
    // written in, beside the note in the window: its source, kept a moment after the last key
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
      ok("the note in the window was left alone", /Alpha\.md$/.test(MdView.core.current.path) && /Some text/.test(document.getElementById("content").textContent));
    }
    const link = sheet().querySelector('a.wikilink[data-wiki]');
    ok("its links are found from its own place", !!link && link.dataset.wiki === "Gamma", sheet().innerHTML.slice(0, 200));
    link.click();
    ok("a link in the sheet leads on in the sheet", await until(() => /Gamma\.md$/.test(P.splitState().path) && /Third/.test(sheet().textContent), 4000) && /Alpha\.md$/.test(MdView.core.current.path), [P.splitState(), MdView.core.current.path]);
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
    // what is beside the note, opened at the left
    P.splitOpen({ path: root() + "/sub/Beta.md" });
    await until(() => /More about it/.test(sheet().textContent), 4000);
    const left = MdView.core.current.path;
    pane().querySelector('[data-do="over"]').click();
    ok("Swap Sides: the note beside is the window's, and the window's note beside it", await until(() => /Beta\.md$/.test(MdView.core.current.path) && P.splitState() && P.splitState().path === left, 5000), [MdView.core.current.path, P.splitState() && P.splitState().path, left]);
    MdView.setMode("active");
    ok("… where it is written in any mode, the active one too", await until(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm.editable && /More about it/.test(MdActive.view.pm.dom.textContent), 5000));
    MdView.setMode("read");
    void was;
    if (errs.length) ok("no script errors", false, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("split", o);
})();
