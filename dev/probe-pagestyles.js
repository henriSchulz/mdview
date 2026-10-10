/* Development probe (dev/rig.sh pagestyles): the looks of a page's line that show what is on the
 * page — sheet, preview, widget — in the reading view and in the active mode: what they say,
 * that previews and widgets stand side by side, and that both views lay them out alike. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(900);
    const rows = (style) => [...document.querySelectorAll(`.page-row[data-style="${style}"]`)].filter((r) => r.offsetParent);
    const box = (r) => { const b = r.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top + scrollY), w: Math.round(b.width), h: Math.round(b.height) }; };
    const lay = () => Object.fromEntries(["sheet", "preview", "widget"].map((s) => [s, rows(s).map(box)]));
    const sideBySide = (b) => b.length > 1 && b.every((x) => x.y === b[0].y) && b.every((x, i) => !i || x.x > b[i - 1].x + b[i - 1].w - 1);
    const look = (where) => {
      const l = lay(), w = rows("widget"), s = rows("sheet"), p = rows("preview");
      ok(`${where}: three widgets stand side by side, and so do three previews`, sideBySide(l.widget.slice(0, 3)) && sideBySide(l.preview.slice(0, 3)), l);
      ok(`${where}: a widget shows the page's tasks — what is to do first — and how many are done`, w[0] && [...w[0].querySelectorAll(".page-row-li")].map((x) => x.textContent + (x.classList.contains("done") ? "✓" : "")).join("|") === "Wasserdampf|Drossel|Kolbenarbeit✓|Kreisprozess✓" && w[0].querySelector(".page-row-count").textContent === "2" && /2 (of|von) 4/.test(w[0].querySelector(".page-row-more").textContent), w[0] && w[0].textContent);
      ok(`${where}: a widget shows the pages in a page, and its text where there is nothing else`, w[1] && [...w[1].querySelectorAll(".page-row-li")].map((x) => x.textContent).join("|") === "Systeme|Hauptsatz" && w[2] && w[2].querySelector(".page-row-ex").textContent.startsWith("Ideales Gas"), [w[1] && w[1].textContent, w[2] && w[2].textContent]);
      ok(`${where}: a sheet says how the page begins and how much is on it; sheets lie behind it where pages are in it`, s[0] && s[0].querySelector(".page-row-ex").textContent.startsWith("Zustandsgrößen") && /2 (pages|Unterseiten)/.test(s[0].querySelector(".page-row-meta").textContent) && s[0].querySelectorAll(".page-sheet").length === 3 && s[1].querySelectorAll(".page-sheet").length === 1, s[0] && s[0].textContent);
      ok(`${where}: a preview is the sheet with the page's name on it, and the name under it`, p[0] && p[0].querySelector(".page-sheet b").textContent === "Vorlesung 1" && p[0].querySelector(":scope > .page-row-name").textContent === "Vorlesung 1" && p[1].querySelectorAll(".page-sheet i.c").length === 4, p[0] && p[0].innerHTML.slice(0, 300));
      ok(`${where}: nothing of a tile runs out of the column`, [...l.widget, ...l.preview, ...l.sheet].every((b) => b.x + b.w <= document.querySelector(where === "reading" ? "#content" : ".pm").getBoundingClientRect().right + 1), l);
      return l;
    };
    const read = look("reading");
    out("read", {});
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(500);
    const active = look("active");
    const same = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x.x - b[i].x) <= 1 && Math.abs(x.y - b[i].y) <= 2 && Math.abs(x.w - b[i].w) <= 1 && Math.abs(x.h - b[i].h) <= 1);
    ok("both views lay the lines out alike", same(read.sheet, active.sheet) && same(read.preview, active.preview) && same(read.widget, active.widget), { read, active });
    // another style chosen from the line's menu: the file says so, and the page's text stays
    const A = MdActive, view = A.view.pm, md = () => A.view.serialize(false);
    const flat = (items) => items.filter(Boolean).flatMap((i) => [i, ...flat(i.items || [])]);
    const first = () => { let at = -1; view.state.doc.forEach((n, p) => { if (at < 0 && n.type.name === "island" && MdView.core.pages.isRow(n.attrs.raw)) at = p; }); return at; };
    const labels = flat(A.context.nodeItems(view, first(), view.state.doc.nodeAt(first()))).map((i) => i.label);
    ok("the line's menu offers the styles: Row, Card, Sheet, Preview, Widget", ["Row", "Card", "Sheet", "Preview", "Widget"].every((l) => labels.includes(l)) || ["Zeile", "Karte", "Blatt", "Vorschau", "Widget"].every((l) => labels.includes(l)), labels);
    const pick = labels.includes("Preview") ? "Preview" : "Vorschau";
    flat(A.context.nodeItems(view, first(), view.state.doc.nodeAt(first()))).find((i) => i.label === pick).run();
    await sleep(500);
    ok("Preview chosen for a widget: its line says so and is drawn so", /<!-- page preview orange: Übungsblatt 3 #p1 -->/.test(md()) && view.nodeDOM(first()).querySelector('.page-row[data-style="preview"] .page-sheet b'), md().slice(0, 200));
    await sleep(900);
    ok("… and what is on the page is still in the file", /<!-- page preview orange: Übungsblatt 3 -->\n\n- \[x\] Kolbenarbeit/.test(MdView.core.current.text), MdView.core.current.text.slice(0, 200));
    PM.history.undo(view.state, view.dispatch);
    await sleep(400);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("pagestyles", o);
})();
