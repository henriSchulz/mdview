/* mdview active mode — a small menu at a point (the app's menu look and
 * behaviour: highlight follows at once, a chosen entry blinks, then acts). */
"use strict";
(() => {
  const A = window.MdActive;
  const el = document.createElement("div");
  el.id = "actmenu";
  el.className = "ui-menu surface";
  el.tabIndex = -1;
  el.setAttribute("role", "menu");
  document.body.appendChild(el);
  let entries = [], hl = -1, after = null;
  const isOpen = () => el.hasAttribute("data-open");
  const setHl = (i) => { hl = i; entries.forEach((e, k) => e.el.classList.toggle("hl", k === i)); };
  const usable = (i) => entries[i] && !entries[i].item.disabled;
  function step(dir, from = hl) {
    for (let k = 1; k <= entries.length; k++) {
      const i = (from + dir * k + entries.length * 2) % entries.length;
      if (usable(i)) return setHl(i);
    }
  }
  /* items: { label, key, danger, disabled, checked, run } or null for a rule.
   * closed: called when the menu goes without a choice. */
  function open({ x, y, items, origin = "top left", closed = null }) {
    el.textContent = "";
    entries = [];
    after = closed;
    for (const item of items) {
      if (!item) { const rule = document.createElement("div"); rule.className = "menu-rule"; el.appendChild(rule); continue; }
      const b = document.createElement("button");
      b.className = "menu-item" + (item.danger ? " danger" : "");
      b.setAttribute("role", item.checked != null ? "menuitemcheckbox" : "menuitem");
      if (item.checked != null) b.setAttribute("aria-checked", String(!!item.checked));
      b.disabled = !!item.disabled;
      const label = document.createElement("span");
      label.textContent = item.label;
      b.appendChild(label);
      if (item.checked || item.key) {
        const k = document.createElement("span");
        k.className = "menu-key";
        k.textContent = item.checked ? "✓" : item.key;
        b.appendChild(k);
      }
      el.appendChild(b);
      entries.push({ el: b, item });
    }
    setHl(-1);
    el.style.setProperty("--origin", origin);
    el.style.left = Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)) + "px";
    el.style.top = Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8)) + "px";
    el.dataset.open = "";
    el.focus({ preventScroll: true });
  }
  function close(chosen = false) {
    if (!isOpen()) return false;
    delete el.dataset.open;
    const f = after;
    after = null;
    if (!chosen && f) f();
    return true;
  }
  function run(i) {
    if (!usable(i)) return;
    const { el: b, item } = entries[i];
    const cs = getComputedStyle(document.documentElement).getPropertyValue("--flash-duration");
    const flash = parseFloat(cs) * (/ms\s*$/.test(cs) ? 1 : 1000) || 70; // blink once, then act — like NSMenu
    b.classList.remove("hl");
    setTimeout(() => b.classList.add("hl"), flash);
    setTimeout(() => { close(true); item.run(); }, flash * 2);
  }
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener("mousemove", (e) => {
    const i = entries.findIndex((x) => x.el === e.target.closest(".menu-item"));
    if (i !== hl) setHl(usable(i) ? i : -1);
  });
  el.addEventListener("mouseleave", () => setHl(-1));
  el.addEventListener("click", (e) => run(entries.findIndex((x) => x.el === e.target.closest(".menu-item"))));
  el.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowUp") step(-1, hl < 0 ? 0 : hl);
    else if (e.key === "Home") step(1, -1);
    else if (e.key === "End") step(-1, 0);
    else if (e.key === "Enter" || e.key === " ") run(hl);
    else return;
    e.preventDefault();
  });
  document.addEventListener("mousedown", (e) => { if (isOpen() && !el.contains(e.target)) close(); }, true);
  el.addEventListener("blur", () => setTimeout(() => { if (isOpen() && document.activeElement !== el) close(); }));
  window.addEventListener("scroll", () => close(), { passive: true });

  A.menu = { open, close, el, get isOpen() { return isOpen(); } };
})();
