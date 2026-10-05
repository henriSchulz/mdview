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

  let root = null, box = null, title = null, text = null, linkRow = null, link = null, copy = null, passRow = null, pass = null, set = null, drop = null, stop = null, go = null, back = null;
  let path = null, state = null, waiting = false; // state: what the application said last
  const isOpen = () => !!root && root.hasAttribute("data-open");

  function build() {
    root = el("div", { id: "share", class: "share-scrim" });
    box = el("div", { class: "share-box surface", role: "dialog", "aria-modal": "true", "aria-labelledby": "share-title", tabindex: "-1" });
    title = el("b", { id: "share-title" });
    text = el("p", { class: "share-text" });
    linkRow = el("div", { class: "share-row" });
    link = el("input", { class: "lp-field mono", type: "text", readonly: "", "aria-label": T("share.link") });
    copy = el("button", { class: "btn", type: "button" }, T("share.copy"));
    linkRow.append(link, copy);
    passRow = el("div", { class: "share-row" });
    pass = el("input", { class: "lp-field", type: "password", autocomplete: "new-password", "aria-label": T("share.password") });
    set = el("button", { class: "btn", type: "button" });
    passRow.append(pass, set);
    drop = el("button", { class: "pf-link", type: "button" }, T("share.password.remove"));
    const foot = el("div", { class: "share-foot" });
    stop = el("button", { class: "pf-link danger", type: "button" }, T("share.stop"));
    go = el("button", { class: "btn primary", type: "button" }, T("share.start"));
    back = el("button", { class: "btn", type: "button" });
    foot.append(stop, drop, el("span"), back, go);
    box.append(title, text, linkRow, passRow, foot);
    root.appendChild(box);
    document.body.appendChild(root);

    const ask = (type, data = {}) => { waiting = true; draw(); post(type, { path, ...data }); };
    link.addEventListener("focus", () => link.select());
    copy.onclick = () => { post("copy", { text: link.value }); copy.textContent = T("share.copied"); copy.classList.add("done"); setTimeout(() => { copy.textContent = T("share.copy"); copy.classList.remove("done"); }, 1400); };
    go.onclick = () => ask("share-set", { password: pass.value || null });
    set.onclick = () => { if (pass.value) ask("share-set", { password: pass.value }); else pass.focus(); };
    drop.onclick = () => ask("share-set", { password: null });
    stop.onclick = () => ask("share-stop");
    back.onclick = close;
    pass.addEventListener("input", draw);
    root.addEventListener("mousedown", (e) => { if (e.target === root) close(); });
    document.addEventListener("keydown", (e) => { if (isOpen() && e.key === "Escape" && !root.contains(e.target)) { e.preventDefault(); e.stopPropagation(); close(); } }, true); // (wherever the focus got to)
    root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Enter" && e.target === pass) { e.preventDefault(); (state && state.link ? set : go).click(); }
      else if (e.key === "Tab") { // the focus stays in the window
        const all = [...box.querySelectorAll("input, button")].filter((n) => !n.disabled && n.offsetParent);
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
    text.textContent = !s ? "" : !can ? s.why || T("share.cannot") : !shared ? T("share.intro")
      : (s.password ? T("share.on.password") : T("share.on")) + (s.pending ? " " + T("share.pending") : "");
    linkRow.hidden = !shared;
    passRow.hidden = !can;
    if (shared && link.value !== s.link) link.value = s.link;
    pass.placeholder = T(!shared ? "share.password.optional" : s.password ? "share.password.new" : "share.password");
    set.textContent = T(s && s.password ? "share.password.change" : "share.password.set");
    set.hidden = !shared;
    set.disabled = waiting || !pass.value;
    drop.hidden = !(shared && s.password);
    stop.hidden = !shared;
    go.hidden = shared || !can;
    back.textContent = T(shared || !can ? "dialog.done" : "dialog.cancel");
    for (const b of [go, drop, stop]) b.disabled = waiting;
    box.toggleAttribute("aria-busy", waiting);
    // (a button that went while it had the focus: the keys stay the window's)
    const at = document.activeElement;
    if (isOpen() && (!box.contains(at) || at.hidden || at.disabled)) box.focus();
  }

  // how it stands, as the application says it: { path, can, why, link, password, pending }
  function got(data) {
    if (!data || data.path !== path) return;
    const was = state;
    state = data; waiting = false;
    if (was && (!!was.password !== !!data.password || !!was.link !== !!data.link)) pass.value = "";
    draw();
    if (isOpen() && !(was && was.link) && data.link) { link.focus(); link.select(); }
  }
  function open(of) {
    const cur = window.MdView.core.current, p = of || (cur && cur.path);
    if (A.dialog.open || isOpen() || (A.prefs && A.prefs.isOpen) || (A.history && A.history.isOpen) || (A.conflict && A.conflict.isOpen) || !p || !/\.(md|markdown)$/i.test(p)) return false;
    if (!root) build();
    window.MdView.flush(false); // (what is typed and not saved yet is the note that is shared)
    path = p; state = null; waiting = true;
    pass.value = ""; link.value = "";
    draw();
    root.dataset.open = "";
    post("share-info", { path });
    (document.activeElement || document.body).blur?.();
    setTimeout(() => { if (isOpen()) (state && state.link ? link : state && state.can ? pass : back).focus(); }, 60);
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
