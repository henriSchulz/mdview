/* mdview active mode — its settings: a window of their own in the app's look, kept by
 * the application (state.json, "active") and handed to every window
 * (window.MdPrefs, MdView.setPrefs). */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const DEFAULTS = {
    lang: "en", startMode: "last", bar: true, slash: true, syntax: false, quotes: false, wrap: 0,
    images: "assets", style: "auto", bullet: "-", emphasis: "*", strongMark: "**", ordered: ".",
    dialogWidth: 0, dialogHeight: 0,
    latexSnippets: true, latexFraction: true, latexMatrix: true, latexTabout: true, latexEnlarge: true, latexBrackets: true, latexText: true,
    sidebarPdf: true, sidebarImages: false, sidebarMedia: false, sidebarOther: false, sidebarSort: "opened",
    aiComplete: false, aiModel: "", historyQuiet: 30, deviceName: "",
    panel: false, panelTab: "insert",
    ovScope: "all", ovLayout: "tiles", pdfFormat: "callout", pdfAuto: false, measure: "normal", hinting: false, docZoom: 100, props: true,
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
    ["history", "history", [
      // the folder this window shows: where it stands, and what its repository holds (told by the application)
      ["prefs.history.here", [
        ["historyState", "historyState"], ["historyName", "about"], ["historyRoot", "about"], ["historyBranch", "about"],
        ["historyCount", "about"], ["historyLast", "about"], ["historyChanged", "about"], ["historyLink", "link"],
      ]],
      [null, [["historyQuiet", "select", [[10, "10 s"], [30, "30 s"], [60, "1 min"], [300, "5 min"]]]]],
      ["prefs.history.device", [["deviceName", "text"], ["deviceId", "about"]]],
      // signing in, for a project linked to a repository there (the application does it and says how it stands)
      ["prefs.history.github", [["githubAccount", "github"], ["githubGet", "get"]]],
    ]],
    ["editing", "pencil", [
      [null, [["bar", "switch"], ["slash", "switch"], ["syntax", "switch"], ["quotes", "switch"]]],
      ["prefs.paragraphs", [["wrap", "select", [[0, "prefs.wrap.off"], [72, "72"], [80, "80"], [100, "100"], [120, "120"]]]]],
      ["prefs.pictures", [["images", "select", [["assets", "prefs.images.assets"], ["beside", "prefs.images.beside"]]]]],
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
  const GROUPS = [[null, ["general", "appearance"]], ["prefs.group.notes", ["sidebarPage", "allNotes", "history"]], ["prefs.group.writing", ["editing", "newMarkdown", "latex", "pdf", "ai"]], [null, ["about"]]];
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
      refresh.push(() => { input.placeholder = (key === "aiModel" && info.aiModel) || (key === "deviceName" && info.deviceName) || ""; });
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
    if (kind === "link" || kind === "get") {
      // link: the project's other side on GitHub — linked, how the two stand, and unlinking; not
      // linked, a button that opens the chooser. get: a button for the chooser, and the one
      // picked is fetched into a folder of its own. Nothing is ever chosen beforehand.
      const box = el("div", { class: "pf-github" });
      const state = el("span", { class: "pf-value" });
      const act = el("button", { class: "pf-link", type: "button" });
      refresh.push(() => {
        const g = info.github || {}, h = info.history || {};
        const linked = kind === "link" && h.linked;
        if (g.user && !g.repos && !asking) { asking = true; post("github-repos"); } // (read once signed in; again when the window opens)
        if (!g.user) asking = false;
        act.hidden = (!g.user && !linked) || (!!linked && !!h.fixed); // (a host whose folder is the repository: nothing to unlink)
        if (linked) {
          const sync = h.sync || {};
          const how = sync.state === "conflict" ? T((sync.files || []).length === 1 ? "prefs.sync.conflict.one" : "prefs.sync.conflict", (sync.files || []).length)
            : sync.state === "offline" ? T("prefs.sync.offline") : sync.state === "signin" ? T("prefs.sync.signin") : sync.state === "error" ? sync.why
            : sync.state === "even" ? T("prefs.sync.even") : T("prefs.sync.new");
          state.textContent = String(h.linked).replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "") + " · " + how;
          act.textContent = T("prefs.github.unlink");
          act.onclick = () => post("history-link", { url: "" });
        } else {
          state.textContent = !g.user ? T("prefs.github.first") : kind === "link" ? T("prefs.github.unlinked") : "";
          act.textContent = T(kind === "link" ? "prefs.github.link" : "prefs.github.get");
          act.onclick = () => chooser.open(kind, act);
        }
        state.hidden = !state.textContent;
        chooser.sync();
      });
      box.append(state, act);
      return box;
    }
    if (kind === "github") { // who is signed in; signing in shows a code to confirm in the browser
      const box = el("div", { class: "pf-github" });
      const state = el("span", { class: "pf-value" }), code = el("span", { class: "pf-code" });
      const act = el("button", { class: "pf-link", type: "button" }), stop = el("button", { class: "pf-link", type: "button" }, T("prefs.github.cancel"));
      stop.onclick = () => post("github-cancel");
      refresh.push(() => {
        const g = info.github || {};
        const [says, does, msg] = g.user ? [T("prefs.github.in", g.user.name ? g.user.name + " (@" + g.user.login + ")" : "@" + g.user.login) + (g.said ? " — " + g.said : ""), "prefs.github.out", "github-signout"]
          : g.code ? [T("prefs.github.enter", g.code.uri.replace(/^https?:\/\//, "")), "prefs.github.open", "github-open"]
          : g.busy ? [T("prefs.github.asking"), null, null]
          : [g.said ? T("prefs.github.failed", g.said) : T("prefs.github.none"), "prefs.github.signin", "github-signin"];
        state.textContent = says;
        code.textContent = g.code ? g.code.code : "";
        code.hidden = !g.code;
        act.hidden = !does;
        if (does) { act.textContent = T(does); act.onclick = () => post(msg); }
        stop.hidden = !g.busy || !!g.user;
      });
      box.append(state, code, act, stop);
      return box;
    }
    if (kind === "historyState") { // on or off, and the button that turns it on where that can be done
      const box = el("div", { class: "pf-history" });
      const state = el("span", { class: "pf-value" }), on = el("button", { class: "pf-link", type: "button" });
      on.onclick = () => post(historyState() === "project" ? "history-disable" : "history-enable"); // (a repository that is there: the application asks first)
      refresh.push(() => {
        const st = historyState();
        state.textContent = T("prefs.history.is." + st);
        on.hidden = st === "inside" || st === "foreign" || (st === "project" && !!(info.history || {}).fixed); // (not this folder's to switch)
        on.textContent = T(st === "adopt" ? "prefs.history.adopt" : st === "project" ? "prefs.history.offDo" : "prefs.history.on");
      });
      box.append(state, on);
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
          if (/^history[A-Z]/.test(key) && kind === "about") refresh.push(() => { row.hidden = info[key] == null; }); // (only what there is to say)
          if (kind === "link") refresh.push(() => { const st = historyState(); row.hidden = st !== "project" && st !== "inside"; }); // (a project's to link)
          if (kind === "get") refresh.push(() => { row.hidden = !(info.github || {}).user; });
          card.appendChild(row);
        }
        pg.appendChild(card);
      }
      content.appendChild(pg);
    }
    main.append(head, content);
    root.append(side, main);
    document.body.append(scrim, root);
    // What a host does not have (told with the rest it knows: info.hide — a row by its key, a
    // page as "page:<id>") is not shown: the web app has no model, and signs in before any page.
    // Last, after every row's own showing and hiding; a card or section left empty goes too.
    refresh.push(() => {
      const hide = info.hide || [];
      for (const b of side.querySelectorAll(".st-nav")) b.hidden = hide.includes("page:" + b.dataset.page);
      for (const row of content.querySelectorAll(".pf-row")) if (hide.includes(row.dataset.key)) row.hidden = true;
      for (const card of content.querySelectorAll(".st-card")) {
        card.hidden = ![...card.children].some((r) => !r.hidden);
        const title = card.previousElementSibling;
        if (title && title.classList.contains("pf-section")) title.hidden = card.hidden;
      }
    });

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
    asking = false; // (the repositories are read anew: what the app is given may have changed)
    if (info.github) info.github = { ...info.github, repos: null };
    post("settings-info");
    void root.offsetWidth;
    window.MdView.core.lockScroll(true);
    scrim.dataset.open = root.dataset.open = "";
    root.focus({ preventScroll: true }); // (the window itself: no ring on a group until the keyboard is used)
    return true;
  }
  function close() {
    if (!isOpen()) return false;
    chooser.close();
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
  let asking = false; // the repositories the app was given have been asked for
  const closeSettings = () => close();

  /* --- The chooser: a small window over the settings with the repositories the app was given — a
   * field to search them, the list, and a button that does it (link the project to the one
   * picked, or get it into a folder). Nothing is picked beforehand, and nothing happens until
   * the button is pressed. */
  const chooser = (() => {
    let scrim = null, box = null, field = null, list = null, go = null, title = null, empty = null, give = null;
    let kind = "link", picked = "", back = null, shown = [];
    const isOpen = () => !!box && box.hasAttribute("data-open");
    const repos = () => (info.github || {}).repos || null;
    function fill() {
      const all = repos(), q = field.value.trim().toLowerCase();
      shown = !all ? [] : !q ? all : [...all.filter((r) => r.name.toLowerCase().split("/").some((p) => p.startsWith(q)) || r.name.toLowerCase().startsWith(q)), ...all.filter((r) => { const n = r.name.toLowerCase(); return n.includes(q) && !n.startsWith(q) && !n.split("/").some((p) => p.startsWith(q)); })];
      if (!shown.some((r) => r.url === picked)) picked = ""; // (what is searched away is not picked any more)
      list.textContent = "";
      for (const r of shown) {
        const row = el("button", { class: "st-nav hi-row rc-row", type: "button", role: "option", "aria-selected": String(r.url === picked), "data-url": r.url });
        const text = el("span", { class: "hi-row-text" });
        text.append(el("span", { class: "hi-when" }, r.name), el("span", { class: "hi-by" }, T(r.private ? "prefs.github.private" : "prefs.github.public")));
        row.appendChild(text);
        list.appendChild(row);
      }
      empty.textContent = !all ? T("prefs.github.reading") : !all.length ? T("prefs.github.norepos") : shown.length ? "" : T("prefs.github.nofit");
      empty.hidden = !empty.textContent;
      give.hidden = !all || all.length > 0;
      go.disabled = !picked;
    }
    function pick(url, into) {
      picked = url;
      for (const row of list.children) { const on = row.dataset.url === url; row.setAttribute("aria-selected", String(on)); if (on && into) row.scrollIntoView({ block: "nearest" }); }
      go.disabled = !picked;
    }
    function build() {
      scrim = el("div", { id: "repos-scrim" });
      box = el("div", { id: "repos", role: "dialog", "aria-modal": "true", "aria-labelledby": "repos-title", tabindex: "-1" });
      const head = el("header", { class: "st-head" });
      const x = el("button", { class: "st-close", type: "button", "aria-label": T("prefs.close") });
      x.innerHTML = UI.x;
      title = el("h2", { id: "repos-title" });
      head.append(x, title);
      field = el("input", { type: "text", class: "lp-field rc-search", spellcheck: "false", autocomplete: "off", placeholder: T("prefs.github.search"), "aria-label": T("prefs.github.search") });
      list = el("div", { class: "rc-list", role: "listbox", "aria-label": T("prefs.github.repo") });
      empty = el("p", { class: "rc-empty" });
      const foot = el("footer", { class: "rc-foot" });
      give = el("button", { class: "pf-link", type: "button" }, T("prefs.github.give"));
      const cancel = el("button", { class: "pf-link", type: "button" }, T("prefs.github.cancel"));
      go = el("button", { class: "pf-link rc-go", type: "button" });
      foot.append(give, cancel, go);
      box.append(head, field, list, empty, foot);
      document.body.append(scrim, box);
      x.onclick = cancel.onclick = () => close();
      give.onclick = () => post("github-give");
      scrim.addEventListener("mousedown", (e) => { e.preventDefault(); close(); });
      field.addEventListener("input", fill);
      list.addEventListener("click", (e) => { const row = e.target.closest(".rc-row"); if (row) pick(row.dataset.url === picked ? "" : row.dataset.url); });
      list.addEventListener("dblclick", (e) => { const row = e.target.closest(".rc-row"); if (row) { pick(row.dataset.url); done(); } });
      go.onclick = done;
      box.addEventListener("keydown", (e) => {
        if (e.isComposing) return;
        e.stopPropagation(); // (not the settings' keys, nor the page's)
        const at = shown.findIndex((r) => r.url === picked);
        if (e.key === "Escape") { e.preventDefault(); close(); }
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const to = shown[Math.max(0, Math.min(shown.length - 1, at + (e.key === "ArrowDown" ? 1 : at < 0 ? 0 : -1)))]; if (to) pick(to.url, true); }
        else if (e.key === "Enter" && picked && e.target !== cancel && e.target !== x && e.target !== give) { e.preventDefault(); done(); }
        else if (e.key === "Tab") { // the focus stays in the window
          const all = [field, ...box.querySelectorAll(".rc-foot button, .st-close")].filter((n) => !n.disabled && !n.hidden);
          e.preventDefault();
          all[(all.indexOf(document.activeElement) + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus();
        }
      });
    }
    function done() {
      const r = (repos() || []).find((x) => x.url === picked);
      if (!r) return;
      const what = kind;
      close();
      if (what === "link") post("history-link", { url: r.url });
      else { closeSettings(); post("github-get", { url: r.url, name: r.name.split("/").pop(), branch: r.branch }); }
    }
    function open(what, from) {
      if (isOpen()) return;
      if (!box) build();
      kind = what; picked = ""; back = from;
      title.textContent = T(what === "link" ? "prefs.github.linkTitle" : "prefs.github.getTitle");
      go.textContent = T(what === "link" ? "prefs.github.linkDo" : "prefs.github.getDo");
      field.value = "";
      fill();
      list.scrollTop = 0;
      void box.offsetWidth;
      scrim.dataset.open = box.dataset.open = "";
      field.focus({ preventScroll: true });
    }
    function close() {
      if (!isOpen()) return false;
      delete scrim.dataset.open; delete box.dataset.open;
      if (back && back.isConnected) back.focus({ preventScroll: true });
      back = null;
      return true;
    }
    return { open, close, sync: () => { if (isOpen()) fill(); }, get isOpen() { return isOpen(); } };
  })();
  const historyState = () => { const h = info.history || {}; return h.state === "foreign" && h.own ? (h.was ? "paused" : "adopt") : h.state || "none"; };
  // the folder's history as the rows show it (a row with nothing to say is not shown)
  function historyRows(h) {
    const short = (p) => (info.home && p && p.startsWith(info.home) ? "~" + p.slice(info.home.length) : p);
    const when = (t) => new Date(t * 1000).toLocaleString(now().lang === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
    const kept = h.state === "project" || h.state === "inside";
    return {
      historyName: h.name ?? null,
      historyRoot: short(h.root) ?? null,
      historyBranch: h.root ? h.branch || T("prefs.history.noBranch") : null,
      historyCount: h.root ? String(h.versions ?? 0) : null,
      historyLast: h.last ? when(h.last.time) + " · " + h.last.device.replace(/ \([0-9a-f-]{36}\)$/, "") : null,
      historyChanged: !kept ? null : !h.changed ? T("prefs.history.allKept") : T((h.waiting ? "prefs.history.waiting" : "prefs.history.changed") + (h.changed === 1 ? ".one" : "")).replace("%s", h.changed),
    };
  }
  function gotInfo(data) {
    info = { ...info, ...(data || {}) };
    if (data && data.history) Object.assign(info, historyRows(data.history));
    refresh.forEach((f) => f());
  }
  const stale = () => { if (isOpen()) post("settings-info"); }; // (the application kept a version: what is shown is no longer so)

  // the settings changed: what depends on them follows at once
  A.onPrefs = () => {
    if (A.view.store) A.view.store.profile = null; // the style of new Markdown
    if (!now().bar) A.bar.hide();
    if (!now().slash && A.menu.isOpen) A.menu.close();
    if (A.view.pm) A.view.pm.dispatch(A.view.pm.state.tr.setMeta("prefs", true)); // decorations drawn again
  };
  // (the window is put together in a quiet moment: built on the first Ctrl+, it made that one slow)
  setTimeout(() => { if (!root) { try { build(); } catch (e) { root = scrim = null; } } }, 2500);
  A.prefs = { open, close, get: now, DEFAULTS, info: gotInfo, stale, get isOpen() { return isOpen(); } };
})();
