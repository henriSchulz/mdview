/* mdview active mode — the panel at the window's right (its rail at the window's
 * edge, Ctrl+Alt+P), as Craft has one: three tabs.
 *
 *   Insert    what can be put into the document, as tiles with a small picture
 *             of each, in sections, with a field to search them. A click puts
 *             the thing below the block the caret is in; dragged, it goes
 *             between the blocks where it is dropped (a line shows where).
 *   Format    what the block the caret is in can be: a text style, a list, a
 *             decoration, a colour, a callout — and bold, italic and the like.
 *             It shows what is on, and follows the caret.
 *   Document  what is the note's as a whole: what it holds, counted (words,
 *             characters, blocks …), the ground it stands on and whether its
 *             page is wide. The last two are properties of the note: chosen
 *             here, they are written into it (viewer.js: docSet).
 *
 * Insert and Format are the active mode's. Style and Info stand in every mode —
 * beside the reading view and beside the source (alone or beside its reading):
 * there the panel shows when one of them is the chosen tab, and its other tabs
 * are dimmed; the rail is the active mode's alone.
 *
 * The Format tab is the "/" menu's entries laid out (slash.js says what is
 * offered where, and does it). The panel never takes the focus from the text,
 * except for its search field. Open or not, and the tab, are settings
 * (panel, panelTab). */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const { Plugin, PluginKey, Selection, TextSelection } = PM.state;
  const N = A.schema.nodes;
  const core = window.MdView.core, { ICON, esc, callout: CALLOUT } = core;
  const post = (type, data = {}) => window.MdHost?.post(JSON.stringify({ type, ...data }));
  const pref = () => ({ panel: false, panelTab: "insert", ...(window.MdPrefs || {}) });
  const view = () => (A.view && A.view.pm) || null;

  // ------------------------------------------------------------ small pictures of what a tile puts in
  const pic = (d, cls = "") => `<svg class="rp-pic ${cls}" viewBox="0 0 44 32" aria-hidden="true">${d}</svg>`;
  const bar = (x, y, w, o = 0.24) => `<rect x="${x}" y="${y}" width="${w}" height="3" rx="1.5" fill="currentColor" opacity="${o}"/>`;
  const tint = (x, y, w, c, o = 0.9) => `<rect x="${x}" y="${y}" width="${w}" height="3" rx="1.5" fill="var(${c})" opacity="${o}"/>`;
  const PIC = {
    table: pic('<rect x="5" y="5" width="34" height="7.4" rx="2.5" fill="currentColor" opacity="0.12"/><rect x="5" y="5" width="34" height="22" rx="2.5" fill="none" stroke="currentColor" stroke-opacity="0.38"/><path d="M5 12.4h34M5 19.7h34M16.4 5v22M27.7 5v22" stroke="currentColor" stroke-opacity="0.26" fill="none"/>'),
    code: pic('<rect x="4" y="4" width="36" height="24" rx="4" fill="currentColor" opacity="0.09"/>' + tint(8, 9, 9, "--c-magenta") + tint(19, 9, 12, "--c-blue") + tint(11, 14.5, 16, "--c-green") + tint(11, 20, 7, "--c-orange") + bar(20, 20, 12)),
    formula: pic('<text x="22" y="22.5" text-anchor="middle" font-family="KaTeX_Main, Georgia, serif" font-style="italic" font-size="18" fill="currentColor" opacity="0.82">√x</text>'),
    mermaid: pic('<rect x="5" y="6" width="13" height="8" rx="2.5" fill="none" stroke="var(--accent)" stroke-width="1.4"/><rect x="26" y="18" width="13" height="8" rx="2.5" fill="none" stroke="var(--accent)" stroke-width="1.4"/><path d="M18 10h6a4 4 0 0 1 4 4v3.5M25.5 15l2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),
    footnote: pic(bar(6, 9, 20) + '<text x="29" y="12" font-size="9" font-weight="700" fill="var(--accent)">1</text>' + bar(6, 15, 30, 0.16) + '<path d="M6 21.5h12" stroke="currentColor" stroke-opacity="0.3"/><text x="6" y="28.5" font-size="6.5" font-weight="700" fill="var(--accent)">1</text>' + bar(11, 25, 18, 0.16)),
    graphic: pic('<path d="m20 6 2.6 6.8 6.8 2.6-6.8 2.6L20 24.8 17.4 18l-6.8-2.6 6.8-2.6Z" fill="var(--accent)" opacity="0.85"/><path d="M32 19v6M29 22h6" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/>'),
    picture: pic('<rect x="5" y="5" width="34" height="22" rx="3.5" fill="var(--c-blue)" opacity="0.2"/><circle cx="14" cy="12" r="3" fill="var(--c-yellow)"/><path d="M5 24.5 15 17l6 4.5 7.5-7L39 23.5V24a3 3 0 0 1-3 3H8a3 3 0 0 1-3-2.5Z" fill="var(--c-green)" opacity="0.75"/>'),
    bullet: pic([8, 14.5, 21].map((y, i) => `<circle cx="8.5" cy="${y + 1.5}" r="1.7" fill="currentColor" opacity="0.55"/>` + bar(14, y, [22, 16, 20][i])).join("")),
    ordered: pic([8, 14.5, 21].map((y, i) => `<text x="6" y="${y + 4.2}" font-size="6.5" font-weight="700" fill="currentColor" opacity="0.6">${i + 1}</text>` + bar(14, y, [22, 16, 20][i])).join("")),
    task: pic('<rect x="6" y="6.5" width="6.5" height="6.5" rx="2" fill="var(--accent)"/><path d="m7.6 9.8 1.4 1.4 2.2-2.6" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>' + bar(16, 8.2, 20) +
      [15, 22].map((y, i) => `<rect x="6.4" y="${y - 0.3}" width="5.7" height="5.7" rx="1.8" fill="none" stroke="currentColor" stroke-opacity="0.45"/>` + bar(16, y + 1, [14, 18][i])).join("")),
    quote: pic('<rect x="7" y="7" width="2.6" height="18" rx="1.3" fill="currentColor" opacity="0.35"/>' + bar(14, 9, 22, 0.2) + bar(14, 14.5, 18, 0.2) + bar(14, 20, 20, 0.2)),
    block: pic('<rect x="4" y="6" width="36" height="20" rx="4" fill="currentColor" opacity="0.12"/>' + bar(9, 11.5, 24) + bar(9, 17.5, 16)),
    focus: pic('<rect x="7" y="7" width="2.6" height="18" rx="1.3" fill="var(--accent)"/>' + bar(14, 9, 22) + bar(14, 14.5, 18) + bar(14, 20, 20)),
    both: pic('<rect x="6" y="6" width="34" height="20" rx="4" fill="var(--accent)" opacity="0.14"/><rect x="6" y="6" width="2.8" height="20" rx="1.4" fill="var(--accent)"/>' + bar(13, 11.5, 22) + bar(13, 17.5, 15)),
    cols: (n) => pic(Array.from({ length: n }, (_x, i) => { const w = (34 - (n - 1) * 3) / n, x = 5 + i * (w + 3); return `<rect x="${x}" y="5" width="${w}" height="22" rx="2.5" fill="currentColor" opacity="0.1"/>` + bar(x + 2.5, 9, w - 5, 0.3) + bar(x + 2.5, 14, w - 7, 0.2) + bar(x + 2.5, 19, w - 5, 0.2); }).join("")),
    text: pic('<text x="8" y="23" font-family="Georgia, serif" font-size="19" font-weight="700" fill="currentColor" opacity="0.8">A</text>' + bar(24, 11, 13, 0.3) + bar(24, 17, 9, 0.3)),
    page: pic('<rect x="11" y="4" width="22" height="24" rx="3.5" fill="currentColor" opacity="0.1"/><rect x="11.5" y="4.5" width="21" height="23" rx="3" fill="none" stroke="currentColor" stroke-opacity="0.4"/>' + bar(15, 10, 14, 0.5) + bar(15, 15.5, 10) + bar(15, 21, 12)),
    board: pic('<rect x="5" y="5" width="34" height="22" rx="3.5" fill="currentColor" opacity="0.1"/><path d="M10 21c4-10 7 2 11-5s6-4 9-2" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/><circle cx="33" cy="11" r="2.5" fill="var(--c-yellow)"/>'),
    file: pic('<path d="M15 5h10l6 6v14a2.5 2.5 0 0 1-2.5 2.5h-13.5A2.5 2.5 0 0 1 12.5 25V7.5A2.5 2.5 0 0 1 15 5Z" fill="currentColor" opacity="0.1"/><path d="M25 5v6h6M15 5h10l6 6v14a2.5 2.5 0 0 1-2.5 2.5h-13.5A2.5 2.5 0 0 1 12.5 25V7.5A2.5 2.5 0 0 1 15 5Z" fill="none" stroke="currentColor" stroke-opacity="0.45"/><path d="M22 14v8M18.5 18.8 22 22l3.5-3.2" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'),
    rule: pic(bar(8, 8, 28, 0.16) + '<path d="M5 16h34" stroke="currentColor" stroke-opacity="0.6" stroke-width="1.4" stroke-linecap="round"/>' + bar(8, 21, 20, 0.16)),
    callout: (kind) => `<svg class="rp-pic callout-${kind}" viewBox="0 0 44 32" aria-hidden="true"><rect x="4" y="5" width="36" height="22" rx="4" fill="var(--cc)" opacity="0.16"/><rect x="4.5" y="5.5" width="35" height="21" rx="3.5" fill="none" stroke="var(--cc)" stroke-opacity="0.3"/><circle cx="11" cy="12" r="2.6" fill="var(--cc)"/><rect x="16" y="10.5" width="14" height="3" rx="1.5" fill="var(--cc)"/>${bar(8.5, 19, 24, 0.22)}</svg>`,
  };

  // ------------------------------------------------------------ what the Insert tab holds
  const para = () => N.paragraph.create();
  const list = (type, attrs, item) => () => type.create(attrs, N.list_item.create(item, para()));
  const quote = (attrs) => () => N.blockquote.create(attrs, para());
  // put: a node made new, set below the caret's block or at the place it is dropped, the caret in it
  const put = (make) => (v, at) => A.context.putBlock(v, make(), true, at);
  const mermaid = (v, at) => { const pos = A.context.putBlock(v, A.context.island("```mermaid\ngraph TD\n  A --> B\n```", "code"), false, at); setTimeout(() => A.islands.open(v, pos, true), 0); };
  // a line of its own at a place between blocks, the caret in it (in a column with nothing in it: its empty line is that line)
  const lineAt = (v, at) => {
    const $a = v.state.doc.resolve(at), tr = v.state.tr;
    if ($a.parent.type === N.column && A.columns.blank($a.parent)) at = $a.start(); else tr.insert(at, para());
    v.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)));
  };
  // a picture stands in a line of text: dropped between blocks, it gets a line of its own
  const picture = (v, at) => {
    if (at != null) lineAt(v, at);
    A.context.INSERT.image(v);
  };
  const CALLOUTS = ["note", "info", "tip", "success", "question", "warning", "error", "bug", "example", "important"];
  /* [section, [label key, n], more words it is found by, picture, run(view, at), drag (false: only by a click)] */
  const linePic = (d) => `<svg class="rp-pic rp-line" viewBox="0 0 88 24" aria-hidden="true">${d}</svg>`;
  const ITEMS = [
    ["panel.blocks", ["menu.text"], "text paragraph absatz", PIC.text, put(para)],
    ["panel.blocks", ["menu.page"], "page subpage seite unterseite", PIC.page, (v, at) => A.context.INSERT.page(v, at)],
    ["panel.blocks", ["menu.table"], "table tabelle", PIC.table, (v, at) => A.context.INSERT.table(v, at)],
    ["panel.blocks", ["menu.codeBlock"], "code", PIC.code, (v, at) => A.context.INSERT.code(v, at)],
    ["panel.blocks", ["menu.formula"], "formula math latex equation formel", PIC.formula, (v, at) => A.context.INSERT.math(v, at)],
    ["panel.blocks", ["panel.mermaid"], "mermaid diagram chart diagramm", PIC.mermaid, mermaid],
    ["panel.blocks", ["menu.footnote"], "footnote note fußnote", PIC.footnote, (v) => A.context.INSERT.footnote(v), false],
    ["panel.blocks", ["panel.graphic"], "graphic figure ai claude grafik zeichnung ki", PIC.graphic, (v) => A.context.INSERT.graphic(v), false],
    ["panel.lists", ["menu.bullet"], "list bullet aufzählung liste", PIC.bullet, put(list(N.bullet_list))],
    ["panel.lists", ["menu.ordered"], "list numbered ordered nummeriert", PIC.ordered, put(list(N.ordered_list))],
    ["panel.lists", ["menu.task"], "task todo checkbox aufgabe", PIC.task, put(list(N.bullet_list, { tasks: true }, { task: " " }))],
    ["slash.deco", ["menu.quote"], "quote blockquote zitat", PIC.quote, put(quote(null))],
    ["slash.deco", ["slash.block"], "block box kasten", PIC.block, put(quote({ deco: "block" }))],
    ["slash.deco", ["slash.focus"], "focus bar fokus balken", PIC.focus, put(quote({ deco: "focus" }))],
    ["slash.deco", ["panel.both"], "block focus fokus", PIC.both, put(quote({ deco: "block-focus" }))],
    ...CALLOUTS.map((c) => ["slash.callout", ["callout." + c], "callout box hinweis " + c, PIC.callout(CALLOUT.kind(c)), put(quote({ callout: c }))]),
    ...[2, 3].map((n) => ["slash.columns", ["columns.n", n], "column columns spalten " + n, PIC.cols(n), put(() => N.columns.create(null, Array.from({ length: n }, () => A.columns.empty())))]),
    ["panel.media", ["menu.image"], "image picture photo bild foto", PIC.picture, picture],
    ["panel.media", ["menu.board"], "whiteboard board canvas draw sketch zeichnen skizze tafel", PIC.board, (v, at) => A.context.INSERT.board(v, at)],
    ["panel.media", ["menu.file"], "file attachment datei anhang", PIC.file, (v, at) => { if (at != null) lineAt(v, at); A.context.INSERT.file(v); }],
    // a rule, in its four looks: tiles that show the line itself (viewer/markdown.js: ruleLook)
    ["panel.lines", ["panel.line.dots"], "divider rule line dots separator trennlinie punkte", linePic('<circle cx="34" cy="12" r="1.6" fill="currentColor" opacity="0.5"/><circle cx="44" cy="12" r="1.6" fill="currentColor" opacity="0.5"/><circle cx="54" cy="12" r="1.6" fill="currentColor" opacity="0.5"/>'), (v, at) => A.context.INSERT.rule(v, at, "***")],
    ["panel.lines", ["panel.line.dotted"], "divider rule line dotted separator trennlinie gepunktet", linePic('<path d="M12 12h64" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0.1 4.4"/>'), (v, at) => A.context.INSERT.rule(v, at, "- - -")],
    ["panel.lines", ["panel.line.thin"], "divider rule line thin separator trennlinie dünn", linePic('<path d="M12 12h64" stroke="currentColor" stroke-opacity="0.45" stroke-width="1"/>'), (v, at) => A.context.INSERT.rule(v, at)],
    ["panel.lines", ["panel.line.heavy"], "divider rule line heavy thick separator trennlinie dick", linePic('<path d="M12 12h64" stroke="currentColor" stroke-opacity="0.8" stroke-width="2.2" stroke-linecap="round"/>'), (v, at) => A.context.INSERT.rule(v, at, "___")],
  ];
  const TILED = new Set(["panel.lines"]); // (sections whose entries are tiles that show the thing itself, without a name)

  // ------------------------------------------------------------ the panel
  const TABS = ["insert", "format", "style", "info"], DOCS = ["style", "info"]; // (DOCS: what is the document's — these stand beside the reading view too)
  const tabOf = (t) => (t === "document" ? "style" : t); // ("document": the two were one tab once, and a setting may still say so)
  // Document: the numbers shown large, the ones in the list under them, and the grounds a note can stand on ("" the theme's own)
  const STATS = [["words", "panel.words"], ["chars", "panel.chars"], ["minutes", "panel.reading"], ["blocks", "panel.blocks"]];
  const FACTS = [["headings", "panel.headings"], ["pictures", "panel.pictures"], ["links", "panel.links"], ["tasks", "panel.tasks"], ["pages", "panel.pages"]];
  const GROUNDS = ["", ...core.doc.BACKGROUNDS];
  const groundName = (g) => T(!g ? "panel.bg.none" : /^(gray|dots|grid|lines)$/.test(g) ? "panel.bg." + g : "color." + g);
  const el = document.createElement("aside");
  el.id = "rpanel";
  el.setAttribute("aria-label", T("panel.label"));
  el.innerHTML =
    `<h2 class="rp-title"></h2>` +
    `<div class="rp-pane" data-pane="insert" role="tabpanel"><p class="rp-hint">${esc(T("panel.hint"))}</p>` +
    `<label class="rp-search">${ICON.search}<input type="search" placeholder="${esc(T("panel.search"))}" aria-label="${esc(T("panel.search"))}" spellcheck="false"></label>` +
    `<div class="rp-items"></div><p class="rp-none" hidden>${esc(T("menu.none"))}</p></div>` +
    `<div class="rp-pane" data-pane="format" role="tabpanel"></div>` +
    `<div class="rp-pane" data-pane="info" role="tabpanel">` +
    `<div class="rp-stats">${STATS.map(([k, name]) => `<div class="rp-stat"><b data-fact="${k}">–</b><span>${esc(T(name))}</span></div>`).join("")}</div>` +
    `<div class="rp-facts">${FACTS.map(([k, name]) => `<div><span>${esc(T(name))}</span><span class="rp-fact" data-fact="${k}">–</span></div>`).join("")}</div>` +
    `</div><div class="rp-pane" data-pane="style" role="tabpanel"><h3 class="rp-sec">${esc(T("panel.background"))}</h3><div class="rp-grounds" role="radiogroup" aria-label="${esc(T("panel.background"))}">` +
    GROUNDS.map((g) => `<button class="rp-ground" type="button" role="radio" aria-checked="false" data-bg="${g}" title="${esc(groundName(g))}" aria-label="${esc(groundName(g))}"><i data-doc-bg="${g || "none"}"></i></button>`).join("") +
    `</div><h3 class="rp-sec">${esc(T("panel.layout"))}</h3><label class="rp-line"><span>${esc(T("panel.width"))}</span><select class="rp-width" data-prop="width" aria-label="${esc(T("panel.width"))}">${["narrow", "normal", "wide", "full"].map((w) => `<option value="${w}">${esc(T("panel.width." + w))}</option>`).join("")}</select></label>` +
    `<p class="rp-hint rp-say">${esc(T("panel.docHint"))}</p></div>`;
  document.body.appendChild(el);
  /* The rail at the window's right edge: one sign for each of the panel's parts. A press opens the panel at that part,
   * a press on the part that is open closes it. */
  const RAIL = { insert: ICON.plus, format: `<span class="rr-aa" aria-hidden="true">Aa</span>`, info: ICON.info,
    style: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.6 3.4c.8.8.8 2 0 2.8l-7.4 7.4-2.8-2.8 7.4-7.4c.8-.8 2-.8 2.8 0z"/><path d="M8.3 12.9c-1.7 0-3 1.3-3 3 0 1.2-.7 2.3-1.8 2.9 3 .9 7.6.3 7.6-3.1 0-1.5-1.3-2.8-2.8-2.8z"/></svg>` };
  const rail = document.createElement("nav");
  rail.id = "rrail";
  rail.setAttribute("aria-label", T("panel.label"));
  rail.innerHTML = `<div class="rp-tabs" role="tablist" aria-orientation="vertical">` + TABS.map((t) => `<button class="rp-tab" type="button" role="tab" data-tab="${t}" aria-selected="false" title="${esc(T("panel." + t))}" aria-label="${esc(T("panel." + t))}">${RAIL[t]}</button>`).join("") + `</div>`;
  document.body.appendChild(rail);
  const search = el.querySelector(".rp-search input"), itemsEl = el.querySelector(".rp-items"), none = el.querySelector(".rp-none");
  const formatEl = el.querySelector('[data-pane="format"]'), docEl = el.querySelector('[data-pane="style"]'), infoEl = el.querySelector('[data-pane="info"]');
  const mode = () => document.body.dataset.view || "read";
  const can = () => !(window.MdHost && window.MdHost.reading); // (where a note is only shown — a shared link: no panel)
  const isOpen = () => document.body.hasAttribute("data-panel");

  // --- Insert: its tiles, section by section
  {
    let html = "", section = null;
    ITEMS.forEach(([sec, [key, n], , picture_, , drag], i) => {
      if (sec !== section) { html += (section ? `</div>` : "") + `<h3 class="rp-sec">${esc(T(sec))}</h3><div class="rp-grid${TILED.has(sec) ? " rp-tiled" : ""}">`; section = sec; }
      // a row: what it is in small, its name, and — where it can be pulled into the text — a grip that says so
      // (not a <button>: a browser pulls none of those — Firefox — and the pull begins at the row or its grip)
      html += `<div class="rp-tile" role="button" tabindex="0" data-i="${i}"${key === "panel.graphic" ? " data-needs-ai" : ""} title="${esc(T(key, n))}" aria-label="${esc(T(key, n))}"${drag === false ? "" : ' draggable="true"'}><span class="rp-card">${picture_}</span><span class="rp-name">${esc(T(key, n))}</span>${drag === false ? "" : '<span class="rp-grip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>'}</div>`;
    });
    // a table of a size chosen by pointing: a field of squares, as many rows and columns as are marked
    const ROWS = 6, COLS = 8;
    html += `</div><h3 class="rp-sec rp-table-sec">${esc(T("panel.tableOf"))}</h3><p class="rp-hint rp-table-say">${esc(T("panel.tableHint"))}</p><div class="rp-tablepick" role="grid" aria-label="${esc(T("panel.tableOf"))}" style="--cols:${COLS}">` +
      Array.from({ length: ROWS * COLS }, (_x, k) => `<button class="rp-cell" type="button" tabindex="-1" data-r="${Math.floor(k / COLS) + 1}" data-c="${(k % COLS) + 1}" aria-label="${Math.floor(k / COLS) + 1} × ${(k % COLS) + 1}"></button>`).join("") + `</div>`;
    itemsEl.innerHTML = html;
    const pick = itemsEl.querySelector(".rp-tablepick"), say = itemsEl.querySelector(".rp-table-say");
    const markTo = (r, c) => { for (const b of pick.children) b.classList.toggle("on", +b.dataset.r <= r && +b.dataset.c <= c); say.textContent = r ? T("panel.tableSize", r, c) : T("panel.tableHint"); };
    pick.addEventListener("mousemove", (e) => { const b = e.target.closest(".rp-cell"); if (b) markTo(+b.dataset.r, +b.dataset.c); });
    pick.addEventListener("mouseleave", () => markTo(0, 0));
    pick.addEventListener("click", (e) => { const b = e.target.closest(".rp-cell"), v = view(); if (b && v && v.editable) { A.context.INSERT.table(v, null, Math.max(2, +b.dataset.r), +b.dataset.c); markTo(0, 0); } });
  }
  function filter() {
    const q = search.value.trim().toLowerCase();
    let any = false;
    for (const grid of itemsEl.querySelectorAll(".rp-grid")) {
      let shown = 0;
      for (const tile of grid.children) {
        const [, [key, n], words] = ITEMS[+tile.dataset.i];
        const hit = !q || (T(key, n).toLowerCase() + " " + words).split(/\s+/).some((w) => w.startsWith(q));
        tile.hidden = !hit;
        if (hit) shown++;
      }
      grid.hidden = grid.previousElementSibling.hidden = !shown;
      any = any || !!shown;
    }
    // (the field of squares is found as "table")
    const tableHit = !q || ["table", "tabelle", "grid", "raster"].some((w) => w.startsWith(q));
    for (const x of itemsEl.querySelectorAll(".rp-table-sec, .rp-table-say, .rp-tablepick")) x.hidden = !tableHit;
    any = any || tableHit;
    none.hidden = any;
  }
  search.addEventListener("input", filter);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (search.value) { search.value = ""; filter(); } else if (view()) view().focus(); }
    else if (e.key === "Enter") { e.preventDefault(); const first = itemsEl.querySelector(".rp-tile:not([hidden])"); if (first) first.click(); }
  });
  const runItem = (i, at = null) => { const v = view(); if (v && v.editable) ITEMS[i][4](v, at); };
  itemsEl.addEventListener("click", (e) => { const tile = e.target.closest(".rp-tile"); if (tile) runItem(+tile.dataset.i); });
  itemsEl.addEventListener("keydown", (e) => { const tile = e.target.closest(".rp-tile"); if (tile && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); runItem(+tile.dataset.i); } });
  itemsEl.addEventListener("mousedown", (e) => { if (e.target.closest(".rp-cell")) e.preventDefault(); }); // (the caret stays where it is: the table goes there)

  /* Dragging a tile into the text: a line shows the gap it will go to — before or after the block
   * of the document at the pointer's height — and letting go puts it there. */
  let drag = null; // { i, at }
  const line = document.createElement("div");
  line.className = "blk-line";
  document.body.appendChild(line);
  /* (Over a row of columns: the column at the pointer, and in it the block nearest to the pointer's
   * height — the line is as wide as the column, and the column is marked, as when a block is moved
   * there (blocks.js). Above and below the row, and for columns themselves: the row.) */
  function gapAt(v, x, y, flat) {
    const nearest = (els, dist) => {
      let best = null, d = Infinity;
      for (const c of els) {
        const desc = c.pmViewDesc;
        if (!desc || !desc.node || desc.dom !== c || c.classList.contains("hid")) continue;
        const r = c.getBoundingClientRect(), n = dist(r);
        if (r.height && n < d) { d = n; best = { el: c, r, pos: desc.posBefore, size: desc.node.nodeSize }; }
      }
      return best;
    };
    const byY = (r) => (y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0);
    let best = nearest(v.dom.children, byY), col = null;
    if (!best) return null;
    if (!flat && best.el.classList.contains("cols") && y >= best.r.top && y <= best.r.bottom) {
      col = nearest(best.el.children, (r) => (x < r.left ? r.left - x : x > r.right ? x - r.right : 0));
      best = (col && nearest(col.el.children, byY)) || best;
      if (best.el.parentElement !== (col && col.el)) col = null;
    }
    const after = y > best.r.top + best.r.height / 2, box = col ? col.r : best.r;
    return { at: best.pos + (after ? best.size : 0), x: box.left, w: box.width, y: after ? best.r.bottom + 4 : best.r.top - 4, col: col ? col.el : null };
  }
  let colEl = null; // the column it would go into
  const showLine = (g) => {
    if (colEl && (!g || g.col !== colEl)) { colEl.classList.remove("drop-col"); colEl = null; }
    if (g && g.col && g.col !== colEl) { colEl = g.col; colEl.classList.add("drop-col"); }
    if (!g) { delete line.dataset.on; return; }
    line.style.left = g.x + scrollX + "px";
    line.style.width = g.w + "px";
    line.style.top = g.y - 1 + scrollY + "px";
    line.dataset.on = "";
  };
  itemsEl.addEventListener("dragstart", (e) => {
    const tile = e.target.closest?.(".rp-tile"), v = view();
    if (!tile || !v || !v.editable) { e.preventDefault(); return; }
    drag = { i: +tile.dataset.i, at: null, flat: ITEMS[+tile.dataset.i][0] === "slash.columns" }; // (columns are not put into a column)
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", tile.textContent);
    // (the row itself goes along, held where it was taken)
    window.MdView.core.moving.picture(e, tile);
  });
  // (before anything else sees them: the editor's own drop handling stays out of it)
  document.addEventListener("dragover", (e) => {
    const v = view();
    if (!drag || !v) return;
    e.stopPropagation();
    const over = !el.contains(e.target) && A.view.el && A.view.el.contains(e.target);
    const g = over ? gapAt(v, e.clientX, e.clientY, drag.flat) : null;
    drag.at = g ? g.at : null;
    showLine(g);
    if (g) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  }, true);
  document.addEventListener("drop", (e) => {
    if (!drag) return;
    e.stopPropagation();
    e.preventDefault();
    const d = drag;
    drag = null;
    showLine(null);
    if (d.at != null) runItem(d.i, d.at);
  }, true);
  document.addEventListener("dragend", () => { drag = null; showLine(null); }, true);

  // --- Format: the "/" menu's entries for the block the caret is in, laid out
  const leafKey = (e) => (e.key || e.label) + (e.n || ""); // (a table's rows and columns are known by their names)
  const btn = (g, e, inner, cls = "") =>
    `<button class="rp-btn ${cls}" type="button" data-g="${esc(g)}" data-k="${esc(leafKey(e))}" title="${esc(e.label || T(e.key, e.n))}" aria-label="${esc(e.label || T(e.key, e.n))}">${inner}</button>`;
  const named = (g, e, cls = "") => btn(g, e, `<span>${esc(e.label || T(e.key, e.n))}</span>`, "rp-text " + cls);
  const signed = (g, e) => btn(g, e, e.icon || "", "rp-sign");
  const sec = (key) => `<h3 class="rp-sec">${esc(T(key))}</h3>`;
  const leaves = (e) => (e && e.items ? e.items.filter(Boolean) : []);
  function formatHTML(entries) {
    const by = (key) => entries.find((e) => e && e.key === key);
    const style = by("slash.style"), lists = by("slash.list"), format = by("menu.format"), deco = by("slash.deco"), color = by("slash.color"), callout = by("slash.callout");
    let html = "";
    // Text: what the block is — the four headings by what they are for, and plain text — each written as it looks
    if (style) {
      const s = leaves(style), NAMES = { 1: "panel.title", 2: "panel.subtitle", 3: "panel.heading", 4: "panel.strong" };
      const order = [...s.filter((e) => e.n), ...s.filter((e) => !e.n)];
      html += sec("panel.text") + `<div class="rp-row rp-3 rp-styles">${order.map((e) => btn("slash.style", e, `<span>${esc(T(e.n ? NAMES[e.n] || "menu.heading" : "panel.body", e.n))}</span>`, "rp-text " + (e.n ? "rp-h" + e.n : "rp-body"))).join("")}</div>`;
    }
    // Groups: a page of the note's own, made at the caret
    const page = by("menu.page");
    if (page) html += sec("panel.groups") + `<div class="rp-row rp-2">${btn("", page, `${PIC.page}<span>${esc(T("menu.page"))}</span>`, "rp-text rp-group")}</div>`;
    // the marks in one row; the lists in another, the indent beside them
    if (format) html += `<div class="rp-gap"></div><div class="rp-seg">${leaves(format).map((e) => signed("menu.format", e)).join("")}</div>`;
    if (lists) html += `<div class="rp-segs"><div class="rp-seg">${leaves(lists).map((e) => signed("slash.list", e)).join("")}</div><div class="rp-seg">` +
      `<button class="rp-btn rp-sign" type="button" data-do="outdent" title="${esc(T("panel.outdent"))}" aria-label="${esc(T("panel.outdent"))}">${ICON_OUT}</button>` +
      `<button class="rp-btn rp-sign" type="button" data-do="indent" title="${esc(T("panel.indent"))}" aria-label="${esc(T("panel.indent"))}">${ICON_IN}</button></div></div>`;
    // where the text stands in its line
    const align = by("slash.align");
    if (align) html += `<div class="rp-segs"><div class="rp-seg">${leaves(align).map((e) => signed("slash.align", e)).join("")}</div></div>`;
    if (deco) html += sec("slash.deco") + `<div class="rp-row rp-${Math.min(3, leaves(deco).length)} rp-decos">${leaves(deco).map((e) => named("slash.deco", e)).join("")}</div>`;
    if (color) html += sec("slash.color") + `<div class="rp-colors">${leaves(color).map((e) => btn("slash.color", e, `<i style="--sw: ${/^color\./.test(e.key) ? `var(--c-${e.key.slice(6)})` : "transparent"}"></i>`, "rp-swatch")).join("")}</div>`;
    if (callout) {
      const kinds = leaves(callout).filter((e) => /^callout\.(?!title$)/.test(e.key)), title = leaves(callout).find((e) => e.key === "callout.title");
      html += sec("slash.callout") + `<div class="rp-kinds">${kinds.map((e) => btn("slash.callout", e, e.icon, "rp-kind callout-" + CALLOUT.kind(e.key.slice(8)))).join("")}</div>` +
        (title ? `<div class="rp-row">${named("slash.callout", title)}</div>` : "");
    }
    const columns = by("slash.columns");
    if (columns) html += sec("slash.columns") + `<div class="rp-list">${leaves(columns).map((e) => named("slash.columns", e, e.danger ? "rp-danger" : "")).join("")}</div>`;
    const wide = by("table.wide"), row = by("table.row"), col = by("table.column");
    if (wide) {
      html += sec("menu.table") + `<div class="rp-row">${named("", wide)}</div>`;
      for (const g of [row, col]) if (g) html += sec(g.key) + `<div class="rp-list">${leaves(g).map((e) => named(g.key, e, e.danger ? "rp-danger" : "")).join("")}</div>`;
    }
    return html;
  }
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON_OUT = svg('<path d="M11 6h10M11 12h10M11 18h10M7 9l-3.5 3L7 15"/>'), ICON_IN = svg('<path d="M11 6h10M11 12h10M11 18h10M3.5 9 7 12l-3.5 3"/>');
  const find = (entries, g, k) => {
    for (const e of entries) {
      if (!e) continue;
      if (!g && leafKey(e) === k) return e;
      if (e.key === g) return leaves(e).find((x) => leafKey(x) === k) || null;
    }
    return null;
  };
  let shape = null; // which controls stand there (they stay while only what is on changes)
  function refresh() {
    const v = view();
    if (!isOpen() || pref().panelTab !== "format" || !v) return;
    const entries = A.slash.entries(v);
    // (a mark at the caret has no tick in the "/" menu: here it shows)
    const marks = { "menu.bold": "strong", "menu.italic": "em", "menu.strike": "s", "menu.code": "code" };
    const now = entries.map((e) => (!e ? "-" : e.key + (e.items ? "(" + leaves(e).map(leafKey).join() + ")" : ""))).join(" ");
    if (now !== shape) { shape = now; formatEl.innerHTML = formatHTML(entries); }
    for (const b of formatEl.querySelectorAll(".rp-btn[data-k]")) {
      const e = find(entries, b.dataset.g, b.dataset.k);
      const on = !!e && (e.checked || (marks[b.dataset.k] ? A.context.markActive(v.state, A.schema.marks[marks[b.dataset.k]]) : false) || (b.dataset.k === "table.wide" && !!(A.tableui.cellAt(v.state.selection.$from) || { table: { attrs: {} } }).table.attrs.wide));
      b.setAttribute("aria-pressed", String(on));
      b.disabled = !e || !!e.disabled || !v.editable;
    }
    const inList = !!A.edit.itemAt(v.state.selection.$from);
    for (const b of formatEl.querySelectorAll("[data-do]")) b.disabled = !inList || !v.editable;
  }
  let queued = false;
  const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; refresh(); }); };
  formatEl.addEventListener("click", (e) => {
    const b = e.target.closest(".rp-btn"), v = view();
    if (!b || !v || !v.editable || b.disabled) return;
    if (b.dataset.do) A.context.run(v, A.edit.keys[b.dataset.do === "indent" ? "Mod-]" : "Mod-["]);
    else { const entry = find(A.slash.entries(v), b.dataset.g, b.dataset.k); if (entry && !entry.disabled) entry.act(v); }
    v.focus();
    refresh();
  });
  // the text keeps the focus (and its selection) whatever is clicked here — but the search field is typed in
  // (… and a row that can be pulled into the text: held back, its press would never become a pull — none ever did)
  el.addEventListener("mousedown", (e) => { if (!e.target.closest('.rp-search, .rp-tile[draggable="true"]')) e.preventDefault(); });

  // --- Document: what the note holds, and how it says it wants to be shown
  const widthBox = docEl.querySelector(".rp-width"), widthWrap = window.MdView.core.popup ? window.MdView.core.popup(widthBox) : null; // (a button with the app's own menu)
  const say = (k, text) => {
    const at = infoEl.querySelector(`[data-fact="${k}"]`);
    if (at.textContent === text) return;
    const fresh = at.textContent !== "–"; // (what was not there yet stands at once; a number that changed fades in)
    at.textContent = "";
    at.appendChild(Object.assign(document.createElement("span"), { className: fresh ? "rp-fresh" : "", textContent: text }));
  };
  let counted = null, counting = 0; // the text the numbers are of
  function count() {
    counting = 0;
    const p = core.current, text = p && !p.error && p.kind !== "pdf" && typeof p.text === "string" ? p.text : null;
    if (text === counted) return;
    counted = text;
    const f = text == null ? null : core.doc.facts(text), n = (x) => x.toLocaleString();
    for (const [k] of [...STATS, ...FACTS]) say(k, !f ? "–" : k === "minutes" ? T("panel.minutes", n(f.minutes)) : k === "tasks" ? T("panel.tasksOf", n(f.done), n(f.tasks)) : n(f[k]));
    infoEl.querySelector('[data-fact="tasks"]').parentNode.hidden = !f || !f.tasks;
    infoEl.querySelector('[data-fact="pages"]').parentNode.hidden = !f || !f.pages;
  }
  /* The note changed, or another is shown (viewer.js: docSync, after a note is drawn and after every
   * save): what is chosen shows at once; the numbers are counted in a quiet moment — at once only
   * where none stand yet, and for another note. */
  let countedFor = null;
  function doc() {
    if (!isOpen() || !DOCS.includes(el.dataset.tab)) return;
    const p = core.current, look = core.doc.look();
    const can = !!p && !p.error && p.kind !== "pdf" && !p.readonly;
    for (const b of docEl.querySelectorAll(".rp-ground")) { b.setAttribute("aria-checked", String(b.dataset.bg === look.background)); b.disabled = !can; }
    widthBox.value = look.width || "normal";
    widthBox.disabled = !can;
    if (widthWrap && widthWrap.sync) widthWrap.sync();
    clearTimeout(counting);
    if (countedFor !== (p && p.path) || counted == null) { countedFor = p && p.path; count(); }
    else counting = setTimeout(count, 150);
  }
  // (what was chosen shows by what the note says afterwards — where nothing could be written, as it was)
  docEl.addEventListener("click", (e) => { const b = e.target.closest(".rp-ground"); if (b && !b.disabled) { core.doc.set("background", b.dataset.bg || null); doc(); } });
  // how wide the text column is: a share of the window, said by the note (normal: nothing said; an old "wide: true" goes)
  widthBox.addEventListener("change", () => { core.doc.set("width", widthBox.value === "normal" ? null : widthBox.value); if (/^---[ \t]*\n(?:[^\n]*\n)*?wide:/.test(String((core.current || {}).text || ""))) core.doc.set("wide", null); doc(); });
  docEl.addEventListener("keydown", (e) => e.stopPropagation()); // (Space on a ground or the switch is not the note's)

  // --- tabs, opening and closing
  /* Where it stands: beside the text that is edited in the active mode — and in the other modes (reading, the source alone
   * or beside its reading) for what is the document's (Henri, 2026-10-20: the document's style in every mode). Not where a
   * note is only shown. (reading: a mode with no Insert and Format — the source's view is "edit" in both its modes) */
  const reading = () => mode() !== "active";
  const wanted = () => !!pref().panel && can() && (mode() === "active" || DOCS.includes(tabOf(pref().panelTab)));
  const keep = (prefs) => { window.MdPrefs = { ...(window.MdPrefs || {}), ...prefs }; post("prefs", { prefs }); };
  function setTab(tab, save = true) {
    tab = tabOf(tab);
    if (!TABS.includes(tab) || (reading() && !DOCS.includes(tab))) tab = reading() ? "style" : "insert";
    el.dataset.tab = tab;
    el.querySelector(".rp-title").textContent = T("panel." + tab);
    marks();
    if (save && pref().panelTab !== tab) keep({ panelTab: tab });
    shape = tab === "format" ? shape : null;
    refresh();
    doc();
  }
  /* The rail's signs: the one whose part is open is marked; beside the reading view only the document's can be pressed. The
   * rail is the active mode's: not beside the reading view (Henri, 2026-10-14 — there the panel comes only with Ctrl+Alt+P),
   * and so not beside the source either (the same: Ctrl+Alt+P), not where a note is only shown. It comes in and goes out with the view (active/panel.css). */
  function marks() {
    for (const b of rail.querySelectorAll(".rp-tab")) { b.setAttribute("aria-selected", String(isOpen() && b.dataset.tab === el.dataset.tab)); b.disabled = reading() && !DOCS.includes(b.dataset.tab); }
    const cur = window.MdView.core.current; // (no note in the window — an empty tab, a PDF: no rail)
    document.body.toggleAttribute("data-rail", can() && mode() === "active" && !!cur && cur.kind !== "pdf");
  }
  rail.addEventListener("click", (e) => {
    const b = e.target.closest(".rp-tab");
    if (!b || b.disabled) return;
    if (isOpen() && el.dataset.tab === b.dataset.tab) return show(false);
    keep({ panelTab: b.dataset.tab });
    if (isOpen()) setTab(b.dataset.tab); else show(true);
  });
  /* It comes and goes over the window: nothing makes room for it, so nothing else moves. */
  let laid = null; // (what was last laid: the first time it is laid in any case)
  function lay(open, animate) {
    if (open) setTab(pref().panelTab, false);
    if (isOpen() === !!open && laid === !!open) return marks();
    el.classList.toggle("no-anim", !animate);
    if (open) document.body.dataset.panel = ""; else delete document.body.dataset.panel;
    laid = !!open;
    marks();
  }
  function show(open, animate = true, save = true) {
    // (opened beside the reading view, it is opened for what stands there: the document)
    if (save && (pref().panel !== !!open || (open && reading() && !DOCS.includes(tabOf(pref().panelTab))))) keep({ panel: !!open, ...(open && reading() && !DOCS.includes(tabOf(pref().panelTab)) ? { panelTab: "style" } : {}) });
    lay(save ? wanted() : !!open, animate);
  }
  const toggle = () => show(!wanted());
  /* A press outside it closes it (Henri, 2026-10-25): on the note, the toolbar, the sidebar, the tabs. Not one on it, on its rail,
   * or on what it opened over the note (a menu, a dialog). The press goes on to do what it does there: the caret goes where the
   * note was pressed. */
  const OWN = '#rpanel, #rrail, [data-act="panel"], .actmenu, #dlg, #dlg-scrim, #settings, #settings-scrim';
  addEventListener("pointerdown", (e) => {
    if (isOpen() && e.target instanceof Element && !e.target.closest(OWN)) show(false);
  }, true);

  const plugin = new Plugin({
    key: new PluginKey("panel"),
    view: () => ({ update: later }),
  });
  // as the settings have it, and the mode (a window that opens, a mode that comes or goes)
  const sync = () => lay(wanted(), false);

  A.panel = { plugin, show, toggle, sync, setTab, refresh, doc, el, rail, get isOpen() { return isOpen(); }, items: ITEMS, run: runItem, gapAt, showLine }; // (gapAt, showLine: a finger's drag of a tile on the iPad, viewer/tablet.js)
})();
