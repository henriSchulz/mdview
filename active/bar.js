/* mdview active mode — the formatting bar that floats over a text selection,
 * and the small tooltips of its buttons. */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const { Plugin, PluginKey, TextSelection } = PM.state;
  const M = A.schema.marks;
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

  // ------------------------------------------------------------ tooltips (after 700 ms, never the browser's)
  const tip = document.createElement("div");
  tip.id = "acttip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let tipTimer = 0;
  function hideTip() { clearTimeout(tipTimer); delete tip.dataset.open; }
  function tips(root) {
    root.addEventListener("mouseover", (e) => {
      const el = e.target.closest?.("[data-tip]");
      hideTip();
      if (!el) return;
      tipTimer = setTimeout(() => {
        if (!el.isConnected) return;
        tip.textContent = el.dataset.tip;
        const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
        const above = r.top - 6 - h >= 8;
        tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + "px";
        tip.style.top = (above ? r.top - 6 - h : r.bottom + 6) + "px";
        tip.dataset.open = "";
      }, 700);
    });
    root.addEventListener("mouseleave", hideTip);
    root.addEventListener("mousedown", hideTip);
  }

  // ------------------------------------------------------------ the bar
  const bar = document.createElement("div");
  bar.id = "fmtbar";
  bar.className = "surface";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", T("bar.label"));
  const BUTTONS = [
    ["strong", "bar.bold", "Ctrl+B", `<b>B</b>`],
    ["em", "bar.italic", "Ctrl+I", `<i>I</i>`],
    ["s", "bar.strike", "Ctrl+Shift+X", `<s>S</s>`],
    ["code", "bar.code", "Ctrl+`", svg('<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>')],
    ["link", "bar.link", "Ctrl+K", svg('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>')],
    ["math", "bar.math", "", `<span class="fb-math">∑</span>`],
    ["para", "bar.paragraph", "", `<span class="fb-para">¶</span>${svg('<path d="m7 10 5 5 5-5"/>')}`],
  ];
  bar.innerHTML = BUTTONS.map(([id, key, short, html], i) =>
    (i === 4 || i === 6 ? `<span class="fb-rule"></span>` : "") +
    `<button class="tb fb" type="button" tabindex="-1" data-do="${id}" data-tip="${T(key)}${short ? " (" + short + ")" : ""}" aria-label="${T(key)}">${html}</button>`).join("");
  document.body.appendChild(bar);
  tips(bar);
  if (document.getElementById("linkpop")) tips(document.getElementById("linkpop")); // a long address in full
  const button = (id) => bar.querySelector(`[data-do="${id}"]`);

  let shown = false, timer = 0, pressed = false, view = null;
  const wanted = (state) => {
    const sel = state.selection;
    return sel instanceof TextSelection && !sel.empty && sel.$from.parent.isTextblock && !!state.doc.textBetween(sel.from, sel.to, " ", " ").trim();
  };
  function reflect(state) {
    for (const m of ["strong", "em", "s", "code"]) {
      const on = A.context.markActive(state, M[m]);
      button(m).classList.toggle("active", on);
      button(m).setAttribute("aria-pressed", String(on));
    }
    button("link").classList.toggle("active", state.doc.rangeHasMark(state.selection.from, state.selection.to, M.link));
    const one = state.selection.$from.sameParent(state.selection.$to);
    button("link").disabled = button("math").disabled = !one;
    button("para").disabled = A.context.blockKind(state).cell;
  }
  let placed = ""; // the selection the bar was placed for: it does not wander when the text under it changes its width
  function place(again = false) {
    if (!view) return;
    const { from, to } = view.state.selection;
    if (!again && shown && placed === from + ":" + to) return;
    placed = from + ":" + to;
    const a = view.coordsAtPos(from), b = view.coordsAtPos(to, -1);
    const top = Math.min(a.top, b.top), bottom = Math.max(a.bottom, b.bottom);
    if (bottom < 0 || top > innerHeight) return hide(); // scrolled out of sight
    const w = bar.offsetWidth, h = bar.offsetHeight;
    const left = a.top === b.top ? (a.left + b.right) / 2 : (view.dom.getBoundingClientRect().left + view.dom.getBoundingClientRect().right) / 2;
    const above = top - 8 - h >= 56; // (the window's own toolbar is up there)
    bar.dataset.side = above ? "above" : "below";
    bar.style.left = Math.max(8, Math.min(left - w / 2, innerWidth - w - 8)) + "px";
    bar.style.top = Math.max(8, Math.min(above ? top - 8 - h : bottom + 8, innerHeight - h - 8)) + "px";
  }
  function show() {
    if (!view || !wanted(view.state) || !view.hasFocus() || A.menu.isOpen || A.dialog.open || !A.prefs.get().bar) return;
    reflect(view.state);
    place(true);
    bar.dataset.open = "";
    shown = true;
  }
  function hide() {
    clearTimeout(timer);
    hideTip();
    if (!shown) return;
    shown = false;
    delete bar.dataset.open;
  }
  function later() { clearTimeout(timer); timer = setTimeout(show, 150); }

  bar.addEventListener("mousedown", (e) => e.preventDefault()); // the selection stays
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-do]");
    if (!b || b.disabled || !view) return;
    const what = b.dataset.do;
    if (what === "link") { hide(); A.link.edit(view); return; }
    if (what === "math") { hide(); A.context.toMath(view); return; }
    if (what === "para") {
      const k = A.context.blockKind(view.state), r = b.getBoundingClientRect(), v = view;
      const entry = (kind, key, n) => ({ label: T(key, n), checked: kind === "quote" ? k.quote : k.kind === kind, run: () => { A.context.run(v, A.context.PARAGRAPH[kind]); later(); } });
      A.menu.open({ x: r.left, y: r.bottom + 4, closed: () => v.focus(), items: [
        entry("text", "menu.text"), entry("h1", "menu.heading", 1), entry("h2", "menu.heading", 2), entry("h3", "menu.heading", 3), null,
        entry("bullet", "menu.bullet"), entry("ordered", "menu.ordered"), entry("task", "menu.task"), entry("quote", "menu.quote"),
      ] });
      return;
    }
    A.context.toggle(view, what);
    reflect(view.state);
  });
  window.addEventListener("scroll", () => { if (shown) place(true); }, { passive: true });
  window.addEventListener("resize", () => { if (shown) place(true); });

  const plugin = new Plugin({
    key: new PluginKey("bar"),
    view(v) {
      view = v;
      const down = (e) => { if (e.button === 0) { pressed = true; hide(); } };
      const up = () => { if (!pressed) return; pressed = false; if (wanted(v.state)) later(); };
      v.dom.addEventListener("mousedown", down);
      document.addEventListener("mouseup", up);
      const blur = () => setTimeout(() => { if (!v.hasFocus() && !A.menu.isOpen) hide(); }, 0);
      v.dom.addEventListener("blur", blur);
      return {
        update(now, prev) {
          view = now;
          if (!now.editable || !wanted(now.state)) return hide();
          if (now.state.doc !== prev.doc && !shown) return; // typing over a selection: nothing to offer
          if (shown) { reflect(now.state); place(); } else if (!pressed) later(); // while dragging: when the button is let go
        },
        destroy() { hide(); v.dom.removeEventListener("mousedown", down); document.removeEventListener("mouseup", up); v.dom.removeEventListener("blur", blur); if (view === v) view = null; },
      };
    },
    props: {
      handleKeyDown(_v, e) {
        if (shown && e.key === "Escape") { hide(); return true; }
        if (shown && e.key.length === 1 && !e.ctrlKey && !e.metaKey) hide(); // typing
        return false;
      },
    },
  });

  A.bar = { plugin, el: bar, tips, hide, get shown() { return shown; } };
})();
