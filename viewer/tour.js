/* mdview, the page — the tour: the app's controls shown one after the other, each with a word on
 * what it does. (Issue #2: someone's father could not find the table of contents.) The web
 * host starts it once by itself, at the first note (host.js); Settings › About starts it at any
 * time (active/prefs.js), in both hosts. A step whose control is not on the screen (a narrow
 * window, an iPad, a note only read) is passed over. While it is open nothing behind it takes a
 * click, a key or the wheel. */
"use strict";
(() => {
  const P = window.MdPage;
  const { T, esc } = P; // viewer/base.js

  // [name, where its control is (the first that is on the screen)]; without a place: a word in the middle
  const STEPS = [
    ["welcome"],
    // (a folder window has these two at the head of its tabs, a note by itself in the toolbar)
    ["sidebar", '#tabs [data-act="sidebar"], #toolbar [data-act="sidebar"]'],
    ["tabs", "#tabs .tab-new"],
    ["overview", '#tabs [data-act="overview"], #toolbar [data-act="overview"], #ipad-nav .ip-all'],
    ["outline", '#toolbar [data-act="outline"]'],
    ["find", '#toolbar [data-act="find"]'],
    ["share", '#toolbar [data-act="share"]'],
    ["modes", '#toolbar .seg, #ipad-tools [data-ip="write"]'],
    ["settings", "#settings-btn"],
    ["end"],
  ];
  const PAD = 6, GAP = 12, EDGE = 12;

  const root = document.createElement("div");
  root.id = "tour";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "tour-title");
  root.innerHTML = `<div class="tour-spot"></div><div class="tour-card surface" tabindex="-1"><div class="tour-count"></div>` +
    `<h2 id="tour-title"></h2><p class="tour-text"></p><div class="tour-acts">` +
    `<button type="button" class="btn tour-skip" data-tour="skip"></button><span class="tour-gap"></span>` +
    `<button type="button" class="btn tour-back" data-tour="back"></button><button type="button" class="btn primary tour-next" data-tour="next"></button></div></div>`;
  root.hidden = true;
  document.body.appendChild(root);
  const spot = root.querySelector(".tour-spot"), card = root.querySelector(".tour-card");

  let steps = [], at = 0, target = null, frame = 0, last = "";

  // on the screen: a box of some size inside the window, not made invisible
  function onScreen(el) {
    if (!el || !el.isConnected || el.closest("[hidden]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  }
  const find = (where) => (where ? [...document.querySelectorAll(where)].find(onScreen) || null : null);
  // (the toolbar hides while one reads downwards: for the tour it is there)
  const showBars = () => { const bar = document.getElementById("toolbar"); if (bar) bar.classList.remove("hidden"); };

  function place() {
    const r = target && target.isConnected ? target.getBoundingClientRect() : null;
    const c = card.getBoundingClientRect(), w = innerWidth, h = innerHeight;
    const key = r ? [r.left, r.top, r.width, r.height, c.width, c.height, w, h].map(Math.round).join() : `-${c.width},${c.height},${w},${h}`;
    if (key === last) return;
    last = key;
    if (!r) {
      root.dataset.free = "";
      card.style.left = Math.round((w - c.width) / 2) + "px";
      card.style.top = Math.round((h - c.height) / 2) + "px";
      return;
    }
    delete root.dataset.free;
    Object.assign(spot.style, { left: r.left - PAD + "px", top: r.top - PAD + "px", width: r.width + 2 * PAD + "px", height: r.height + 2 * PAD + "px" });
    // under the control where there is room, else over it; beside it as far as the window lets it
    const below = r.bottom + PAD + GAP, above = r.top - PAD - GAP - c.height;
    const top = below + c.height <= h - EDGE || above < EDGE ? Math.min(below, h - EDGE - c.height) : above;
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - c.width / 2), w - EDGE - c.width);
    card.style.left = Math.round(left) + "px";
    card.style.top = Math.round(Math.max(EDGE, top)) + "px";
  }
  // (what is pointed at may still be moving — the toolbar sliding in, the window turned: followed while the tour is open)
  const follow = () => { place(); frame = requestAnimationFrame(follow); };

  function show(i) {
    at = i;
    const [name] = steps[at];
    showBars();
    target = find(steps[at][1]);
    root.dataset.step = name;
    card.querySelector(".tour-count").textContent = T("tour.count", at + 1, steps.length);
    card.querySelector("h2").textContent = T(`tour.${name}.title`);
    card.querySelector(".tour-text").textContent = T(`tour.${name}.text`);
    card.querySelector(".tour-skip").textContent = T("tour.skip");
    card.querySelector(".tour-skip").hidden = at === steps.length - 1;
    card.querySelector(".tour-back").textContent = T("tour.back");
    card.querySelector(".tour-back").hidden = at === 0;
    card.querySelector(".tour-next").textContent = T(at === steps.length - 1 ? "tour.done" : at === 0 ? "tour.start" : "tour.next");
    last = "";
    place();
    card.querySelector(".tour-next").focus({ preventScroll: true });
  }

  function start() {
    if (!root.hidden) return;
    showBars();
    // (only the steps whose control is there now: the count says how many there are)
    steps = STEPS.filter(([, where]) => !where || find(where));
    root.hidden = false;
    root.dataset.open = "";
    show(0);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(follow);
  }
  function stop() {
    if (root.hidden) return;
    cancelAnimationFrame(frame);
    root.hidden = true;
    delete root.dataset.open;
    target = null;
  }
  const step = (by) => { const i = at + by; if (i >= steps.length) stop(); else if (i >= 0) show(i); };

  root.addEventListener("click", (e) => {
    const b = e.target instanceof Element && e.target.closest("[data-tour]");
    if (!b) return;
    const what = b.dataset.tour;
    if (what === "skip") stop();
    else step(what === "back" ? -1 : 1);
  });
  // (the note behind takes no wheel and no finger that scrolls: there is nothing to scroll here)
  root.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
  root.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  // the keys are the tour's while it is open: nothing of the note's fires
  addEventListener("keydown", (e) => {
    if (root.hidden) return;
    const k = e.key;
    if (k === "Tab") { // (the focus stays on the card's buttons)
      const bs = [...card.querySelectorAll("button")].filter((b) => !b.hidden);
      const i = bs.indexOf(document.activeElement), n = bs.length;
      if (n) { e.preventDefault(); bs[(i + (e.shiftKey ? n - 1 : 1)) % n || 0].focus(); }
    } else if (k === "Escape") { e.preventDefault(); stop(); }
    else if (k === "ArrowRight") { e.preventDefault(); step(1); }
    else if (k === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (k === "Enter" && !(e.target instanceof Element && e.target.closest("#tour button"))) { e.preventDefault(); step(1); }
    e.stopPropagation();
  }, true);

  Object.assign(P, { tour: { start, stop, get open() { return !root.hidden; } } });
})();
