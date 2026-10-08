/* mdview — sharing a note: a link under which anyone can read it, with a password if one is set,
 * and nothing else of the folder with it. A small window: whether the note is shared, its link,
 * its password, and the end of the sharing.
 *
 * The application knows how it stands ("share-info" → A.share.got) and does what is asked
 * ("share-set": share it, or set, change or take away its password; "share-stop"), answering
 * with how it stands then. What is shared is written down in the project itself
 * (.mdview/shares.json), so the window is the same on any host; where a folder cannot be shared
 * from — no project, not linked to GitHub — the application says why (can: false). */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const post = (type, data = {}) => window.MdHost?.post(JSON.stringify({ type, ...data }));
  const el = (tag, attrs = {}, text) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };

  const ICON = window.MdView.core.UI; // (the symbols as the app draws them)
  let root = null, box = null, title = null, text = null, card = null, linkRow = null, link = null, copy = null, rawRow = null, raw = null, copyRaw = null, more = null, moreValue = null, fold = null, pass = null, set = null, drop = null, stop = null, go = null, fix = null, down = null, get = null, back = null;
  let path = null, state = null, waiting = false, opened = false; // state: what the application said last; opened: the password's part is unfolded
  const isOpen = () => !!root && root.hasAttribute("data-open");

  function build() {
    root = el("div", { id: "share", class: "share-scrim" });
    box = el("div", { class: "share-box surface", role: "dialog", "aria-modal": "true", "aria-labelledby": "share-title", tabindex: "-1" });
    // the head: what this is about, and how it stands
    const head = el("div", { class: "share-head" }), sign = el("span", { class: "share-sign", "aria-hidden": "true" }), words = el("div", { class: "share-words" });
    sign.innerHTML = ICON.share;
    title = el("b", { id: "share-title" });
    text = el("p", { class: "share-text" });
    words.append(title, text);
    head.append(sign, words);
    // the card: the link, and — folded away until asked for — the password
    card = el("div", { class: "share-card" });
    linkRow = el("div", { class: "share-row share-link-row" });
    link = el("input", { class: "share-link mono", type: "text", readonly: "", "aria-label": T("share.link") });
    copy = el("button", { class: "pf-link share-copy", type: "button" }, T("share.copy"));
    linkRow.append(link, copy);
    // … and the note as it is written, its Markdown as text: the same address with /raw behind it
    rawRow = el("div", { class: "share-row share-link-row" });
    raw = el("input", { class: "share-link mono", type: "text", readonly: "", "aria-label": T("share.raw") });
    copyRaw = el("button", { class: "pf-link share-copy", type: "button" }, T("share.copyRaw"));
    rawRow.append(raw, copyRaw);
    more = el("button", { class: "share-row share-more", type: "button", "aria-expanded": "false", "aria-controls": "share-fold" });
    const chev = el("span", { class: "share-chev", "aria-hidden": "true" });
    chev.innerHTML = ICON.chevron;
    moreValue = el("span", { class: "share-value" });
    more.append(chev, el("span", { class: "share-name" }, T("share.password")), moreValue);
    fold = el("div", { id: "share-fold", class: "share-fold" });
    const inner = el("div", { class: "share-fold-in" }), line = el("div", { class: "share-pass" });
    pass = el("input", { class: "lp-field", type: "password", autocomplete: "new-password", "aria-label": T("share.password") });
    set = el("button", { class: "btn share-set", type: "button" });
    drop = el("button", { class: "pf-link danger share-drop", type: "button" }, T("share.password.remove"));
    line.append(pass, set);
    inner.append(line, el("p", { class: "share-hint" }, T("share.password.hint")), drop);
    fold.appendChild(inner);
    card.append(linkRow, rawRow, more, fold);
    // … or, instead of a link: the note itself, to keep or pass on — where the host can hand a file
    // out (a browser; on the desktop the note is a file in a folder already)
    down = el("div", { class: "share-card share-down" });
    const downRow = el("div", { class: "share-row" });
    get = el("button", { class: "pf-link", type: "button" }, T("share.download"));
    const what = el("span", { class: "share-name" }, T("share.download.name"));
    downRow.append(what, el("span", { class: "share-value" }, T("share.download.what")), get);
    down.appendChild(downRow);
    down.hidden = !(window.MdHost && window.MdHost.download);
    get.onclick = () => { post("download", { path }); };
    const foot = el("div", { class: "share-foot" });
    stop = el("button", { class: "pf-link danger", type: "button" }, T("share.stop"));
    go = el("button", { class: "btn primary", type: "button" }, T("share.start"));
    back = el("button", { class: "btn", type: "button" });
    // … and where it cannot be shared from yet: what is missing, to be done from here
    fix = el("button", { class: "btn primary", type: "button" });
    fix.onclick = () => {
      const need = state && state.need, folder = window.MdView.core.folder;
      close();
      if (need === "history" && folder) post("history-enable", { root: folder.root }); // (a repository that is there: the shell asks first)
      else if (need === "link" && A.prefs) A.prefs.open("history");
    };
    foot.append(stop, el("span"), back, go, fix);
    box.append(head, card, down, foot);
    root.appendChild(box);
    document.body.appendChild(root);

    const ask = (type, data = {}) => { waiting = true; draw(); post(type, { path, ...data }); };
    for (const [field, button, name] of [[link, copy, "share.copy"], [raw, copyRaw, "share.copyRaw"]]) {
      field.addEventListener("focus", () => field.select());
      button.onclick = () => { post("copy", { text: field.value }); button.textContent = T("share.copied"); button.classList.add("done"); setTimeout(() => { button.textContent = T(name); button.classList.remove("done"); }, 1400); };
    }
    more.onclick = () => { opened = !opened; draw(); if (opened) setTimeout(() => { if (isOpen() && opened) pass.focus(); }, 60); };
    go.onclick = () => ask("share-set", { password: (opened && pass.value) || null });
    set.onclick = () => { if (pass.value) ask("share-set", { password: pass.value }); else pass.focus(); };
    drop.onclick = () => ask("share-set", { password: null });
    stop.onclick = () => ask("share-stop");
    back.onclick = close;
    pass.addEventListener("input", draw);
    root.addEventListener("mousedown", (e) => { if (e.target === root) close(); });
    // The window is the only thing typed into while it is open. The note behind it takes the
    // focus back whenever it is drawn anew (a commit arrived, another device wrote): the focus is
    // brought back here, to where it was, and a key that still went elsewhere does nothing there.
    let last = null;
    document.addEventListener("focusin", (e) => {
      if (!isOpen()) return;
      if (root.contains(e.target)) { last = e.target; return; }
      const to = last && last.isConnected && !last.disabled && last.offsetParent && !last.closest("[inert]") ? last : box;
      to.focus({ preventScroll: true });
    }, true);
    document.addEventListener("keydown", (e) => {
      if (!isOpen() || root.contains(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") close(); else (last && last.isConnected && last.offsetParent && !last.closest("[inert]") ? last : box).focus({ preventScroll: true });
    }, true);
    root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Enter" && e.target === pass) { e.preventDefault(); (state && state.link ? set : go).click(); }
      else if (e.key === "Tab") { // the focus stays in the window
        const all = [...box.querySelectorAll("input, button")].filter((n) => !n.disabled && n.offsetParent && !n.closest("[inert]"));
        const i = all.indexOf(document.activeElement);
        e.preventDefault();
        all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus();
      }
    });
  }

  /* The window as things stand: not to be shared from here (why), not shared, or shared — with
   * its link, and with or without a password. */
  function draw() {
    const s = state, shared = !!(s && s.link), can = !!(s && s.can);
    title.textContent = T("share.title", (path || "").split("/").pop().replace(/\.(md|markdown)$/i, ""));
    const need = !can && s && (s.need === "history" || s.need === "link") ? s.need : "";
    text.textContent = !s ? "" : need ? T("share.need." + need) : !can ? s.why || T("share.cannot") : !shared ? T("share.intro")
      : (s.password ? T("share.on.password") : T("share.on")) + (s.pending ? " " + T("share.pending") : "");
    box.toggleAttribute("data-shared", shared);
    card.hidden = !can;
    linkRow.hidden = !shared;
    rawRow.hidden = !shared;
    if (shared && link.value !== s.link) { link.value = s.link; raw.value = s.link.replace(/\/+$/, "") + "/raw"; }
    // the password: a row that says how it is, and unfolds to set it
    moreValue.textContent = T(s && s.password ? "share.password.is" : !shared && opened && pass.value ? "share.password.will" : "share.password.none");
    more.setAttribute("aria-expanded", String(opened));
    fold.toggleAttribute("data-open", opened);
    fold.querySelector(".share-fold-in").inert = !opened;
    pass.placeholder = T(s && s.password ? "share.password.new" : "share.password");
    set.textContent = T(s && s.password ? "share.password.change" : "share.password.set");
    set.hidden = !shared; // (not shared yet: the password goes with Share)
    set.disabled = waiting || !pass.value;
    drop.hidden = !(shared && s.password);
    stop.hidden = !shared;
    go.hidden = shared || !can;
    fix.hidden = !need;
    fix.textContent = need ? T("share.fix." + need) : "";
    back.textContent = T(shared || (!can && !need) ? "dialog.done" : "dialog.cancel");
    for (const b of [go, drop, stop]) b.disabled = waiting;
    box.toggleAttribute("aria-busy", waiting);
    // (a button that went while it had the focus: the keys stay the window's)
    const at = document.activeElement;
    if (isOpen() && (!box.contains(at) || at.hidden || at.disabled || at.closest("[inert]"))) box.focus();
  }

  // how it stands, as the application says it: { path, can, why, link, password, pending }
  function got(data) {
    if (!data || data.path !== path) return;
    const was = state;
    state = data; waiting = false;
    if (was && (!!was.password !== !!data.password || !!was.link !== !!data.link)) { pass.value = ""; if (!!was.password !== !!data.password || !data.link) opened = false; } // (set, taken away, or shared no more: folded again)
    draw();
    if (isOpen() && was && !was.link && data.link) copy.focus(); // (just shared: the next thing is to copy it)
  }
  function open(of) {
    const cur = window.MdView.core.current, p = of || (cur && cur.path);
    if (A.dialog.open || isOpen() || (A.prefs && A.prefs.isOpen) || (A.history && A.history.isOpen) || (A.conflict && A.conflict.isOpen) || !p || !/\.(md|markdown)$/i.test(p)) return false;
    if (!root) build();
    window.MdView.flush(false); // (what is typed and not saved yet is the note that is shared)
    path = p; state = null; waiting = true; opened = false;
    pass.value = ""; link.value = ""; raw.value = "";
    draw();
    root.dataset.open = "";
    post("share-info", { path });
    // (an application that does not answer — one started before it learned to share: said, not left empty)
    const asked = path;
    setTimeout(() => { if (isOpen() && path === asked && !state) { state = { path, can: false, why: T("share.silent") }; waiting = false; draw(); } }, 2500);
    (document.activeElement || document.body).blur?.();
    setTimeout(() => { if (isOpen()) (state && state.link ? copy : state && state.can ? go : fix && !fix.hidden ? fix : back).focus(); }, 60);
    return true;
  }
  function close() {
    if (!isOpen()) return false;
    delete root.dataset.open;
    path = null;
    return true;
  }

  A.share = { open, close, got, get isOpen() { return isOpen(); } };
})();
