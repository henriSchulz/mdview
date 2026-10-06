/* mdview — the welcome page: how it moves. The windows on it are the app itself, each with sample
 * notes of its own (public/host/demo.js: window.MdDemo); the scroll is what writes into them. The
 * pinning, the rail and what fades in are the engine's (scrollcraft.js); what is here is the page's
 * own: the note typed as far as the page is scrolled and untyped on the way back, the note shared
 * and then shown as it is written, and the status bar that says what the app is doing. */
"use strict";
(() => {
  const W = window.MdWelcome, NOTE = "Welcome.md";
  const $ = (sel, root = document) => root.querySelector(sel);
  const clamp = (x) => Math.max(0, Math.min(1, x));
  if (window.ScrollCraft) window.ScrollCraft.mount(document.body);

  // ------------------------------------------------------------ the windows: the app, when it is near
  const frames = {}, ready = {};
  for (const f of document.querySelectorAll(".win__app")) frames[f.dataset.view] = f;
  const demo = (view) => { try { return ready[view] ? frames[view].contentWindow.MdDemo : null; } catch { return null; } };
  for (const view of ["write", "share"]) frames[view].closest(".win").classList.add("win--still"); // (the scroll drives these: the wheel stays the page's)
  frames.try.tabIndex = 0;
  const near = new IntersectionObserver((seen) => {
    for (const e of seen) if (e.isIntersecting && !e.target.src) { e.target.src = e.target.dataset.src; near.unobserve(e.target); }
  }, { rootMargin: "150% 0px" });
  for (const f of Object.values(frames)) near.observe(f);
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data || e.data.mdviewDemo !== "ready" || !frames[e.data.id]) return;
    ready[e.data.id] = true;
    frames[e.data.id].closest(".win").dataset.ready = "";
    told.write = told.share = null;
    update();
  });

  // ------------------------------------------------------------ where the page is
  const acts = ["write", "files", "share", "places", "try"].map((id) => ({ id, el: document.getElementById(id), link: $(`.status [data-act='${id}']`) }));
  const progress = (el) => { const r = el.getBoundingClientRect(), room = r.height - window.innerHeight; return room > 1 ? clamp(-r.top / room) : r.top <= 0 ? 1 : 0; };
  const line = $(".status__line");
  let said = "";
  const say = (text) => { if (text !== said) line.textContent = said = text; };

  // ------------------------------------------------------------ write: as far as the page is scrolled
  const src = $(".src"), typed = $(".src__typed"), sheet = $(".src__text"), body = $(".src__body");
  const told = { write: null, share: null };
  let count = -1, calm = 0;
  function bottom(frame) { // (what was typed last is what is looked at)
    try {
      const d = frame.contentDocument, c = d.getElementById("content");
      for (const el of [c, c && c.parentElement, d.scrollingElement]) if (el && el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight;
    } catch { /* (not there yet) */ }
  }
  function write(p) {
    const n = W.opening.length + Math.round(clamp((p - 0.02) / 0.8) * (W.text.length - W.opening.length)), now = W.text.slice(0, n);
    if (n !== count) {
      count = n;
      typed.textContent = now;
      sheet.style.transform = `translate3d(0,${-Math.max(0, sheet.offsetHeight - body.clientHeight)}px,0)`;
      src.dataset.typing = "";
      clearTimeout(calm);
      calm = setTimeout(() => delete src.dataset.typing, 500);
    }
    const d = demo("write");
    if (d && told.write !== now && d.onScreen === NOTE) { told.write = now; d.type(NOTE, now); requestAnimationFrame(() => bottom(frames.write)); }
    const lines = now.split("\n");
    return `${NOTE}   Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}   ${n} characters`;
  }

  // ------------------------------------------------------------ share: a link, and then the note as it is written
  const raw = $(".raw"), rawText = $(".raw__text");
  let rawBytes = 0, asked = false;
  function askRaw() {
    if (asked) return;
    asked = true;
    fetch(W.raw).then((r) => r.text()).then((t) => { rawText.textContent = t; rawBytes = new TextEncoder().encode(t).length; }).catch(() => { asked = false; });
  }
  function share(p) {
    const d = demo("share"), state = p < 0.08 ? "own" : p < 0.46 ? "link" : "after";
    const wipe = clamp((p - 0.52) / 0.34);
    raw.style.setProperty("--wipe", wipe.toFixed(4));
    raw.inert = wipe < 0.5;
    if (d && told.share !== state) {
      told.share = state;
      d.shared(state !== "own");
      d.shareWindow(state === "link");
    }
    if (wipe > 0.5) return `GET /welcome/note/raw   200   ${rawBytes ? rawBytes + " bytes" : "text/markdown"}`;
    return state === "own" ? `${NOTE}   not shared` : `${NOTE}   shared, read only   ${location.host}/welcome/note`;
  }

  // ------------------------------------------------------------ every frame the page moved in
  let due = false;
  function update() {
    due = false;
    const mid = window.innerHeight / 2;
    let at = acts[0];
    for (const a of acts) { const r = a.el.getBoundingClientRect(); if (r.top <= mid) at = a; }
    for (const a of acts) { if (a === at) a.link.setAttribute("aria-current", "true"); else a.link.removeAttribute("aria-current"); }
    const wrote = write(progress(acts[0].el));
    if (acts[2].el.getBoundingClientRect().top < window.innerHeight * 2) askRaw();
    const sharing = share(progress(acts[2].el));
    say(at.id === "write" ? wrote : at.id === "share" ? sharing : at.id === "files" ? "Markdown   Git   your repository"
      : at.id === "places" ? "5 places   1 set of notes" : "Try it.md   kept in this tab only");
  }
  const ask = () => { if (!due) { due = true; requestAnimationFrame(update); } };
  window.addEventListener("scroll", ask, { passive: true });
  window.addEventListener("resize", ask);
  update();
})();
