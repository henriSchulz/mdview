/* mdview — the conflicts' window: a linked project and its other side both changed the same
 * place of a file, and it is the user's to say how it is to be. The files at the left; at the
 * right the chosen one — a note place by place (mine, theirs, or both), another file as a whole.
 * When every place is said, Join makes one commit of the two and it goes over.
 *
 * The application works the conflicts out ("sync-conflicts" → A.conflict.got) and joins with what
 * is picked ("sync-resolve"); nothing in the folder changes before that. The window's frame and
 * the marking of words are the history's (history.js). */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const esc = window.MdView.core.esc;
  const post = (type, data = {}) => window.MdHost?.post(JSON.stringify({ type, ...data }));
  const { el, lines, when } = A.history;
  const CONTEXT = 2; // lines both sides agree on, shown around a place
  const name = (d) => String(d || "").replace(/ \([0-9a-f-]{36}\)$/, "");

  let win = null, join = null, data = null, chosen = -1, picks = [], sent = false;
  const isOpen = () => !!win && win.isOpen();

  // ------------------------------------------------------------ what is picked
  /* picks[file]: for a note one of "mine" | "theirs" | "both" | null per place; for another file one of them or null. */
  const places = (f) => (f.parts || []).filter((p) => p.same == null);
  const said = (i) => (data.files[i].kind === "text" ? picks[i].every((p) => p) : !!picks[i]);
  const allSaid = () => data.files.every((_, i) => said(i));
  function result() {
    const out = {};
    data.files.forEach((f, i) => {
      if (f.kind !== "text") { out[f.path] = { take: picks[i] }; return; }
      let n = 0, text = "";
      for (const p of f.parts) text += p.same != null ? p.same : { mine: p.mine, theirs: p.theirs, both: p.mine + p.theirs }[picks[i][n++]];
      out[f.path] = { text };
    });
    return out;
  }

  // ------------------------------------------------------------ drawing
  const row = (text, cls = "") => { const l = el("div", { class: "hi-line" + cls }); const t = el("span", { class: "hi-text" }); t.innerHTML = text || " "; l.append(el("span", { class: "hi-sign", "aria-hidden": "true" }), t); return l; };
  /* The words of one side that the other has not, marked. */
  function marked(mine, theirs) {
    let a = "", b = "";
    for (const w of Diff.diffWordsWithSpace(mine, theirs)) {
      if (!w.added) a += w.removed ? `<mark>${esc(w.value)}</mark>` : esc(w.value);
      if (!w.removed) b += w.added ? `<mark>${esc(w.value)}</mark>` : esc(w.value);
    }
    const split = (html) => { let on = false; return lines(html).map((l) => { const s = (on ? "<mark>" : "") + l; on = s.lastIndexOf("<mark>") > s.lastIndexOf("</mark>"); return on ? s + "</mark>" : s; }); };
    return [split(a), split(b)];
  }
  function picker(now, both, set) {
    const box = el("div", { class: "cf-picks", role: "group" });
    for (const [v, l] of [["mine", "conflict.mine"], ["theirs", "conflict.theirs"], ...(both ? [["both", "conflict.both"]] : [])]) {
      const b = el("button", { class: "pf-link cf-pick", type: "button", "aria-pressed": String(now === v), "data-pick": v }, T(l));
      b.onclick = () => set(v);
      box.appendChild(b);
    }
    return box;
  }
  function side(cls, who, off, content) {
    const s = el("div", { class: "cf-side " + cls + (off ? " off" : "") });
    s.append(el("div", { class: "cf-who" }, who), content);
    return s;
  }
  const whoMine = () => T("conflict.here", when(data.mine.time));
  const whoTheirs = () => T("conflict.there", name(data.their.device), when(data.their.time));
  function draw() {
    const f = data.files[chosen], body = win.body;
    body.textContent = "";
    if (!f) return;
    if (f.kind !== "text") {
      const card = el("div", { class: "cf-place" });
      const set = (v) => { picks[chosen] = v; changed(); };
      const says = (there) => el("p", { class: "cf-whole" }, T(there ? "conflict.changed" : "conflict.deleted"));
      card.append(el("div", { class: "cf-head" }), side("mine", whoMine(), picks[chosen] === "theirs", says(f.mine)), side("theirs", whoTheirs(), picks[chosen] === "mine", says(f.theirs)));
      card.firstChild.append(el("span", { class: "cf-count" }, T("conflict.whole")), picker(picks[chosen], f.mine && f.theirs, set));
      body.appendChild(card);
      return;
    }
    const total = places(f).length;
    let n = 0;
    const box = el("div", { class: "hi-diff cf-file" });
    f.parts.forEach((p, at) => {
      if (p.same != null) { // what both agree on: the lines next to a place, the rest counted
        const all = lines(p.same), first = at === 0, last = at === f.parts.length - 1;
        const head = first ? 0 : CONTEXT, tail = last ? 0 : CONTEXT;
        if (all.length <= head + tail + 1) { for (const l of all) box.appendChild(row(esc(l))); return; }
        for (const l of all.slice(0, head)) box.appendChild(row(esc(l)));
        const skipped = all.length - head - tail;
        box.appendChild(el("div", { class: "hi-gap" }, T(skipped === 1 ? "history.unchanged.one" : "history.unchanged", skipped)));
        for (const l of all.slice(all.length - tail)) box.appendChild(row(esc(l)));
        return;
      }
      const i = n++, now = picks[chosen][i];
      const [mine, theirs] = marked(p.mine, p.theirs);
      const block = (ls) => { const b = el("div", { class: "cf-lines" }); for (const l of ls.length ? ls : [`<i>${esc(T("conflict.nothing"))}</i>`]) b.appendChild(row(l)); return b; };
      const card = el("div", { class: "cf-place", "data-place": String(i) });
      const head = el("div", { class: "cf-head" });
      head.append(el("span", { class: "cf-count" }, T("conflict.place", i + 1, total)), picker(now, true, (v) => { picks[chosen][i] = v; changed(); }));
      card.append(head, side("mine", whoMine(), now === "theirs", block(mine)), side("theirs", whoTheirs(), now === "mine", block(theirs)));
      box.appendChild(card);
    });
    body.appendChild(box);
  }
  function listRows() {
    [...win.list.children].forEach((r, i) => {
      if (i === chosen) r.setAttribute("aria-current", "true"); else r.removeAttribute("aria-current");
      const f = data.files[i], left = f.kind === "text" ? picks[i].filter((p) => !p).length : picks[i] ? 0 : 1;
      r.querySelector(".hi-by").textContent = left ? T(left === 1 ? "conflict.left.one" : "conflict.left", left) : T("conflict.done");
      r.classList.toggle("cf-done", !left);
    });
    join.disabled = sent || !allSaid();
  }
  function changed() { const top = win.body.scrollTop; draw(); win.body.scrollTop = top; listRows(); }
  function choose(i) {
    if (!data || i < 0 || i >= data.files.length) return;
    chosen = i;
    win.title.textContent = data.files[i].path;
    draw();
    win.body.scrollTop = 0;
    listRows();
  }

  // ------------------------------------------------------------ the window
  function build() {
    win = A.history.frame("conflict", { name: T("conflict.title"), listLabel: T("conflict.files"), choose, chosen: () => chosen });
    join = el("button", { class: "pf-link cf-join", type: "button" }, T("conflict.join"));
    join.onclick = () => { if (!data || !allSaid()) return; sent = true; join.disabled = true; post("sync-resolve", { theirs: data.theirs, picks: result() }); };
    win.tools.appendChild(join);
  }
  function open() {
    if (A.dialog.open || isOpen() || (A.prefs && A.prefs.isOpen) || A.history.isOpen) return false;
    if (!win) build();
    window.MdView.flush(false); // (what is typed is saved, and kept, before anything is joined)
    data = null; chosen = -1; picks = []; sent = false;
    win.note.textContent = ""; win.list.textContent = ""; win.body.textContent = ""; win.title.textContent = T("conflict.title");
    join.disabled = true;
    post("sync-conflicts");
    win.show();
    return true;
  }
  const close = () => !!win && win.hide();
  function got(d) {
    if (!isOpen()) return;
    // (asked again after the other side moved: what was picked for a file that is as it was stays)
    const before = data ? new Map(data.files.map((f, i) => [f.path + "\n" + JSON.stringify(f.parts || [f.mine, f.theirs]), picks[i]])) : new Map();
    data = d; sent = false;
    picks = d.files.map((f) => before.get(f.path + "\n" + JSON.stringify(f.parts || [f.mine, f.theirs])) ?? (f.kind === "text" ? places(f).map(() => null) : null));
    win.note.textContent = T("conflict.with", name(d.their.device));
    win.list.textContent = "";
    for (const f of d.files) {
      const r = el("button", { class: "st-nav hi-row", type: "button" });
      const text = el("span", { class: "hi-row-text" });
      text.append(el("span", { class: "hi-when" }, f.path.split("/").pop()), el("span", { class: "hi-by" }));
      r.appendChild(text);
      if (f.path.includes("/")) r.title = f.path;
      win.list.appendChild(r);
    }
    if (!d.files.length) { close(); return; }
    choose(Math.max(0, Math.min(chosen, d.files.length - 1)));
  }
  /* The joining did not go (said by the application's toast): what there is to say is asked for anew. */
  function failed() { if (isOpen()) { sent = false; post("sync-conflicts"); } }
  /* The project stands otherwise now (the application says so with the folder): joined — the window goes. */
  function standing(sync) { if (isOpen() && (!sync || sync.state !== "conflict")) { close(); if (sent) window.MdView.toast(T("conflict.joined")); } }

  A.conflict = { open, close, got, failed, standing, get isOpen() { return isOpen(); } };
})();
