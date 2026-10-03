/* mdview active mode — a menu at a point (the app's menu look and behaviour:
 * highlight follows at once, a chosen entry blinks, then acts). An entry may
 * open a second menu beside it, and may have a sign before its name.
 * The menu never takes the focus: the editor keeps it, with its selection as
 * it is, and the keys go to the menu while it is open. */
"use strict";
(() => {
  const A = window.MdActive;
  const { ICON, keys: signs } = window.MdView.core;
  function panel(id) {
    const el = document.createElement("div");
    el.id = id;
    el.className = "ui-menu surface actmenu";
    el.tabIndex = -1;
    el.setAttribute("role", "menu");
    document.body.appendChild(el);
    return { el, entries: [], hl: -1 };
  }
  const root = panel("actmenu"), sub = panel("actsub");
  let after = null, subOf = -1, subTimer = 0, keys = root; // keys: the panel the arrow keys move in
  let passive = false; // the document still gets the typing (a menu that filters by it, like the "/" menu)
  const isOpen = (p = root) => p.el.hasAttribute("data-open");
  const usable = (p, i) => p.entries[i] && !p.entries[i].item.disabled;
  function setHl(p, i) {
    p.hl = i;
    p.entries.forEach((e, k) => e.el.classList.toggle("hl", k === i || (p === root && k === subOf && isOpen(sub))));
  }
  // by the keys: what is highlighted is in sight (a menu longer than its panel)
  const reveal = (p) => { if (p.entries[p.hl]) p.entries[p.hl].el.scrollIntoView({ block: "nearest" }); };
  function step(p, dir, from = p.hl) {
    for (let k = 1; k <= p.entries.length; k++) {
      const i = (from + dir * k + p.entries.length * 2) % p.entries.length;
      if (usable(p, i)) { setHl(p, i); return reveal(p); }
    }
  }
  function fill(p, items) {
    p.el.textContent = "";
    p.entries = [];
    const icons = items.some((item) => item && item.icon);
    if (!items.length) { const none = document.createElement("div"); none.className = "menu-empty"; none.textContent = window.MdStrings.t("menu.none"); p.el.appendChild(none); }
    for (const item of items) {
      if (!item) { const rule = document.createElement("div"); rule.className = "menu-rule"; p.el.appendChild(rule); continue; }
      const b = document.createElement("button");
      b.className = "menu-item" + (item.danger ? " danger" : "");
      b.setAttribute("role", item.checked != null ? "menuitemcheckbox" : "menuitem");
      if (item.checked != null) b.setAttribute("aria-checked", String(!!item.checked));
      if (item.items) b.setAttribute("aria-haspopup", "menu");
      b.disabled = !!item.disabled;
      // as a macOS menu: the tick in a column before the label, the shortcut (or the arrow to a menu beside it) behind
      const part = (cls, html) => { const el = document.createElement("span"); el.className = cls; if (html) el.innerHTML = html; return b.appendChild(el); };
      part("menu-check", ICON.check);
      if (icons) part("menu-icon", item.icon || ""); // (a column: the names stand in one line)
      part("menu-label").textContent = item.label;
      if (item.key) part("menu-key").textContent = signs(item.key);
      if (item.items) part("menu-more", ICON.chevron);
      p.el.appendChild(b);
      p.entries.push({ el: b, item });
    }
    p.el.classList.toggle("has-checks", items.some((item) => item && item.checked != null));
    setHl(p, -1);
  }
  // above: where its lower edge goes when there is no room below y (so it does not cover what it belongs to)
  function place(p, x, y, origin, above = null) {
    p.el.style.left = p.el.style.top = "0px"; // measured with room: where it stood last may leave it none
    const h = p.el.offsetHeight, up = above != null && y + h > innerHeight - 8 && above - h >= 8;
    p.el.style.setProperty("--origin", up ? origin.replace("top", "bottom") : origin);
    p.el.style.left = Math.max(8, Math.min(x, innerWidth - p.el.offsetWidth - 8)) + "px";
    p.el.style.top = (up ? above - h : Math.max(8, Math.min(y, innerHeight - h - 8))) + "px";
    p.above = up ? above : null;
    p.el.dataset.open = "";
  }
  /* items: { label, key, danger, disabled, checked, run } or { label, items } for a menu beside it,
   * or null for a rule; icon: a sign before the name. closed: called when the menu goes without a choice.
   * typing: the document keeps the typing, the menu only the keys it is moved by.
   * steady: no taller than a few entries, and as tall as it opens whatever it is filled with later
   * (a menu filtered while one types does not jump under the eyes). */
  function open({ x, y, items, origin = "top left", closed = null, typing = false, above = null, steady = false }) {
    closeSub();
    root.el.classList.toggle("steady", steady);
    root.el.style.height = "";
    fill(root, items);
    after = closed;
    passive = typing;
    if (typing) step(root, 1, -1);
    place(root, x, y, origin, above);
    if (steady) root.el.style.height = root.el.offsetHeight + "px";
    root.el.scrollTop = 0;
    keys = root;
  }
  function openSub(i, viaKey) {
    clearTimeout(subTimer);
    if (!isOpen()) return closeSub(); // (its menu is gone, or going)
    if (subOf === i && isOpen(sub)) return;
    const entry = root.entries[i];
    if (!entry || !entry.item.items || entry.item.disabled) return closeSub();
    fill(sub, entry.item.items);
    subOf = i;
    sub.el.style.left = "0px";
    const r = entry.el.getBoundingClientRect(), w = sub.el.offsetWidth;
    const right = r.right + 2 + w <= innerWidth - 8;
    place(sub, right ? r.right + 2 : r.left - 2 - w, r.top - 5, right ? "top left" : "top right");
    setHl(root, i);
    if (viaKey) { step(sub, 1, -1); keys = sub; }
  }
  function closeSub() {
    clearTimeout(subTimer);
    subOf = -1;
    keys = root;
    delete sub.el.dataset.open;
  }
  function close(chosen = false) {
    if (!isOpen()) { closeSub(); return false; }
    closeSub();
    delete root.el.dataset.open;
    const f = after;
    after = null;
    if (!chosen && f) f();
    return true;
  }
  let chosen = false;
  function run(p, i) {
    if (!usable(p, i) || chosen) return;
    const { el: b, item } = p.entries[i];
    if (item.items) return openSub(i, true);
    const cs = getComputedStyle(document.documentElement).getPropertyValue("--flash-duration");
    const flash = parseFloat(cs) * (/ms\s*$/.test(cs) ? 1 : 1000) || 70; // blink once, then act — like NSMenu
    b.classList.remove("hl");
    setTimeout(() => b.classList.add("hl"), flash);
    chosen = true; // (one choice per menu: a second click while it blinks does nothing)
    setTimeout(() => { chosen = false; close(true); item.run(); }, flash * 2);
  }
  for (const p of [root, sub]) {
    const at = (e) => p.entries.findIndex((x) => x.el === e.target.closest(".menu-item"));
    p.el.addEventListener("contextmenu", (e) => e.preventDefault());
    p.el.addEventListener("mousedown", (e) => e.preventDefault()); // the focus stays where it is
    p.el.addEventListener("mousemove", (e) => {
      if (!isOpen()) return; // fading out: the pointer may still be over it
      const i = at(e);
      if (i !== p.hl) setHl(p, usable(p, i) ? i : -1);
      if (p !== root) return;
      clearTimeout(subTimer);
      if (usable(p, i) && p.entries[i].item.items) subTimer = setTimeout(() => openSub(i, false), 120);
      else if (isOpen(sub)) subTimer = setTimeout(closeSub, 200);
    });
    p.el.addEventListener("mouseleave", (e) => { if (!(p === root && sub.el.contains(e.relatedTarget))) setHl(p, -1); });
    p.el.addEventListener("click", (e) => { if (isOpen()) run(p, at(e)); });
  }
  // the keys, while a menu is open (before anything else sees them)
  document.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    const p = keys === sub && isOpen(sub) ? sub : root;
    if (/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) return;
    // typed on, into the document — but → into the menu beside an entry and ← out of it are the menu's
    const side = (e.key === "ArrowRight" && p === root && usable(p, p.hl) && !!p.entries[p.hl].item.items) || (e.key === "ArrowLeft" && p === sub);
    if (passive && !side && !/^(Escape|ArrowDown|ArrowUp|Enter|Tab)$/.test(e.key)) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.key === "Escape") { if (p === sub) { closeSub(); setHl(root, root.hl); } else close(); }
    else if (e.key === "ArrowDown") step(p, 1);
    else if (e.key === "ArrowUp") step(p, -1, p.hl < 0 ? 0 : p.hl);
    else if (e.key === "Home") step(p, 1, -1);
    else if (e.key === "End") step(p, -1, 0);
    else if (e.key === "ArrowRight" && p === root) openSub(p.hl, true);
    else if (e.key === "ArrowLeft" && p === sub) { closeSub(); setHl(root, root.hl); }
    else if (e.key === "Enter" || e.key === " ") run(p, p.hl);
    else if (e.key === "Tab") close();
  }, true);
  window.addEventListener("blur", () => close());
  sub.el.addEventListener("mouseenter", () => { clearTimeout(subTimer); setHl(root, subOf); keys = sub; });
  root.el.addEventListener("mouseenter", () => { keys = root; });
  document.addEventListener("mousedown", (e) => { if ((isOpen() || isOpen(sub)) && !root.el.contains(e.target) && !sub.el.contains(e.target)) close(); }, true);
  // scrolled by the user: the menu goes (the page moving under the caret while one types does not count)
  window.addEventListener("wheel", () => close(), { passive: true });

  // new entries, the menu where it is (the "/" menu while one types)
  function refill(items) {
    if (!isOpen()) return;
    closeSub();
    fill(root, items);
    root.el.scrollTop = 0;
    if (passive) step(root, 1, -1);
    root.el.style.left = Math.max(8, Math.min(parseFloat(root.el.style.left), innerWidth - root.el.offsetWidth - 8)) + "px";
    if (root.above != null) root.el.style.top = root.above - root.el.offsetHeight + "px"; // it stays on the line it stands on
  }
  A.menu = { open, close, refill, el: root.el, sub: sub.el, get isOpen() { return isOpen(); }, get panel() { return !isOpen() ? null : keys === sub && isOpen(sub) ? "sub" : "root"; } };
})();
