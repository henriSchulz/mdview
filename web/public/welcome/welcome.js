/* mdview — the welcome page: how it moves. The windows on it are the app itself, each with sample
 * notes of its own (public/host/demo.js: window.MdDemo). The page scrolls as any page does —
 * nothing here follows the scroll. What moves, moves by itself or on a click: the claim comes in
 * when the page opens; the note is typed, once, when its window is looked at (and again on
 * request); the notes that show what a note can hold are chosen by their names, and go round by
 * themselves until one is chosen. The status bar says where the page is and what the app is doing. */
"use strict";
(() => {
  const W = window.MdWelcome, NOTE = "Welcome.md";
  const $ = (sel, root = document) => root.querySelector(sel);
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("w-js"); // (from here on: what comes in, comes in)

  // ------------------------------------------------------------ the windows: the app, when it is near
  const frames = {}, ready = {};
  for (const f of document.querySelectorAll(".win__app")) frames[f.dataset.view] = f;
  const demo = (view) => { try { return ready[view] ? frames[view].contentWindow.MdDemo : null; } catch { return null; } };
  for (const view of ["write", "tour"]) frames[view].closest(".win").classList.add("win--still"); // (shown, not used: the wheel stays the page's)
  frames.try.tabIndex = 0;
  const near = new IntersectionObserver((seen) => {
    for (const e of seen) if (e.isIntersecting && !e.target.src) { e.target.src = e.target.dataset.src; near.unobserve(e.target); }
  }, { rootMargin: "150% 0px" });
  for (const f of Object.values(frames)) near.observe(f);
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data || e.data.mdviewDemo !== "ready" || !frames[e.data.id]) return;
    ready[e.data.id] = true;
    frames[e.data.id].closest(".win").dataset.ready = "";
    if (e.data.id === "write") shown = null, show();
    if (e.data.id === "tour") told = -1, tell();
  });

  // ------------------------------------------------------------ the status bar
  const acts = ["hero", "write", "files", "blocks", "open", "try"].map((id) => ({ id, el: document.getElementById(id), link: $(`.status [data-act='${id}']`) }));
  const line = $(".status__line");
  const says = { hero: "Markdown   Git   your repository", write: "", files: "Markdown   Git   your repository", blocks: "", open: "MIT licence   github.com/henriSchulz/mdview", try: "Try it.md   kept in this tab only" };
  let at = "hero", said = "";
  const say = () => { const text = says[at] || ""; if (text !== said) line.textContent = said = text; };
  // (which part of the page is in the middle of the window: seen, not measured while scrolling)
  const where = new IntersectionObserver((seen) => {
    for (const e of seen) if (e.isIntersecting) at = e.target.id;
    for (const a of acts) { if (a.id === at) a.link.setAttribute("aria-current", "true"); else a.link.removeAttribute("aria-current"); }
    say();
  }, { rootMargin: "-50% 0px -50% 0px" });
  for (const a of acts) where.observe(a.el);

  // ------------------------------------------------------------ write: the note, typed while one looks
  const src = $(".src"), typed = $(".src__typed"), sheet = $(".src__text"), body = $(".src__body"), again = $(".src__again");
  const PER_SECOND = 46; // characters
  let count = W.opening.length, shown = null, typing = 0, began = 0, calm = 0, played = false;
  function bottom(frame) { // (what was typed last is what is looked at)
    try {
      const d = frame.contentDocument, c = d.getElementById("content");
      for (const el of [c, c && c.parentElement, d.scrollingElement]) if (el && el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight;
    } catch { /* (not there yet) */ }
  }
  function show() {
    const now = W.text.slice(0, count);
    typed.textContent = now;
    sheet.style.transform = `translate3d(0,${-Math.max(0, sheet.offsetHeight - body.clientHeight)}px,0)`;
    const d = demo("write");
    if (d && shown !== now && d.onScreen === NOTE) { shown = now; d.type(NOTE, now); requestAnimationFrame(() => bottom(frames.write)); }
    const lines = now.split("\n");
    says.write = `${NOTE}   Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}   ${count} characters`;
    say();
  }
  function type(t) {
    const to = Math.min(W.text.length, W.opening.length + Math.floor(((t - began) / 1000) * PER_SECOND));
    if (to !== count) {
      count = to;
      show();
      src.dataset.typing = "";
      clearTimeout(calm);
      calm = setTimeout(() => delete src.dataset.typing, 500);
    }
    if (count < W.text.length) typing = requestAnimationFrame(type); else { typing = 0; again.hidden = false; }
  }
  function play() {
    cancelAnimationFrame(typing);
    played = true;
    again.hidden = true;
    if (still) { count = W.text.length; show(); again.hidden = true; return; } // (less motion: the note as it is, at once)
    count = W.opening.length;
    show();
    began = performance.now() + 500;
    typing = requestAnimationFrame(type);
  }
  again.addEventListener("click", play);
  // (once, when most of its window is in sight)
  const looked = new IntersectionObserver((seen) => { if (!played && seen.some((e) => e.isIntersecting)) { looked.disconnect(); play(); } }, { threshold: 0.45 });
  looked.observe($(".write__win"));
  // "See what it does": down to it — and it plays, also when it has before
  $(".hero__cue").addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("write").scrollIntoView({ behavior: still ? "instant" : "smooth", block: "start" });
    setTimeout(play, still ? 0 : 500);
  });

  // ------------------------------------------------------------ blocks: one kind of note, chosen by its name
  const scene = $(".tour"), tourWin = $(".tour__win"), names = [...document.querySelectorAll(".tour__names button")], texts = [...document.querySelectorAll(".tour__texts p")];
  const glyphs = [...document.querySelectorAll(".tour__glyphs span")], srcs = [...document.querySelectorAll(".tour__srcs pre")];
  const only = (list, i, attr) => list.forEach((el, k) => { if (k === i) el.setAttribute(attr, attr === "aria-current" ? "true" : ""); else el.removeAttribute(attr); });
  const ROUND = 5200; // ms a kind stays, while they go round by themselves
  let step = -1, told = -1, round = 0, chosen = false, inSight = false;
  function tell() {
    const d = demo("tour"), note = names[step].dataset.note;
    if (d && told !== step) { told = step; d.open(note); d.shared(note === NOTE); }
  }
  function go(i) {
    const first = step < 0;
    step = (i + names.length) % names.length;
    const note = names[step].dataset.note;
    only(names, step, "aria-current"); only(texts, step, "data-on"); only(glyphs, step, "data-on"); only(srcs, step, "data-on");
    scene.style.setProperty("--hue", glyphs[step].dataset.hue);
    scene.style.setProperty("--mark", names[step].parentNode.offsetTop + "px");
    scene.style.setProperty("--tp", (names.length > 1 ? step / (names.length - 1) : 0.5).toFixed(3));
    if (!first && !still) { // (the window answers the change: pushed in, and out again on its spring)
      tourWin.style.transitionDuration = "0s"; scene.style.setProperty("--push", "0.965");
      requestAnimationFrame(() => requestAnimationFrame(() => { tourWin.style.transitionDuration = ""; scene.style.setProperty("--push", "1"); }));
    }
    tell();
    says.blocks = note === NOTE ? `${NOTE}   shared, read only   ${location.host}/k` : `${note}   ${step + 1} of ${names.length}`;
    say();
  }
  const turn = () => { clearInterval(round); round = !chosen && inSight && !still ? setInterval(() => go(step + 1), ROUND) : 0; };
  names.forEach((b, i) => b.addEventListener("click", () => { chosen = true; turn(); go(i); }));
  $(".tour__names").addEventListener("keydown", (e) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    chosen = true; turn();
    go(step + d);
    names[step].focus();
  });
  new IntersectionObserver((seen) => { inSight = seen.some((e) => e.isIntersecting); turn(); }, { threshold: 0.35 }).observe(scene);
  scene.addEventListener("pointerenter", () => { clearInterval(round); round = 0; });
  scene.addEventListener("pointerleave", turn);
  window.addEventListener("resize", () => { if (step >= 0) scene.style.setProperty("--mark", names[step].parentNode.offsetTop + "px"); });
  go(0);

  // ------------------------------------------------------------ the light and the pieces of Markdown lean a little towards the pointer
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches && !still) {
    const leaning = [$("#hero"), $(".write"), scene];
    let mx = 0, my = 0, tx = 0, ty = 0, going = false;
    const lean = () => {
      mx += (tx - mx) * 0.08; my += (ty - my) * 0.08;
      for (const el of leaning) { el.style.setProperty("--mx", mx.toFixed(4)); el.style.setProperty("--my", my.toFixed(4)); }
      if (Math.abs(tx - mx) + Math.abs(ty - my) > 0.002) requestAnimationFrame(lean); else going = false;
    };
    window.addEventListener("pointermove", (e) => { tx = e.clientX / window.innerWidth - 0.5; ty = e.clientY / window.innerHeight - 0.5; if (!going) { going = true; requestAnimationFrame(lean); } }, { passive: true });
  }
  show();
})();
