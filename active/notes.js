/* mdview active mode — footnotes. A reference is an atom in the text; the
 * notes themselves show in the section at the end, as in the reading view,
 * and are written where their definitions stand in the file (hidden blocks).
 * A note is edited in a dialog: from its place in the section or from one of
 * its references. After every change to a reference or a definition the
 * numbers and the section are drawn again.
 */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const { Plugin, PluginKey, TextSelection } = PM.state;
  const N = A.schema.nodes;
  const { hydrate } = window.MdView.core;

  // ------------------------------------------------------------ definitions in a hidden block's Markdown
  const START = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/, OTHER = /^ {0,3}\*?\[[^\]]+\]:/;
  /* -> [{ label, from, to (lines), text }]; text: what stands behind the colon, further lines without their indentation */
  function defsIn(raw) {
    const lines = raw.split("\n"), out = [];
    for (let i = 0; i < lines.length; i++) {
      const m = START.exec(lines[i]);
      if (!m) continue;
      let end = i + 1;
      while (end < lines.length && !OTHER.test(lines[end])) end++;
      while (end > i + 1 && !lines[end - 1].trim()) end--;
      out.push({ label: m[1], from: i, to: end, text: [m[2], ...lines.slice(i + 1, end).map((l) => l.replace(/^(?: {1,4}|\t)/, ""))].join("\n") });
      i = end - 1;
    }
    return out;
  }
  const written = (label, text) => text.replace(/\s+$/, "").split("\n").map((l, i) => (i === 0 ? `[^${label}]: ${l}`.replace(/ $/, text.trim() ? "" : " ") : l.trim() ? "    " + l : "")).join("\n");
  // a block's Markdown with one definition changed (text) or taken out (null)
  function withDef(raw, def, text) {
    const lines = raw.split("\n");
    lines.splice(def.from, def.to - def.from, ...(text == null ? [] : written(def.label, text).split("\n")));
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  }
  // where a note is defined: { pos, node, def }
  function find(doc, label) {
    let found = null;
    doc.forEach((node, pos) => {
      if (found || node.type !== N.hidden) return;
      const def = defsIn(node.attrs.raw).find((d) => d.label === label);
      if (def) found = { pos, node, def };
    });
    return found;
  }
  const labelOf = (atom) => atom.attrs.raw.slice(2, -1);
  const numberOf = (atom) => (/href="#fn(\d+)"/.exec(atom.attrs.html) || [])[1] || null;
  const isRef = (node) => node.type === N.iatom && node.attrs.kind === "footnote";
  const virtualAt = (doc) => { let at = null; doc.forEach((n, pos) => { if (n.type === N.island && n.attrs.virtual) at = pos; }); return at; };
  function labels(doc) {
    const out = new Set();
    doc.forEach((node) => { if (node.type === N.hidden) defsIn(node.attrs.raw).forEach((d) => out.add(d.label)); });
    return out;
  }

  // ------------------------------------------------------------ numbers and section, drawn again
  let seen = 0;
  const key = new PluginKey("notes");
  function refresh(view) {
    const d = A.edit.docOf(view.state), p = A.view.payload;
    if (!d || !p) return;
    const text = A.document.serialize(d, view.state.doc, false);
    const now = A.document.open({ text, raw: text, links: p.links, vault: p.vault });
    d.store.env.footnotes = now.store.env.footnotes;
    const tr = view.state.tr;
    // the references' numbers
    const have = [], want = [];
    view.state.doc.descendants((n, pos) => { if (isRef(n)) have.push([n, pos]); return !n.isAtom; });
    now.doc.descendants((n) => { if (isRef(n)) want.push(n); return !n.isAtom; });
    if (have.length === want.length) {
      have.forEach(([n, pos], i) => {
        if (n.attrs.raw === want[i].attrs.raw && n.attrs.html !== want[i].attrs.html) tr.setNodeMarkup(pos, null, { ...n.attrs, html: want[i].attrs.html }, n.marks);
      });
    }
    // the section
    const at = virtualAt(view.state.doc), section = now.doc.lastChild.type === N.island && now.doc.lastChild.attrs.virtual ? now.doc.lastChild : null;
    if (at != null && !section) tr.delete(at, at + view.state.doc.nodeAt(at).nodeSize);
    else if (at == null && section) tr.insert(tr.doc.content.size, section);
    else if (section && view.state.doc.nodeAt(at).attrs.html !== section.attrs.html) tr.setNodeMarkup(at, null, section.attrs);
    if (!tr.docChanged) return;
    view.dispatch(tr.setMeta("addToHistory", false).setMeta(key, "drawn").setMeta("allowLoss", true));
    hydrate(view.dom.querySelector(".footnotes") || view.dom);
  }
  const touches = (node) => node.type === N.hidden || isRef(node);
  function touched(tr) {
    return tr.steps.some((step, i) => {
      let hit = false;
      if (step.slice) step.slice.content.descendants((n) => { if (touches(n)) hit = true; return !hit; });
      if (!hit && step.from != null && step.to > step.from) tr.docs[i].nodesBetween(step.from, Math.min(step.to, tr.docs[i].content.size), (n) => { if (touches(n)) hit = true; return !hit; });
      return hit;
    });
  }

  // ------------------------------------------------------------ editing a note
  /* The dialog for the note `label`. opts.fresh: reference and definition were just made;
   * left empty, both go again. */
  function edit(view, label, opts = {}) {
    const f = find(view.state.doc, label);
    if (!f || !view.editable || A.dialog.open) return false;
    const { el } = A.dialog, kit = A.islands.kit;
    const anchor = () => {
      const i = ((A.edit.storeOf(view.state).env.footnotes || {}).list || []).findIndex((x) => x.label === label);
      return view.dom.querySelector(`.footnotes li[id="fn${i + 1}"]`) || view.dom.querySelector(".footnotes") || view.dom;
    };
    const drop = () => { // the reference just typed and its empty definition
      const tr = view.state.tr, now = find(view.state.doc, label);
      const refs = [];
      view.state.doc.descendants((n, pos) => { if (isRef(n) && labelOf(n) === label) refs.push(pos); return !n.isAtom; });
      refs.reverse().forEach((pos) => tr.delete(pos, pos + 1));
      if (now) {
        const raw = withDef(now.node.attrs.raw, now.def, null), pos = tr.mapping.map(now.pos);
        if (raw) tr.setNodeMarkup(pos, null, { ...now.node.attrs, raw }); else tr.delete(pos, pos + now.node.nodeSize);
      }
      view.dispatch(tr.setMeta("allowLoss", true));
    };
    let ed;
    A.dialog.show({
      title: T("dialog.footnote", label),
      anchor,
      key: "note:" + label,
      build(body, _tools, info) {
        ed = A.dialog.editor({ value: f.def.text, language: "markdown", label: T("dialog.footnote", label) });
        const preview = el("div", { class: "dlg-preview doc" });
        body.append(ed.el, preview);
        ed.onInput = kit.infoBar(info, ed);
        kit.follow(ed, (v) => { preview.innerHTML = kit.html(v); hydrate(preview); });
        return { text: () => ed.value, setText: (v) => { ed.value = v; ed.input.dispatchEvent(new Event("input")); }, focus: () => ed.focus(), result: () => (ed.value === f.def.text && !opts.fresh ? undefined : ed.value) };
      },
      done(text) {
        if (opts.fresh && !text.trim()) return drop();
        const now = find(view.state.doc, label);
        if (!now || text === now.def.text) return;
        view.dispatch(view.state.tr.setNodeMarkup(now.pos, null, { ...now.node.attrs, raw: withDef(now.node.attrs.raw, now.def, text) }).setMeta("step", true));
      },
      cancel() { if (opts.fresh && !ed.value.trim()) drop(); },
    });
    return true;
  }

  // ------------------------------------------------------------ a new reference
  /* [^label] in place of from..to. A label without a definition gets one at the end. -> { tr, made } */
  function addRef(state, from, to, label) {
    const raw = `[^${label}]`, tr = state.tr;
    const made = !labels(state.doc).has(label);
    tr.replaceWith(from, to, N.iatom.create({ kind: "footnote", raw, html: `<sup class="footnote-ref"><a href="#fn0">[…]</a></sup>` }, null, state.doc.resolve(from).marks()));
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(to)));
    if (made) {
      const at = virtualAt(tr.doc);
      tr.insert(at == null ? tr.doc.content.size : at, N.hidden.create({ raw: `[^${label}]: ` }));
    }
    return { tr, made };
  }
  // typed: [^label]
  const rule = new PM.inputrules.InputRule(/\[\^([^\]\s]+)\]$/, (state, match, start, end) => {
    if (state.doc.resolve(start).parent.type.spec.code || A.schema.marks.code.isInSet(state.doc.resolve(start).marks())) return null;
    const { tr, made } = addRef(state, start, end, match[1]);
    if (made) setTimeout(() => A.view.pm && edit(A.view.pm, match[1], { fresh: true }), 0);
    return tr;
  });
  // a new note at the caret: the next free number
  function insert(state, dispatch, view) {
    if (!state.selection.$from.parent.inlineContent) return false;
    if (!dispatch) return true;
    let n = 1;
    const used = labels(state.doc);
    while (used.has(String(n))) n++;
    const { tr } = addRef(state, state.selection.from, state.selection.to, String(n));
    dispatch(tr.scrollIntoView());
    if (view) setTimeout(() => edit(view, String(n), { fresh: true }), 0);
    return true;
  }

  // ------------------------------------------------------------ pointing at a reference, clicking it
  const pop = document.createElement("div");
  pop.id = "notepop";
  pop.className = "ui-menu surface doc";
  pop.setAttribute("role", "tooltip");
  document.body.appendChild(pop);
  let timer = 0, shownFor = null;
  const itemOf = (view, sup) => { const m = /#fn(\d+)$/.exec(sup.querySelector("a")?.getAttribute("href") || ""); return m ? view.dom.querySelector(`.footnotes li[id="fn${m[1]}"]`) : null; };
  function showPop(view, sup) {
    const li = itemOf(view, sup);
    if (!li) return;
    const copy = li.cloneNode(true);
    copy.querySelectorAll(".footnote-backref").forEach((a) => a.remove());
    copy.querySelectorAll("[id]").forEach((x) => x.removeAttribute("id"));
    pop.textContent = "";
    pop.append(...copy.childNodes);
    if (!pop.textContent.trim() && !pop.querySelector("img, svg")) return;
    const r = sup.getBoundingClientRect();
    pop.style.left = "0px";
    pop.style.top = "0px";
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const below = r.bottom + 6 + h <= innerHeight - 8;
    pop.style.setProperty("--origin", below ? "top left" : "bottom left");
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + scrollX + "px";
    pop.style.top = (below ? r.bottom + 6 : r.top - 6 - h) + scrollY + "px";
    pop.dataset.open = "";
    shownFor = sup;
  }
  function hidePop() {
    clearTimeout(timer);
    shownFor = null;
    delete pop.dataset.open;
  }
  // to the note in the section, which lights up for a moment
  function jump(view, sup) {
    const li = itemOf(view, sup);
    if (!li) return false;
    hidePop();
    li.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    li.classList.add("note-hit");
    setTimeout(() => li.classList.remove("note-hit"), 1000);
    return true;
  }
  // a click in the section: on a note, its dialog
  function clicked(view, event) {
    const li = event.target.closest?.("li.footnote-item");
    const m = li && /^fn(\d+)$/.exec(li.id);
    const entry = m && ((A.edit.storeOf(view.state).env.footnotes || {}).list || [])[m[1] - 1];
    return entry ? edit(view, entry.label) : false;
  }

  const plugin = new Plugin({
    key,
    state: { init: () => 0, apply: (tr, rev) => (tr.docChanged && tr.getMeta(key) !== "drawn" && touched(tr) ? rev + 1 : rev) },
    view: () => ({
      update(view) {
        const rev = key.getState(view.state);
        if (rev === seen) return;
        seen = rev;
        setTimeout(() => { if (view.dom.isConnected) refresh(view); }, 0);
      },
      destroy: hidePop,
    }),
    props: {
      handleClickOn(view, _pos, node, nodePos, event, direct) {
        if (!direct || event.button !== 0 || !isRef(node)) return false;
        const sup = view.nodeDOM(nodePos)?.querySelector?.("sup.footnote-ref");
        return sup ? jump(view, sup) : false;
      },
      handleDOMEvents: {
        mouseover(view, e) {
          const sup = e.target.closest?.("sup.footnote-ref");
          if (sup === shownFor) return false;
          hidePop();
          if (sup && sup.closest(".pm") === view.dom && !sup.closest(".isl")) timer = setTimeout(() => showPop(view, sup), 400);
          return false;
        },
        mouseleave() { hidePop(); return false; },
        keydown() { hidePop(); return false; },
      },
    },
  });
  window.addEventListener("scroll", hidePop, { passive: true });

  A.notes = { plugin, rule, edit, insert, clicked, refresh, find, defsIn, withDef, labelOf, numberOf };
})();
