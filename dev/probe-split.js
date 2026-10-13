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
    ok("the menu of the tab in the window: Show in Split View is there, and cannot be chosen (it is in the window)", !!entry("tab:split") && entry("tab:split").disabled && entry("tab:unsplit").hidden, entry("tab:split") && [entry("tab:split").disabled, entry("tab:split").hidden]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(200);
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
      ok("what the sheet is stands in a capsule in its corner, with what is done with it", !!pane().querySelector(".split-cap .split-name") && pane().querySelectorAll(".split-cap button").length === 2 && !pane().querySelector(".split-head"));
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
    const link = sheet().querySelector('a.wikilink[data-wiki]');
    ok("its links are found from its own place", !!link && link.dataset.wiki === "Gamma", sheet().innerHTML.slice(0, 200));
    link.click();
    ok("a link in the sheet leads on in the sheet", await until(() => /Gamma\.md$/.test(P.splitState().path) && /Third/.test(sheet().textContent), 4000) && /Alpha\.md$/.test(MdView.core.current.path), [P.splitState(), MdView.core.current.path]);
    // a PDF beside the note
    P.splitOpen({ path: root() + "/paper.pdf" });
    ok("a PDF beside the note: a place for each page, the first drawn", await until(() => sheet().querySelectorAll(".split-page").length === 3 && sheet().querySelector(".split-page img") && sheet().querySelector(".split-page img").naturalHeight > 0, 10000), sheet().innerHTML.slice(0, 160));
    out("pdf", {});
    await sleep(900);
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
    pane().querySelector('[data-do="over"]').click();
    ok("Open at the Left: the note beside is the window's, and the sheet is gone", await until(() => /Beta\.md$/.test(MdView.core.current.path) && !P.splitState() && !document.body.dataset.split, 4000), [MdView.core.current.path, P.splitState()]);
    ok("… the note has the window's whole width again", await until(() => getComputedStyle(document.body).paddingRight === "0px", 2000), getComputedStyle(document.body).paddingRight);
    void was;
    if (errs.length) ok("no script errors", false, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("split", o);
})();
