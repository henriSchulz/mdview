/* Development probe (dev/rig.sh tabs): the tabs of a folder window — a note in a tab of its
 * own, an empty tab and the tiles in it, a PDF kept where it was left, the keys, closing and
 * opening again, each tab's own way back, a tab pulled to another place. Evaluated by mdview.py
 * (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const out = (name, data) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(data) }));
  const key = (k, more = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...more }));
  const els = () => [...document.querySelectorAll("#tabs .tab:not(.leaving)")];
  const labels = () => els().map((t) => t.querySelector(".tab-label").textContent).join();
  const shown = () => els().findIndex((t) => t.getAttribute("aria-selected") === "true");
  const row = (name) => [...document.querySelectorAll(".sb-row[data-real]")].find((r) => r.dataset.real.endsWith("/" + name));
  const cur = () => MdView.core.current && MdView.core.current.name;
  const press = (el) => { const r = el.getBoundingClientRect(); for (const type of ["pointerdown", "pointerup"]) el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); };
  try {
    await sleep(1200);
    const strip = document.getElementById("tabs");
    ok("a folder window has the strip: the house, one tab, a plus", document.body.hasAttribute("data-tabs") && strip.getBoundingClientRect().height > 40 && els().length === 1 && !!strip.querySelector(".tab-home") && !!strip.querySelector(".tab-new"), els().length);
    const first = cur();
    const [n2, n3, n4] = ["basics.md", "obsidian.md", "math.md", "footnotes.md"].filter((n) => n !== first);
    ok("the tab is the note on screen, by its name without the ending", shown() === 0 && labels() === first.replace(/\.md$/, ""), [labels(), first]);
    ok("the note begins under the strip", document.getElementById("content").firstElementChild.getBoundingClientRect().top >= strip.getBoundingClientRect().bottom, document.getElementById("content").firstElementChild.getBoundingClientRect().top);
    const tb = document.getElementById("toolbar").getBoundingClientRect(), lastTab = strip.querySelector(".tab-new").getBoundingClientRect();
    ok("the toolbar floats at the strip's right end, clear of the tabs", lastTab.right < tb.left && tb.top < strip.getBoundingClientRect().bottom, [lastTab.right, tb.left]);

    // Ctrl+click in the sidebar: a tab of its own
    const other = row(n2);
    other.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    await sleep(900);
    const second = cur();
    ok("Ctrl+click on a note: it opens in a second tab, which is shown", els().length === 2 && shown() === 1 && second !== first && other.dataset.real.endsWith("/" + second), [labels(), shown(), second]);
    window.scrollTo(0, 240); await sleep(400);
    const left = window.scrollY;
    press(els()[0]); await sleep(900);
    ok("a click on the first tab: its note again", shown() === 0 && cur() === first, [shown(), cur()]);
    press(els()[1]); await sleep(900);
    ok("and back: the second note, where it was left", shown() === 1 && cur() === second && left > 0 && Math.abs(window.scrollY - left) < 3, [cur(), window.scrollY, left]);

    // a note that has a tab: a plain click goes to that tab
    row(first).click(); await sleep(900);
    ok("a plain click on a note that has a tab shows that tab, and opens no other", els().length === 2 && shown() === 0 && cur() === first, [labels(), shown()]);

    // an empty tab: all notes
    key("t"); await sleep(900);
    const ov = document.getElementById("overview");
    ok("Ctrl+T: an empty tab beside the one shown, with all notes in it", els().length === 3 && shown() === 1 && els()[1].querySelector(".tab-label").textContent === "All Notes" && ov.hasAttribute("data-open"), [labels(), shown(), ov.hasAttribute("data-open")]);
    ov.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await sleep(300);
    ok("Esc leaves the tiles there: nothing is under them", ov.hasAttribute("data-open"));
    out("shot-empty", {}); await sleep(1300);
    const tile = [...ov.querySelectorAll(".ov-item")].find((t) => t.dataset.path && t.dataset.path.endsWith("/" + n3));
    tile.click(); await sleep(900);
    const third = cur();
    ok("a tile chosen: the note is in that tab, the tiles are gone", els().length === 3 && shown() === 1 && tile.dataset.path.endsWith("/" + third) && !ov.hasAttribute("data-open") && els()[1].querySelector(".tab-label").textContent === third.replace(/\.md$/, ""), [labels(), third]);

    // a PDF with the middle button; where it was left
    const pdf = row("paper.pdf");
    pdf.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    for (let i = 0; i < 300 && !document.querySelector(".pdf-page canvas"); i++) await sleep(20);
    await sleep(500);
    ok("the middle button on a PDF: a tab for it, beside the one shown", els().length === 4 && shown() === 2 && cur() === "paper.pdf" && !!document.querySelector(".pdf-page canvas"), [labels(), shown(), cur()]);
    const bar = document.querySelector(".pdf-bar").getBoundingClientRect();
    ok("the PDF's bar stands under the strip", bar.top >= strip.getBoundingClientRect().bottom - 1, bar.top);
    const p2 = document.querySelector('.pdf-page[data-page="2"]');
    window.scrollBy(0, p2.getBoundingClientRect().top - 120); await sleep(400);
    const at = p2.getBoundingClientRect().top; // (page 2 that far under the window's top: the pages' size may be fitted anew, the place in the page holds)
    out("shot-pdf", {}); await sleep(1300);
    key("1", { code: "Digit1" }); await sleep(900);
    ok("Ctrl+1: the first tab", shown() === 0 && cur() === first, [shown(), cur()]);
    key("9", { code: "Digit9" }); await sleep(300);
    ok("Ctrl+9: the last", shown() === 3, shown());
    key("3", { code: "Digit3" });
    for (let i = 0; i < 300 && !(cur() === "paper.pdf" && document.querySelector(".pdf-page canvas")); i++) await sleep(20);
    await sleep(500);
    const back = document.querySelector('.pdf-page[data-page="2"]').getBoundingClientRect().top;
    ok("back in the PDF's tab it stands where it was left", cur() === "paper.pdf" && Math.abs(back - at) < 12, [cur(), back, at]);

    // around with Ctrl+Tab
    key("Tab"); await sleep(700);
    const a = shown();
    key("Tab"); await sleep(700);
    const b = shown();
    key("Tab", { shiftKey: true }); await sleep(700);
    ok("Ctrl+Tab goes to the next tab, around the end; with Shift back", a === 3 && b === 0 && shown() === 3, [a, b, shown()]);

    // each tab has its own way back
    press(els()[1]); await sleep(900);
    row(n4).click(); await sleep(900);
    ok("a plain click on a note without a tab: it takes the tab shown", els().length === 4 && shown() === 1 && cur() === n4, [labels(), cur()]);
    press(els()[0]); await sleep(900);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true })); await sleep(600);
    ok("back in a tab that went nowhere: nothing", cur() === first, cur());
    press(els()[1]); await sleep(900);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true })); await sleep(900);
    ok("back in the tab that did: the note it showed before", shown() === 1 && cur() === third, cur());

    // closing, and opening again
    const before = labels();
    key("w"); await sleep(900);
    ok("Ctrl+W closes the tab shown; the one that takes its place is shown", els().length === 3 && shown() === 1 && cur() === "paper.pdf", [labels(), shown(), cur()]);
    key("t", { shiftKey: true, key: "T" }); await sleep(900);
    ok("Ctrl+Shift+T: it is back, at its place", els().length === 4 && shown() === 1 && labels() === before && cur() === third, [labels(), before]);
    const x = els()[3].querySelector(".tab-x");
    x.click(); await sleep(700);
    ok("the ✕ of a tab not shown closes it; the one shown stays", els().length === 3 && shown() === 1 && cur() === third, [labels(), shown()]);
    els()[0].dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })); await sleep(700);
    ok("the middle button on a tab closes it", els().length === 2 && shown() === 0 && cur() === third, [labels(), shown()]);

    // a tab pulled behind the other
    {
      const [one, two] = els(), r = one.getBoundingClientRect(), step = two.getBoundingClientRect().left - r.left, y = r.top + r.height / 2, x0 = r.left + 30;
      const ev = (type, x) => one.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y }));
      const was = labels().split(",");
      ev("pointerdown", x0); ev("pointermove", x0 + 20); ev("pointermove", x0 + step * 0.8);
      await sleep(300);
      ok("a tab pulled sideways: the other makes room", /translateX\(-/.test(two.style.transform), two.style.transform);
      out("shot-pull", {}); await sleep(1300);
      ev("pointerup", x0 + step * 0.8); await sleep(900);
      ok("let go, it stands behind it, and is still the one shown", labels() === [was[1], was[0]].join() && shown() === 1 && cur() === third, [labels(), shown()]);
    }
    // the file's menu and the tab's
    {
      const menu = document.getElementById("ctxmenu"), t = els()[0], r = t.getBoundingClientRect();
      t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10 })); await sleep(300);
      const cmds = [...menu.querySelectorAll(".menu-item:not([hidden])")].map((b) => b.dataset.cmd).join();
      ok("right click on a tab: new, reopen, close, close the others", menu.hasAttribute("data-open") && cmds === "tab:new,tab:reopen,tab:close,tab:others", cmds);
      out("shot-menu", {}); await sleep(1300);
      menu.querySelector('[data-cmd="tab:others"]').click(); await sleep(900);
      ok("Close Other Tabs: one is left, the window shows it", els().length === 1 && shown() === 0 && cur() === els()[0].dataset.path.replace(/^.*\//, ""), [labels(), cur()]);
    }
    // the last tab's note in the trash: an empty tab
    key("t"); await sleep(700);
    key("w"); await sleep(700);
    ok("an empty tab opened and closed again: as before", els().length === 1 && !document.getElementById("overview").hasAttribute("data-open"), labels());
    row(first).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })); await sleep(900);
    out("shot-tabs", {}); await sleep(1300);
  } catch (e) { o.error = String(e.stack || e); }
  out("tabs", o);
})();
