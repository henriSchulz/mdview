/* mdview active mode — its settings: a window of their own in the app's look, kept by
 * the application (state.json, "active") and handed to every window
 * (window.MdPrefs, MdView.setPrefs). */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const DEFAULTS = {
    lang: "en", startMode: "last", bar: true, slash: true, syntax: false, quotes: false, wrap: 0,
    images: "beside", style: "auto", bullet: "-", emphasis: "*", strongMark: "**", ordered: ".",
    dialogWidth: 0, dialogHeight: 0,
    latexSnippets: true, latexFraction: true, latexMatrix: true, latexTabout: true, latexEnlarge: true, latexBrackets: true, latexText: true,
    sidebarPdf: true, sidebarImages: false, sidebarMedia: false, sidebarOther: false, sidebarSort: "opened",
    aiComplete: false, aiModel: "",
    panel: false, panelTab: "insert",
    ovScope: "all", ovLayout: "tiles", pdfFormat: "callout", pdfAuto: false, measure: "normal", hinting: false, docZoom: 100,
  };
  const post = (type, data = {}) => window.MdHost?.post(JSON.stringify({ type, ...data }));
  const now = () => ({ ...DEFAULTS, ...(window.MdPrefs || {}) });

  /* The settings window: the groups at the left, the chosen group's settings at the right, in
   * cards of rows. A change takes effect at once (no Apply): it is kept here (window.MdPrefs),
   * sent to the application, and what depends on it follows. What the application alone knows —
   * whether a key for the model is stored, the text size, the version — it tells when asked
   * ("settings-info" → A.prefs.info). */
  const UI = window.MdView.core.UI;
  // pages: [id, sign, sections]; a section: [title | null, rows]; a row: [key, kind, choices, shown when style is]
  const PAGES = [
    ["general", "gear", [
      [null, [
        ["lang", "select", [["en", "English"], ["de", "Deutsch"]]],
        ["startMode", "select", [["last", "prefs.start.last"], ["read", "mode.read"], ["active", "mode.active"], ["edit", "mode.edit"]]],
      ]],
    ]],
    ["appearance", "title", [
      [null, [
        ["docZoom", "select", [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250].map((z) => [z, z + " %"])],
        ["measure", "select", [["narrow", "prefs.measure.narrow"], ["normal", "prefs.measure.normal"], ["wide", "prefs.measure.wide"], ["full", "prefs.measure.full"]]],
        ["hinting", "switch"],
      ]],
    ]],
    ["sidebarPage", "sidebar", [
      [null, [
        ["sidebarSort", "select", [["opened", "prefs.sort.opened"], ["name", "prefs.sort.name"], ["modified", "prefs.sort.modified"]]],
      ]],
      ["prefs.sidebar", [["sidebarPdf", "switch"], ["sidebarImages", "switch"], ["sidebarMedia", "switch"], ["sidebarOther", "switch"]]],
    ]],
    ["allNotes", "apps", [
      [null, [
        ["ovScope", "select", [["all", "prefs.ovScope.all"], ["folders", "prefs.ovScope.folders"]]],
        ["ovLayout", "select", [["tiles", "prefs.ovLayout.tiles"], ["list", "prefs.ovLayout.list"]]],
      ]],
    ]],
    ["editing", "pencil", [
      [null, [["bar", "switch"], ["slash", "switch"], ["syntax", "switch"], ["quotes", "switch"]]],
      ["prefs.paragraphs", [["wrap", "select", [[0, "prefs.wrap.off"], [72, "72"], [80, "80"], [100, "100"], [120, "120"]]]]],
      ["prefs.pictures", [["images", "select", [["beside", "prefs.images.beside"], ["assets", "prefs.images.assets"]]]]],
    ]],
    ["newMarkdown", "source", [
      [null, [
        ["style", "select", [["auto", "prefs.style.auto"], ["fixed", "prefs.style.fixed"]]],
        ["bullet", "select", [["-", "- item"], ["*", "* item"], ["+", "+ item"]], "fixed"],
        ["ordered", "select", [[".", "1. item"], [")", "1) item"]], "fixed"],
        ["emphasis", "select", [["*", "*italic*"], ["_", "_italic_"]], "fixed"],
        ["strongMark", "select", [["**", "**bold**"], ["__", "__bold__"]], "fixed"],
      ]],
    ]],
    ["latex", "sigma", [
      [null, [["latexSnippets", "switch"], ["latexFraction", "switch"], ["latexMatrix", "switch"], ["latexTabout", "switch"], ["latexEnlarge", "switch"], ["latexBrackets", "switch"], ["latexText", "switch"]]],
    ]],
    ["pdf", "pdf", [
      [null, [
        ["pdfFormat", "select", [["callout", "prefs.pdfFormat.callout"], ["quote", "prefs.pdfFormat.quote"], ["link", "prefs.pdfFormat.link"], ["embed", "prefs.pdfFormat.embed"]]],
        ["pdfAuto", "switch"],
      ]],
    ]],
    ["ai", "spark", [
      [null, [["aiComplete", "switch"]]],
      ["prefs.aiKeySection", [["aiKey", "key"], ["aiModel", "text"]]],
    ]],
    ["about", "info", [
      [null, [["version", "about"], ["guide", "action"], ["configDir", "about"]]],
    ]],
  ];
  const GROUPS = [[null, ["general", "appearance"]], ["prefs.group.notes", ["sidebarPage", "allNotes"]], ["prefs.group.writing", ["editing", "newMarkdown", "latex", "pdf", "ai"]], [null, ["about"]]];
  const label = (k) => (/^[a-z]+\.[a-zA-Z.]+$/.test(k) ? T(k) : k);
  const el = (tag, attrs = {}, text) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };

  let root = null, scrim = null, page = "general", info = {}, focusBack = null;
  const refresh = [];   // what follows a change (rows that show only with a fixed style, what the application told)
  const isOpen = () => !!root && root.hasAttribute("data-open");

  // one setting changed: here at once, the application keeps it and tells the other windows
  function set(key, value) {
    if (now()[key] === value) return;
    window.MdPrefs = { ...now(), [key]: value };
    post("prefs", { prefs: { [key]: value } });
    if (key === "lang") window.MdView.core.toast(T("prefs.langLater"));
    if (key === "hinting") window.MdView.core.toast(T("prefs.restartLater"));
    if (A.onPrefs) A.onPrefs();
    if (window.MdView.prefsChanged) window.MdView.prefsChanged();
    refresh.forEach((f) => f());
  }

  // a choice: the app's own button and menu (viewer.js popup); its text follows what is set here
  const popup = (select) => { const wrap = window.MdView.core.popup(select); refresh.push(wrap.sync); return wrap; };
  const closeMenu = () => window.MdView.core.closePick();

  function control(key, kind, choices) {
    if (kind === "switch") {
      const input = el("input", { type: "checkbox", class: "pf-switch", role: "switch" });
      input.checked = !!now()[key];
      input.onchange = () => set(key, input.checked);
      return input;
    }
    if (kind === "select") {
      const input = el("select", { class: "lp-field pf-select" });
      for (const [v, l] of choices) input.appendChild(el("option", { value: String(v) }, label(l)));
      // a folder of one's own, typed in, shows as a choice of its own
      if (key === "images" && !choices.some(([v]) => v === now().images)) input.appendChild(el("option", { value: now().images }, now().images));
      input.value = String(now()[key]);
      input.onchange = () => set(key, typeof DEFAULTS[key] === "number" ? Number(input.value) : input.value);
      return popup(input);
    }
    if (kind === "text") {
      const input = el("input", { type: "text", class: "lp-field pf-text", spellcheck: "false", autocomplete: "off" });
      input.value = now()[key] || "";
      refresh.push(() => { input.placeholder = (key === "aiModel" && info.aiModel) || ""; });
      input.onchange = () => set(key, input.value.trim());
      return input;
    }
    if (kind === "key") { // the model's key: typed in here, kept by the application; only its end is ever shown
      const box = el("div", { class: "pf-key" });
      const state = el("span", { class: "pf-state" }), field = el("input", { type: "password", class: "lp-field pf-text", spellcheck: "false", autocomplete: "off", placeholder: T("prefs.aiKey.placeholder") });
      const save = el("button", { class: "pf-link", type: "button" }, T("prefs.aiKey.save")), remove = el("button", { class: "pf-link danger", type: "button" }, T("prefs.aiKey.remove"));
      field.setAttribute("aria-label", T("prefs.aiKey"));
      const send = () => { const key = field.value.trim(); if (!key) return; post("aikey", { key }); field.value = ""; };
      save.onclick = send;
      field.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
      remove.onclick = () => post("aikey", { key: "" });
      refresh.push(() => {
        const k = info.aiKey || {};
        state.textContent = k.env ? T("prefs.aiKey.env") : k.set ? T("prefs.aiKey.set").replace("%s", k.tail) : T("prefs.aiKey.none");
        state.classList.toggle("on", !!k.set);
        remove.hidden = !k.set || !!k.env;
        field.disabled = save.disabled = !!k.env;
      });
      box.append(state, field, save, remove);
      return box;
    }
    if (kind === "action") {
      const b = el("button", { class: "pf-link", type: "button" }, T("prefs." + key + ".do"));
      b.onclick = () => { close(); post("help"); };
      return b;
    }
    const value = el("span", { class: "pf-value" });
    refresh.push(() => { value.textContent = info[key] || "—"; });
    return value;
  }

  function build() {
    scrim = el("div", { id: "settings-scrim" });
    root = el("div", { id: "settings", role: "dialog", "aria-modal": "true", "aria-labelledby": "st-title", tabindex: "-1" });
    const side = el("nav", { class: "st-side", "aria-label": T("prefs.title") });
    side.appendChild(el("div", { class: "st-name" }, T("prefs.title")));
    for (const [title, ids] of GROUPS) {
      const group = el("div", { class: "st-group" });
      if (title) group.appendChild(el("div", { class: "st-group-title" }, T(title)));
      for (const id of ids) {
        const [, icon] = PAGES.find((p) => p[0] === id);
        const b = el("button", { class: "st-nav", type: "button", "data-page": id });
        b.innerHTML = `<span class="st-icon">${UI[icon] || ""}</span>`;
        b.appendChild(el("span", { class: "st-label" }, T("prefs.page." + id)));
        group.appendChild(b);
      }
      side.appendChild(group);
    }
    const main = el("div", { class: "st-main" });
    const head = el("header", { class: "st-head" });
    const x = el("button", { class: "st-close", type: "button", "data-do": "cancel", "aria-label": T("prefs.close") });
    x.innerHTML = UI.x;
    head.append(x, el("h2", { id: "st-title" }));
    const content = el("div", { class: "st-content" });
    for (const [id, , sections] of PAGES) {
      const pg = el("section", { class: "st-page", "data-page": id });
      for (const [title, rows] of sections) {
        if (title) pg.appendChild(el("div", { class: "pf-section" }, T(title)));
        const card = el("div", { class: "st-card" });
        for (const [key, kind, choices, when] of rows) {
          const row = el(kind === "switch" ? "label" : "div", { class: "pf-row" + (when ? " pf-sub" : ""), "data-key": key });
          const text = el("span", { class: "pf-text-col" });
          text.appendChild(el("span", { class: "pf-name" }, T("prefs." + key)));
          const hint = T("prefs." + key + ".hint");
          if (hint !== "prefs." + key + ".hint") text.appendChild(el("span", { class: "pf-hint" }, hint));
          row.append(text, control(key, kind, choices));
          if (when) refresh.push(() => { row.hidden = now().style !== when; });
          card.appendChild(row);
        }
        pg.appendChild(card);
      }
      content.appendChild(pg);
    }
    main.append(head, content);
    root.append(side, main);
    document.body.append(scrim, root);

    side.addEventListener("click", (e) => { const b = e.target.closest(".st-nav"); if (b) show(b.dataset.page); });
    x.addEventListener("click", () => close());
    scrim.addEventListener("mousedown", (e) => { e.preventDefault(); close(); });
    // the wheel belongs to the window while it is open: the note under it does not scroll
    const holdWheel = (e) => {
      if (e.ctrlKey) return;
      for (let n = e.target; n && n !== document.body; n = n.parentElement) {
        if (n.nodeType === 1 && /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1 && (e.deltaY < 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1)) return;
        if (n === root || n === scrim) break;
      }
      e.preventDefault();
    };
    scrim.addEventListener("wheel", holdWheel, { passive: false });
    root.addEventListener("wheel", holdWheel, { passive: false });
    root.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      e.stopPropagation(); // the page's shortcuts are not for here
      const nav = e.target.closest?.(".st-nav") || (e.target === root ? side.querySelector(".st-nav[aria-current]") : null);
      if (e.key === "Escape" || (e.key === "," && (e.ctrlKey || e.metaKey))) { e.preventDefault(); close(); }
      else if (nav && (e.key === "ArrowDown" || e.key === "ArrowUp")) { // the groups: up and down, the page follows
        const all = [...side.querySelectorAll(".st-nav")], to = all[all.indexOf(nav) + (e.key === "ArrowDown" ? 1 : -1)];
        e.preventDefault();
        if (to) { to.focus(); show(to.dataset.page); }
      } else if (e.key === "Tab") { // the focus stays in the window
        const all = [...root.querySelectorAll("input, button, select")].filter((n) => !n.disabled && n.offsetParent && (!n.matches(".st-nav") || n.getAttribute("aria-current")));
        const i = all.indexOf(document.activeElement);
        e.preventDefault();
        all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus();
      }
    });
  }
  function show(id) {
    page = id;
    for (const b of root.querySelectorAll(".st-nav")) { if (b.dataset.page === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }
    for (const p of root.querySelectorAll(".st-page")) p.toggleAttribute("data-on", p.dataset.page === id);
    root.querySelector("#st-title").textContent = T("prefs.page." + id);
    root.querySelector(".st-content").scrollTop = 0;
  }
  function open(at) {
    if (A.dialog.open || isOpen()) return false;
    if (!root) build();
    focusBack = document.activeElement;
    // (the values as they are now: another window may have changed them)
    for (const row of root.querySelectorAll(".pf-row")) {
      const key = row.dataset.key, input = row.querySelector(":scope > input, select");
      if (!input || !(key in DEFAULTS)) continue;
      if (input.type === "checkbox") input.checked = !!now()[key]; else input.value = String(now()[key] ?? "");
    }
    refresh.forEach((f) => f());
    show(PAGES.some((p) => p[0] === at) ? at : page);
    post("settings-info");
    void root.offsetWidth;
    window.MdView.core.lockScroll(true);
    scrim.dataset.open = root.dataset.open = "";
    root.focus({ preventScroll: true }); // (the window itself: no ring on a group until the keyboard is used)
    return true;
  }
  function close() {
    if (!isOpen()) return false;
    closeMenu(false);
    if (document.activeElement && root.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur(); // (a text field's change is taken)
    delete scrim.dataset.open; delete root.dataset.open;
    window.MdView.core.lockScroll(false);
    const view = A.view && A.view.pm;
    if (focusBack && focusBack.isConnected && focusBack !== document.body) focusBack.focus({ preventScroll: true }); else if (view) view.focus();
    focusBack = null;
    return true;
  }
  // what the application knows: { aiKey: { set, tail, env }, aiModel, version, configDir }
  function gotInfo(data) { info = { ...info, ...(data || {}) }; refresh.forEach((f) => f()); }

  // the settings changed: what depends on them follows at once
  A.onPrefs = () => {
    if (A.view.store) A.view.store.profile = null; // the style of new Markdown
    if (!now().bar) A.bar.hide();
    if (!now().slash && A.menu.isOpen) A.menu.close();
    if (A.view.pm) A.view.pm.dispatch(A.view.pm.state.tr.setMeta("prefs", true)); // decorations drawn again
  };
  // (the window is put together in a quiet moment: built on the first Ctrl+, it made that one slow)
  setTimeout(() => { if (!root) { try { build(); } catch (e) { root = scrim = null; } } }, 2500);
  A.prefs = { open, close, get: now, DEFAULTS, info: gotInfo, get isOpen() { return isOpen(); } };
})();
