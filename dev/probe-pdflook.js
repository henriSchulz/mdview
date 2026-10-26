/* Development probe (dev/rig.sh pdflook): a PDF in a folder window as it looks — the toolbar with the PDF's
 * controls beside the tabs, the panel at the left, the whiteboard over the pages under the tabs, the
 * pens' tray. Screenshots only (the rig takes one at each step); a few measures. */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const out = (name, data) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(data) }));
  const shot = async (name) => { out("look-" + name, {}); await sleep(1500); };
  try {
    await sleep(1200);
    const row = [...document.querySelectorAll(".sb-row[data-real]")].find((r) => r.dataset.real.endsWith("/paper.pdf"));
    if (row) row.click();
    ok("the PDF is shown", await until(() => window.MdPdf && MdPdf.shown && MdPdf.shown.pages[0].state === "done"));
    const V = MdPdf.shown, tb = document.getElementById("toolbar"), strip = document.getElementById("tabs");
    ok("the PDF's controls stand in the toolbar", V.bar.parentElement === tb && !!tb.querySelector('.pdf-bar [data-do="draw"]'));
    ok("… beside the tabs, in their row", tb.getBoundingClientRect().bottom <= strip.getBoundingClientRect().bottom, [tb.getBoundingClientRect().bottom, strip.getBoundingClientRect().bottom]);
    ok("the modes are not there for a PDF", !tb.querySelector(".seg").offsetWidth);
    await shot("view");
    V.bar.querySelector('[data-do="side"]').click(); await sleep(700);
    const card = document.querySelector(".pdf-card").getBoundingClientRect();
    ok("the panel lies at the window's left edge, from under the tabs to the foot", card.left <= 1 && Math.abs(card.top - strip.getBoundingClientRect().bottom) <= 2 && Math.abs(card.bottom - innerHeight) <= 1, [card.left, card.top, card.bottom]);
    await shot("side");
    V.bar.querySelector('[data-do="side"]').click(); await sleep(500);
    V.bar.querySelector('[data-do="draw"]').click();
    ok("the board comes", await until(() => window.MdBoard && MdBoard.shown && document.querySelector("#board[data-open][data-pdf]"), 5000));
    await sleep(800);
    const bd = document.getElementById("board").getBoundingClientRect();
    ok("… under the tabs", Math.abs(bd.top - strip.getBoundingClientRect().bottom) <= 2, [bd.top]);
    ok("the toolbar has the pen alone, pressed", [...tb.querySelectorAll("button")].filter((b) => b.offsetWidth).length === 1 && V.bar.querySelector('[data-do="draw"]').getAttribute("aria-pressed") === "true");
    await shot("draw");
    const marker = document.querySelector('#board .bd-tool[data-tool="marker"]');
    if (marker) marker.click();
    await sleep(500);
    await shot("marker");
    V.bar.querySelector('[data-do="draw"]').click();
    ok("the pen pressed again ends the drawing", await until(() => !MdBoard.shown, 3000));
    await sleep(600);
    ok("the toolbar has the PDF's controls again", !!V.bar.querySelector('[data-do="in"]').offsetWidth && V.bar.querySelector('[data-do="draw"]').getAttribute("aria-pressed") === "false");
    await shot("back");
    // the sidebar pinned (#3): the board begins beside its card, not over it, and the pages stay where they stood
    MdPage.showSidebar(true, false); await sleep(800);
    const sb = document.getElementById("sidebar").getBoundingClientRect(), page = V.pages[0].div.getBoundingClientRect();
    V.bar.querySelector('[data-do="draw"]').click();
    ok("pinned sidebar: the board comes", await until(() => MdBoard.shown && document.querySelector("#board[data-open][data-pdf]"), 5000));
    await sleep(800);
    const bd2 = document.getElementById("board").getBoundingClientRect(), mid = document.elementFromPoint(sb.left + sb.width / 2, sb.top + sb.height / 2);
    ok("… beside the sidebar's card, not over it", bd2.left >= sb.right && !!mid?.closest("#sidebar"), [bd2.left, sb.right, mid?.id || mid?.className]);
    const sheet = document.querySelector("#board .bd-sheet")?.getBoundingClientRect();
    ok("… the page where it stood", !!sheet && Math.abs(sheet.left - page.left) <= 2 && Math.abs(sheet.width - page.width) <= 2, [sheet?.left, page.left, sheet?.width, page.width]);
    await shot("draw-pinned");
    V.bar.querySelector('[data-do="draw"]').click();
    ok("… the pen pressed again ends it", await until(() => !MdBoard.shown, 3000));
    await sleep(600);
    const page2 = V.pages[0].div.getBoundingClientRect();
    ok("… the page where it stood after", Math.abs(page2.left - page.left) <= 2, [page2.left, page.left]);
    // All Notes over the PDF (#5): the PDF's controls go with the PDF, and come back with it
    const seen = (el) => { if (!el || !el.getClientRects().length) return false; for (let x = el; x && x.nodeType === 1; x = x.parentElement) { const st = getComputedStyle(x); if (st.visibility === "hidden" || +st.opacity === 0) return false; } return true; };
    document.querySelector('#tabs [data-act="overview"]').click();
    ok("All Notes over the PDF: shown", await until(() => document.body.hasAttribute("data-overview")));
    await sleep(600);
    ok("… the PDF's controls are not in sight", !seen(V.bar.querySelector('[data-do="in"]')));
    MdOverview.close();
    ok("… back to the PDF", await until(() => !document.body.hasAttribute("data-overview")));
    await sleep(600);
    ok("… its controls in sight again", seen(V.bar.querySelector('[data-do="in"]')));
  } catch (e) { o.error = String(e && e.stack || e); }
  out("pdflook", o);
})();
