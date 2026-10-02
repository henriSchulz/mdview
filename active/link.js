/* mdview active mode — links: the small popover under a link the caret is
 * in (address, open, edit, remove) and the form to make or change one
 * (Ctrl+K). Looks and moves like the page's other popovers (.ui-popover). */
"use strict";
(() => {
  const A = window.MdActive;
  const { isExternal, esc, follow } = window.MdView.core;
  const T = window.MdStrings.t;
  const { Plugin, PluginKey, TextSelection } = PM.state;
  const M = A.schema.marks, N = A.schema.nodes;
  const REST_MS = 400; // the caret rests in a link this long before the popover shows

  const pop = document.createElement("div");
  pop.id = "linkpop";
  pop.className = "ui-menu ui-popover surface";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", T("link.label"));
  document.body.appendChild(pop);
  let shown = null; // { kind: "info" | "form", from, to, mark } while the popover is open
  let timer = 0;

  /* The link around a position: { from, to, mark } or null. */
  function linkAt(state, pos = state.selection.from) {
    const $pos = state.doc.resolve(pos);
    if (!$pos.parent.isTextblock) return null;
    const pick = (n) => (n && n.isText ? n.marks.find((m) => m.type === M.link) : null);
    const mark = pick($pos.nodeAfter) && pick($pos.nodeBefore) ? pick($pos.nodeAfter) : pick($pos.nodeBefore) || pick($pos.nodeAfter);
    if (!mark) return null;
    // the whole run of text that carries this mark
    const start = $pos.start();
    let run = null, hit = null;
    $pos.parent.forEach((child, offset) => {
      const a = start + offset, b = a + child.nodeSize;
      if (!(child.isText && mark.isInSet(child.marks))) { run = null; return; }
      if (run && run.to === a) run.to = b; else run = { from: a, to: b };
      if (pos >= run.from && pos <= run.to) hit = run;
    });
    return hit ? { from: hit.from, to: hit.to, mark } : null;
  }

  function place(view, from, to) {
    const a = view.coordsAtPos(from), b = view.coordsAtPos(to, -1);
    pop.style.left = "0px";
    pop.style.top = "0px";
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(12, Math.min(a.left, innerWidth - w - 12));
    const below = Math.max(a.bottom, b.bottom) + 6, above = Math.min(a.top, b.top) - h - 6;
    const up = below + h > innerHeight - 12 && above > 12;
    pop.style.setProperty("--origin", up ? "bottom left" : "top left");
    pop.style.left = left + window.scrollX + "px";
    pop.style.top = (up ? above : below) + window.scrollY + "px";
  }
  function close() {
    clearTimeout(timer);
    if (!shown) return false;
    shown = null;
    delete pop.dataset.open;
    return true;
  }
  const short = (url) => (url.length > 54 ? url.slice(0, 34) + "…" + url.slice(-18) : url);

  function info(view, link) {
    shown = { kind: "info", ...link };
    pop.innerHTML =
      `<span class="lp-url" data-tip="${esc(link.mark.attrs.href)}">${esc(short(link.mark.attrs.href))}</span>` +
      `<button class="btn" type="button" data-do="open">${esc(T("link.open"))}</button>` +
      `<button class="btn" type="button" data-do="edit">${esc(T("link.edit"))}</button>` +
      `<button class="btn" type="button" data-do="remove">${esc(T("link.remove"))}</button>`;
    pop.dataset.kind = "info";
    place(view, link.from, link.to);
    pop.dataset.open = "";
  }

  /* The form: for the link the caret is in, or a new one over the selection. */
  function edit(view) {
    if (!view.editable) return false;
    const state = view.state, sel0 = state.selection;
    const link = linkAt(state, sel0.from);
    const from = link ? link.from : sel0.from, to = link ? link.to : sel0.to;
    if (!state.doc.resolve(from).parent.isTextblock || !state.doc.resolve(from).sameParent(state.doc.resolve(to))) return false;
    clearTimeout(timer);
    const text = state.doc.textBetween(from, to);
    shown = { kind: "form", from, to, mark: link ? link.mark : null, text };
    const sel = { anchor: sel0.anchor, head: sel0.head };
    pop.innerHTML =
      `<label class="lp-row"><span>${esc(T("link.text"))}</span><input class="lp-field" data-f="text" type="text" spellcheck="false" autocomplete="off"></label>` +
      `<label class="lp-row"><span>${esc(T("link.url"))}</span><input class="lp-field" data-f="url" type="text" spellcheck="false" autocomplete="off" placeholder="https://"></label>`;
    pop.dataset.kind = "form";
    const [textIn, urlIn] = pop.querySelectorAll("input");
    textIn.value = text;
    urlIn.value = link ? link.mark.attrs.href : /^https?:\/\/\S+$/.test(text) ? text : "";
    place(view, from, to);
    pop.dataset.open = "";
    (text && !urlIn.value ? urlIn : link ? urlIn : textIn).focus({ preventScroll: true });
    (document.activeElement).select?.();
    pop.onkeydown = (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") { e.preventDefault(); apply(view); }
      else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        // back to where the caret was (the browser puts it elsewhere when the focus returns)
        view.focus();
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, sel.anchor, sel.head)));
      }
    };
    return true;
  }
  // leaving the form with the mouse or Tab takes what was entered (nothing is lost by a stray click)
  pop.addEventListener("focusout", (e) => {
    if (shown && shown.kind === "form" && !pop.contains(e.relatedTarget) && A.view.pm) apply(A.view.pm, false);
  });

  function apply(view, refocus = true) {
    if (!shown || shown.kind !== "form") return;
    const { from, to, mark, text: oldText } = shown;
    const [textIn, urlIn] = pop.querySelectorAll("input");
    const url = urlIn.value.trim();
    let text = textIn.value.replace(/\s+/g, " ").trim();
    close();
    const state = view.state, tr = state.tr;
    if (!url) {
      if (mark) tr.removeMark(from, to, M.link);
    } else {
      if (!text) text = url;
      const plain = mark && (mark.attrs.markup === "autolink" || mark.attrs.markup === "linkify");
      // a bare or <bracketed> address is its own text; with another text it becomes an ordinary link
      const attrs = { href: url, title: mark ? mark.attrs.title : null, cls: isExternal(url) ? "external" : null,
        markup: plain && text === url ? mark.attrs.markup : "", ref: mark && !plain ? mark.attrs.ref : null };
      if (plain && textIn.value === oldText && url !== mark.attrs.href) text = url;
      if (attrs.ref && url !== mark.attrs.href && !redefine(tr, attrs.ref, mark.attrs.href, url)) attrs.ref = null;
      const marks = (state.doc.resolve(from).nodeAfter || { marks: [] }).marks.filter((m) => m.type !== M.link).concat(M.link.create(attrs));
      if (text !== oldText || !mark) tr.replaceWith(from, to, A.schema.text(text, marks));
      else tr.removeMark(from, to, M.link).addMark(from, to, M.link.create(attrs));
      tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(to)));
    }
    if (tr.steps.length) view.dispatch(tr.scrollIntoView());
    if (refocus) view.focus();
  }
  /* A reference link's address lives in its definition, `[label]: address`:
   * change it there, and in every link that uses it. -> false if not found. */
  function redefine(tr, label, oldHref, href) {
    let done = false;
    const re = new RegExp("^( {0,3}\\[" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\]:[ \\t]*)(<[^>\\n]*>|\\S+)", "im");
    tr.doc.forEach((node, pos) => {
      if (done || node.type !== N.hidden || !re.test(node.attrs.raw)) return;
      tr.setNodeMarkup(pos, null, { ...node.attrs, raw: node.attrs.raw.replace(re, (m, head) => head + (/[\s<>]/.test(href) ? "<" + href + ">" : href)) });
      done = true;
    });
    if (!done) return false;
    tr.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const m = node.marks.find((x) => x.type === M.link && x.attrs.ref === label && x.attrs.href === oldHref);
      if (m) tr.removeMark(pos, pos + node.nodeSize, m).addMark(pos, pos + node.nodeSize, M.link.create({ ...m.attrs, href, cls: isExternal(href) ? "external" : null }));
    });
    return true;
  }

  pop.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); }); // the editor keeps its selection
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-do]"), view = A.view.pm;
    if (!b || !shown || !view) return;
    const { from, to, mark } = shown;
    if (b.dataset.do === "open") follow(mark.attrs.href);
    else if (b.dataset.do === "edit") edit(view);
    else if (b.dataset.do === "remove") {
      close();
      view.dispatch(view.state.tr.removeMark(from, to, M.link));
      view.focus();
    }
  });

  const plugin = new Plugin({
    key: new PluginKey("link"),
    view: () => ({
      update(view) {
        if (shown && shown.kind === "form") return;
        const state = view.state;
        const link = view.editable && view.hasFocus() && state.selection.empty ? linkAt(state) : null;
        if (shown && link && link.from === shown.from && link.to === shown.to && link.mark.eq(shown.mark)) return;
        close();
        if (link) timer = setTimeout(() => { if (view.hasFocus() && !shown) info(view, link); }, REST_MS);
      },
      destroy: close,
    }),
    props: {
      handleDOMEvents: {
        blur(view, e) { if (!(shown && shown.kind === "form") && !pop.contains(e.relatedTarget)) close(); return false; },
        keydown(view, e) { if (e.key === "Escape" && shown && close()) { e.preventDefault(); return true; } return false; },
      },
    },
  });

  A.link = { plugin, edit, close, linkAt };
})();
