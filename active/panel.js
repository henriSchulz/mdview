/* mdview active mode — the panel at the window's right (the toolbar's last
 * button, Ctrl+Alt+P), as Craft has one: two tabs.
 *
 *   Insert   what can be put into the document, as tiles with a small picture
 *            of each, in sections, with a field to search them. A click puts
 *            the thing below the block the caret is in; dragged, it goes
 *            between the blocks where it is dropped (a line shows where).
 *   Format   what the block the caret is in can be: a text style, a list, a
 *            decoration, a colour, a callout — and bold, italic and the like.
 *            It shows what is on, and follows the caret.
 *
 * It can only be opened in the active mode (the button is dimmed in the others).
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
  const { ICON, esc, callout: CALLOUT } = window.MdView.core;
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
  // a picture stands in a line of text: dropped between blocks, it gets a line of its own
  const picture = (v, at) => {
    if (at != null) { const tr = v.state.tr.insert(at, para()); v.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1))); }
    A.context.INSERT.image(v);
  };
  const CALLOUTS = ["note", "info", "tip", "success", "question", "warning", "error", "bug", "example", "important"];
  /* [section, [label key, n], more words it is found by, picture, run(view, at), drag (false: only by a click)] */
  const ITEMS = [
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
    ["panel.separators", ["menu.rule"], "divider rule line separator trennlinie", PIC.rule, (v, at) => A.context.INSERT.rule(v, at)],
    ["panel.media", ["menu.image"], "image picture photo bild foto", PIC.picture, picture],
  ];

  // ------------------------------------------------------------ the panel
  const el = document.createElement("aside");
  el.id = "rpanel";
  el.setAttribute("aria-label", T("panel.label"));
  el.innerHTML =
    `<div class="rp-tabs" role="tablist">` +
    ["insert", "format"].map((t) => `<button class="rp-tab" type="button" role="tab" data-tab="${t}" aria-selected="false">${esc(T("panel." + t))}</button>`).join("") +
    `</div>` +
    `<div class="rp-pane" data-pane="insert" role="tabpanel"><p class="rp-hint">${esc(T("panel.hint"))}</p>` +
    `<label class="rp-search">${ICON.search}<input type="search" placeholder="${esc(T("panel.search"))}" aria-label="${esc(T("panel.search"))}" spellcheck="false"></label>` +
    `<div class="rp-items"></div><p class="rp-none" hidden>${esc(T("menu.none"))}</p></div>` +
    `<div class="rp-pane" data-pane="format" role="tabpanel"></div>`;
  document.body.appendChild(el);
  const search = el.querySelector(".rp-search input"), itemsEl = el.querySelector(".rp-items"), none = el.querySelector(".rp-none");
  const formatEl = el.querySelector('[data-pane="format"]');
  const button = () => document.querySelector('#toolbar [data-act="panel"]');
  const isOpen = () => document.body.hasAttribute("data-panel");

  // --- Insert: its tiles, section by section
  {
    let html = "", section = null;
    ITEMS.forEach(([sec, [key, n], , picture_, , drag], i) => {
      if (sec !== section) { html += (section ? `</div>` : "") + `<h3 class="rp-sec">${esc(T(sec))}</h3><div class="rp-grid">`; section = sec; }
      html += `<button class="rp-tile" type="button" data-i="${i}"${drag === false ? "" : ' draggable="true"'}><span class="rp-card">${picture_}</span><span class="rp-name">${esc(T(key, n))}</span></button>`;
    });
    itemsEl.innerHTML = html + `</div>`;
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
    none.hidden = any;
  }
  search.addEventListener("input", filter);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (search.value) { search.value = ""; filter(); } else if (view()) view().focus(); }
    else if (e.key === "Enter") { e.preventDefault(); const first = itemsEl.querySelector(".rp-tile:not([hidden])"); if (first) first.click(); }
  });
  const runItem = (i, at = null) => { const v = view(); if (v && v.editable) ITEMS[i][4](v, at); };
  itemsEl.addEventListener("click", (e) => { const tile = e.target.closest(".rp-tile"); if (tile) runItem(+tile.dataset.i); });

  /* Dragging a tile into the text: a line shows the gap it will go to — before or after the block
   * of the document at the pointer's height — and letting go puts it there. */
  let drag = null; // { i, at }
  const line = document.createElement("div");
  line.className = "blk-line";
  document.body.appendChild(line);
  function gapAt(v, y) {
    let best = null, d = Infinity;
    for (const c of v.dom.children) {
      const desc = c.pmViewDesc;
      if (!desc || !desc.node || desc.dom !== c || c.classList.contains("hid")) continue;
      const r = c.getBoundingClientRect(), dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (r.height && dist < d) { d = dist; best = { r, pos: desc.posBefore, size: desc.node.nodeSize }; }
    }
    if (!best) return null;
    const after = y > best.r.top + best.r.height / 2;
    return { at: best.pos + (after ? best.size : 0), x: best.r.left, w: best.r.width, y: after ? best.r.bottom + 4 : best.r.top - 4 };
  }
  const showLine = (g) => {
    if (!g) { delete line.dataset.on; return; }
    line.style.left = g.x + scrollX + "px";
    line.style.width = g.w + "px";
    line.style.top = g.y - 1 + scrollY + "px";
    line.dataset.on = "";
  };
  itemsEl.addEventListener("dragstart", (e) => {
    const tile = e.target.closest?.(".rp-tile"), v = view();
    if (!tile || !v || !v.editable) { e.preventDefault(); return; }
    drag = { i: +tile.dataset.i, at: null };
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", tile.textContent);
    const card = tile.querySelector(".rp-card"), r = card.getBoundingClientRect();
    e.dataTransfer.setDragImage(card, r.width / 2, r.height / 2);
  });
  // (before anything else sees them: the editor's own drop handling stays out of it)
  document.addEventListener("dragover", (e) => {
    const v = view();
    if (!drag || !v) return;
    e.stopPropagation();
    const over = !el.contains(e.target) && A.view.el && A.view.el.contains(e.target);
    const g = over ? gapAt(v, e.clientY) : null;
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
    if (style) {
      const s = leaves(style), head = s.filter((e) => e.n && e.n <= 3), rest = s.filter((e) => !(e.n && e.n <= 3));
      html += sec("panel.titles") + `<div class="rp-row rp-3">${head.map((e) => named("slash.style", e, "rp-h" + e.n)).join("")}</div>` +
        sec("panel.content") + `<div class="rp-row rp-3">${rest.map((e) => named("slash.style", e, e.n ? "rp-h" + e.n : "")).join("")}</div>`;
    }
    html += `<div class="rp-gap"></div>`;
    if (format) html += `<div class="rp-seg">${leaves(format).map((e) => signed("menu.format", e)).join("")}</div>`;
    if (lists) html += `<div class="rp-seg">${leaves(lists).map((e) => signed("slash.list", e)).join("")}` +
      `<button class="rp-btn rp-sign" type="button" data-do="outdent" title="${esc(T("panel.outdent"))}" aria-label="${esc(T("panel.outdent"))}">${ICON_OUT}</button>` +
      `<button class="rp-btn rp-sign" type="button" data-do="indent" title="${esc(T("panel.indent"))}" aria-label="${esc(T("panel.indent"))}">${ICON_IN}</button></div>`;
    if (deco) html += sec("slash.deco") + `<div class="rp-row rp-3">${leaves(deco).map((e) => named("slash.deco", e)).join("")}</div>`;
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
  el.addEventListener("mousedown", (e) => { if (!e.target.closest(".rp-search")) e.preventDefault(); });

  // --- tabs, opening and closing
  function setTab(tab, save = true) {
    for (const b of el.querySelectorAll(".rp-tab")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    el.dataset.tab = tab;
    if (save && pref().panelTab !== tab) { window.MdPrefs = { ...(window.MdPrefs || {}), panelTab: tab }; post("prefs", { prefs: { panelTab: tab } }); }
    shape = tab === "format" ? shape : null;
    refresh();
  }
  el.querySelector(".rp-tabs").addEventListener("click", (e) => { const b = e.target.closest(".rp-tab"); if (b) setTab(b.dataset.tab); });
  /* The text column makes room at once and glides to its new place (transform only), as it does
   * for the sidebar on the left. */
  function show(open, animate = true, save = true) {
    if (isOpen() === !!open) return;
    const col = A.view && A.view.el, before = col ? col.getBoundingClientRect().left : 0;
    el.classList.toggle("no-anim", !animate);
    if (open) document.body.dataset.panel = ""; else delete document.body.dataset.panel;
    button()?.setAttribute("aria-pressed", String(!!open));
    if (save && pref().panel !== !!open) { window.MdPrefs = { ...(window.MdPrefs || {}), panel: !!open }; post("prefs", { prefs: { panel: !!open } }); }
    if (open) setTab(pref().panelTab === "format" ? "format" : "insert", false);
    const dx = col ? before - col.getBoundingClientRect().left : 0;
    if (!animate || !dx || !col || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    col.style.transition = "none";
    col.style.transform = `translateX(${dx}px)`;
    void col.offsetWidth;
    col.style.transition = "";
    col.style.transform = "";
  }
  const toggle = () => show(!isOpen());

  const plugin = new Plugin({
    key: new PluginKey("panel"),
    view: () => ({ update: later }),
  });
  // as the settings have it (a window that opens, a mode that comes back)
  const sync = () => show(!!pref().panel, false, false);

  A.panel = { plugin, show, toggle, sync, setTab, refresh, el, get isOpen() { return isOpen(); }, items: ITEMS, run: runItem };
})();
