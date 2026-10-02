/* mdview active mode — islands: what is shown rendered and edited in a
 * dialog. Code, formulas, frontmatter, HTML, and everything the editor does
 * not edit inline (tables until they are, callouts, definition lists).
 *
 * Every dialog works on the island's Markdown and hands back new Markdown;
 * replace() parses that on its own (with the document's definitions) and puts
 * the result where the island was. What exactly is written stays what was
 * entered: an island's text is its `raw`.
 */
"use strict";
(() => {
  const A = window.MdActive;
  const { md, esc, tex, mermaidSvg, hydrate, copy, toast } = window.MdView.core;
  const T = window.MdStrings.t;
  const { NodeSelection, TextSelection, Selection } = PM.state;
  const N = A.schema.nodes;
  const { el } = A.dialog;

  // ------------------------------------------------------------ Markdown of an island, taken apart and put together
  /* A code block: { fence, indent, lang, rest, code, indented }. */
  function parseCode(raw) {
    const lines = raw.split("\n");
    const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lines[0]);
    if (!m) { // by indentation
      return { indented: true, fence: "```", indent: "", lang: "", rest: "", code: lines.map((l) => l.replace(/^(?: {4}|\t| {0,3}$)/, "")).join("\n") };
    }
    const [, indent, fence, info] = m;
    const closed = lines.length > 1 && new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(lines[lines.length - 1]);
    const body = lines.slice(1, closed ? -1 : undefined).map((l) => l.replace(new RegExp(`^ {0,${indent.length}}`), ""));
    const im = /^([ \t]*)(\S*)([\s\S]*)$/.exec(info);
    return { indented: false, fence, indent, lang: im[2], rest: im[3], lead: im[1], code: body.join("\n") };
  }
  function buildCode(c) {
    if (c.indented && !c.lang) return c.code.split("\n").map((l) => (l ? "    " + l : "")).join("\n");
    // the fence has to be longer than any run of its character in the code
    let fence = c.fence;
    for (const m of c.code.matchAll(new RegExp(`^[ \\t]*(${fence[0] === "~" ? "~" : "`"}{3,})`, "gm"))) if (m[1].length >= fence.length) fence = fence[0].repeat(m[1].length + 1);
    const info = (c.lead || "") + c.lang + (c.lang || !c.rest.trim() ? c.rest : c.rest.replace(/^[ \t]+/, ""));
    const body = c.code === "" ? [] : c.code.split("\n").map((l) => (l ? c.indent + l : l));
    return [c.indent + fence + info, ...body, c.indent + fence].join("\n");
  }
  /* A formula block: what stands before and after the LaTeX stays as written. */
  function parseMath(raw) {
    const m = /^( {0,3}\$\$[ \t]*\n?)([\s\S]*?)(\n?[ \t]*\$\$[ \t]*)$/.exec(raw);
    return m ? { head: m[1], tex: m[2], tail: m[3] } : { head: "$$\n", tex: raw, tail: "\n$$" };
  }
  const buildMath = (p) => p.head + p.tex + p.tail;
  function parseFront(raw) {
    const m = /^(---[ \t]*\n)([\s\S]*?)(\n?(?:---|\.\.\.)[ \t]*)$/.exec(raw);
    return m ? { head: m[1], yaml: m[2], tail: m[3] } : { head: "---\n", yaml: raw, tail: "\n---" };
  }
  const buildFront = (p) => p.head + p.yaml + (p.yaml && !p.tail.startsWith("\n") ? "\n" : "") + p.tail;

  const LANGS = () => [...new Set([...recent, ...hljs.listLanguages().filter((l) => !/^(plaintext|python-repl|php-template)$/.test(l)), "mermaid", "math"])];
  const ALIAS = { js: "javascript", ts: "typescript", py: "python", sh: "bash", zsh: "bash", shell: "bash", html: "xml", yml: "yaml", md: "markdown", "c++": "cpp", rs: "rust", rb: "ruby" };
  const hl = (lang) => { const l = lang.toLowerCase(); return hljs.getLanguage(l) ? l : ALIAS[l] || ""; };
  const recent = []; // languages picked in this session, newest first

  // ------------------------------------------------------------ putting the result back
  /* The blocks a piece of Markdown is, read with the document's definitions. */
  function blocksOf(raw, store) {
    const d = A.document.open({ text: raw, raw, links: store.env.links, vault: store.vault }, {
      references: store.env.references, footnotes: store.env.footnotes && store.env.footnotes.refs, abbreviations: store.env.abbreviations,
    });
    const out = [];
    d.doc.forEach((n) => { if (!(n.type === N.island && n.attrs.virtual)) out.push(n); });
    return out;
  }
  /* Replace the block at `pos` by what `raw` is. One undo step. Empty: the block goes. */
  function replace(view, pos, raw) {
    const state = view.state, node = state.doc.nodeAt(pos);
    if (!node) return;
    const tr = state.tr;
    if (!raw.trim()) tr.delete(pos, pos + node.nodeSize);
    else {
      const nodes = blocksOf(raw, A.view.store).map((n, i) => n.type.create({ ...n.attrs, bid: i === 0 ? node.attrs.bid : null, line: null }, n.content, n.marks));
      // an island is written exactly as entered; whatever else came out is an ordinary block from now on
      if (nodes.length === 1 && nodes[0].type === N.island) nodes[0] = N.island.create({ ...nodes[0].attrs, raw });
      tr.replaceWith(pos, pos + node.nodeSize, nodes);
      const $at = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
      tr.setSelection($at.nodeAfter && NodeSelection.isSelectable($at.nodeAfter) ? NodeSelection.create(tr.doc, pos) : Selection.near($at, 1));
    }
    view.dispatch(tr.scrollIntoView().setMeta("step", true));
    hydrate(view.dom);
    flash(view, pos);
  }
  // a short shimmer on what was just changed, instead of a blink
  function flash(view, pos) {
    const dom = view.nodeDOM(pos);
    if (!dom || !dom.classList) return;
    dom.classList.add("fresh");
    requestAnimationFrame(() => requestAnimationFrame(() => dom.classList.remove("fresh")));
  }

  // a block just made by typing and left empty goes again: an empty line to type on is back
  function unmake(view, pos) {
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type !== N.island) return;
    const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, N.paragraph.create());
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)));
  }

  // ------------------------------------------------------------ dialogs
  const countOf = (text) => T("dialog.count", text ? text.split("\n").length : 0, text.length);
  function infoBar(info, ed) {
    const count = el("span", { class: "dlg-count" });
    const btn = el("button", { class: "btn", type: "button" }, esc(T("dialog.copy")));
    btn.onclick = () => { copy(ed.value); btn.textContent = T("dialog.copied"); setTimeout(() => { btn.textContent = T("dialog.copy"); }, 1200); };
    info.append(count, btn);
    const update = () => { count.textContent = countOf(ed.value); };
    update();
    return update;
  }
  // a preview that follows the editor, a little behind
  function follow(ed, render, wait = 300) {
    let timer = 0;
    const prev = ed.onInput;
    ed.onInput = (v) => { if (prev) prev(v); clearTimeout(timer); timer = setTimeout(() => render(v), wait); };
    render(ed.value);
  }

  function codeDialog(view, pos, node, fresh) {
    const c = parseCode(node.attrs.raw);
    let ed, lang, rest;
    A.dialog.show({
      title: T("dialog.code"),
      anchor: () => view.nodeDOM(pos),
      build(body, tools, info) {
        lang = el("input", { class: "lp-field dlg-lang", type: "text", list: "dlg-langs", placeholder: T("dialog.nolang"), "aria-label": T("dialog.language"), spellcheck: "false", autocomplete: "off" });
        lang.value = c.lang;
        const list = el("datalist", { id: "dlg-langs" }, LANGS().map((l) => `<option value="${esc(l)}"></option>`).join(""));
        tools.append(lang, list);
        if (c.rest.trim()) {
          rest = el("input", { class: "lp-field dlg-rest", type: "text", "aria-label": T("dialog.info"), spellcheck: "false", autocomplete: "off" });
          rest.value = c.rest.trim();
          tools.append(rest);
        }
        ed = A.dialog.editor({ value: c.code, language: hl(c.lang), label: T("dialog.code") });
        body.append(ed.el);
        const update = infoBar(info, ed);
        ed.onInput = update;
        let preview = null;
        const showPreview = () => {
          const kind = lang.value.trim().toLowerCase();
          if (kind !== "mermaid" && kind !== "math") { if (preview) { preview.remove(); preview = null; } return; }
          if (!preview) { preview = el("div", { class: "dlg-preview" }); body.append(preview); }
          draw(ed.value);
        };
        let seq = 0;
        const draw = async (v) => {
          if (!preview) return;
          const kind = lang.value.trim().toLowerCase(), mine = ++seq;
          if (kind === "math") { preview.innerHTML = tex(v, true); return; }
          try {
            const svg = await mermaidSvg(v);
            if (mine === seq && preview) { preview.innerHTML = svg; preview.classList.remove("stale"); }
          } catch (e) {
            if (mine === seq && preview) { preview.classList.add("stale"); preview.dataset.error = String(e.message || e).split("\n")[0]; }
          }
        };
        lang.addEventListener("input", () => { ed.setLanguage(hl(lang.value.trim())); showPreview(); });
        showPreview();
        follow(ed, draw);
        return {
          focus: () => (fresh || c.code ? ed.focus() : lang.focus()),
          result() {
            const next = { ...c, lang: lang.value.trim(), rest: rest ? (rest.value.trim() ? " " + rest.value.trim() : "") : c.rest, code: ed.value };
            const raw = buildCode(next);
            return raw === node.attrs.raw && !fresh ? undefined : raw;
          },
        };
      },
      done(raw) {
        const l = lang.value.trim();
        if (l) { recent.splice(0, recent.length, l, ...recent.filter((x) => x !== l).slice(0, 5)); }
        replace(view, pos, raw);
      },
      cancel() { if (fresh && !ed.value.trim()) unmake(view, pos); },
    });
  }

  const SYMBOLS = [
    ["a⁄b", "\\frac{}{}", 6], ["√", "\\sqrt{}", 6], ["xⁿ", "^{}", 2], ["xₙ", "_{}", 2], ["∑", "\\sum_{}^{}", 6], ["∫", "\\int_{}^{}", 6],
    ["( )", "\\left(  \\right)", 7], ["[ ]", "\\begin{pmatrix}\n  \n\\end{pmatrix}", 18], ["α", "\\alpha"], ["β", "\\beta"], ["π", "\\pi"], ["∞", "\\infty"], ["≤", "\\le"], ["≠", "\\ne"], ["→", "\\to"], ["·", "\\cdot"],
  ];
  /* The formula with its error, if it has one: { html, error, pos }. */
  function mathPreview(src, display) {
    try {
      return { html: katex.renderToString(src, { displayMode: display, throwOnError: true, strict: "ignore", output: "html" }) };
    } catch (e) {
      return { error: String(e.message || e).replace(/^KaTeX parse error: /, ""), pos: typeof e.position === "number" ? e.position : null };
    }
  }
  /* inline: { from, to } of the atom when the formula stands in a line */
  function mathDialog(view, pos, node, fresh, inline) {
    const p = inline ? { head: "$", tex: inline.tex, tail: "$" } : parseMath(node.attrs.raw);
    let ed;
    A.dialog.show({
      title: T("dialog.math"),
      anchor: () => (inline ? view.nodeDOM(inline.from) : view.nodeDOM(pos)),
      build(body, tools, info) {
        const preview = el("div", { class: "dlg-preview math" }), error = el("div", { class: "dlg-error" });
        const bar = el("div", { class: "dlg-symbols" }, SYMBOLS.map(([label, , ], i) => `<button class="btn" type="button" data-i="${i}" tabindex="-1">${esc(label)}</button>`).join(""));
        ed = A.dialog.editor({ value: p.tex, language: "latex", pairs: true, label: T("dialog.math") });
        const hint = el("div", { class: "dlg-hint" });
        body.append(preview, error, bar, ed.el, hint);
        bar.addEventListener("mousedown", (e) => e.preventDefault());
        bar.addEventListener("click", (e) => {
          const b = e.target.closest("button");
          if (!b) return;
          const [, text, caret] = SYMBOLS[b.dataset.i], at = ed.input.selectionStart;
          ed.insert(text, caret == null ? at + text.length : at + caret);
        });
        const update = infoBar(info, ed);
        const draw = (v) => {
          update();
          const r = mathPreview(v, true);
          if (r.html != null) { preview.innerHTML = r.html; preview.classList.remove("stale"); error.textContent = ""; ed.setError(null); }
          else { preview.classList.add("stale"); error.textContent = r.error; ed.setError(r.pos == null ? null : { pos: r.pos }); } // the last good one stays
          // blank lines end the formula for some programs: say so, change nothing
          hint.innerHTML = !inline && /\n[ \t]*\n/.test(v) ? `${esc(T("dialog.blanklines"))} <button class="btn" type="button">${esc(T("dialog.remove"))}</button>` : "";
          const b = hint.querySelector("button");
          if (b) b.onclick = () => { ed.value = ed.value.replace(/\n([ \t]*\n)+/g, "\n"); draw(ed.value); };
        };
        ed.onInput = draw;
        draw(ed.value);
        return {
          focus: () => ed.focus(),
          result() {
            const raw = inline ? "$" + ed.value.replace(/\s*\n\s*/g, " ").trim() + "$" : buildMath({ ...p, tex: ed.value });
            return !fresh && ed.value === p.tex ? undefined : raw;
          },
        };
      },
      done(raw) {
        if (!inline) { replace(view, pos, /^\s*\$\$\s*\$\$\s*$/.test(raw) ? "" : raw); return; }
        setAtom(view, inline.from, "math", raw === "$$" ? "" : raw);
      },
      cancel() { if (fresh && !inline && !ed.value.trim()) unmake(view, pos); },
    });
  }

  function frontDialog(view, pos, node) {
    const p = parseFront(node.attrs.raw);
    let ed;
    A.dialog.show({
      title: T("dialog.frontmatter"),
      anchor: () => view.nodeDOM(pos),
      build(body, tools, info) {
        const error = el("div", { class: "dlg-error" });
        ed = A.dialog.editor({ value: p.yaml, language: "yaml", label: T("dialog.frontmatter") });
        body.append(ed.el, error);
        const update = infoBar(info, ed);
        const check = (v) => {
          update();
          try { jsyaml.load(v); error.textContent = ""; ed.setError(null); }
          catch (e) { error.textContent = String(e.reason || e.message || e); ed.setError(e.mark ? { pos: e.mark.position } : null); }
        };
        ed.onInput = check;
        check(ed.value);
        return { focus: () => ed.focus(), result: () => (ed.value === p.yaml ? undefined : buildFront({ ...p, yaml: ed.value })) };
      },
      done(raw) { replace(view, pos, raw); },
    });
  }

  const RAW_TITLE = { html: "dialog.html", table: "dialog.table", deflist: "dialog.deflist", blockquote: "dialog.callout" };
  // anything else: its Markdown as text, with what it becomes below
  // Markdown as the document shows it
  const htmlOf = (raw) => blocksOf(raw, A.view.store).map((n) => (n.type === N.island ? n.attrs.html : PM.model.DOMSerializer.fromSchema(A.schema).serializeNode(n).outerHTML)).join("");
  function rawDialog(view, pos, node) {
    const kind = node.attrs.kind;
    let ed;
    A.dialog.show({
      title: T(RAW_TITLE[kind] || "dialog.markdown"),
      anchor: () => view.nodeDOM(pos),
      build(body, tools, info) {
        ed = A.dialog.editor({ value: node.attrs.raw, language: kind === "html" ? "xml" : "markdown", label: T(RAW_TITLE[kind] || "dialog.markdown") });
        const preview = el("div", { class: "dlg-preview doc" });
        body.append(ed.el, preview);
        ed.onInput = infoBar(info, ed);
        follow(ed, (v) => {
          preview.innerHTML = htmlOf(v);
          hydrate(preview);
        });
        return { focus: () => ed.focus(), result: () => (ed.value === node.attrs.raw ? undefined : ed.value) };
      },
      done(raw) { replace(view, pos, raw); },
    });
  }

  // ------------------------------------------------------------ inline: a formula, a wikilink, a picture
  function setAtom(view, pos, kind, raw) {
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;
    const tr = view.state.tr;
    if (!raw) tr.delete(pos, pos + node.nodeSize);
    else {
      const html = md.renderInline(raw, { links: A.view.store.env.links, depth: 0 });
      tr.replaceWith(pos, pos + node.nodeSize, N.iatom.create({ kind, raw, html }, null, node.marks));
      tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    }
    view.dispatch(tr.setMeta("step", true));
    view.focus();
  }
  function atomPopover(view, pos, node) {
    const rect = view.nodeDOM(pos).getBoundingClientRect();
    const back = () => { view.focus(); view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); };
    if (node.attrs.kind === "math") {
      A.dialog.fields({
        rect, label: T("dialog.math"),
        fields: [{ key: "tex", label: "LaTeX", value: node.attrs.raw.slice(1, -1), mono: true }],
        preview(v) { const r = mathPreview(v.tex, false); return { html: r.html, error: r.error }; },
        apply(v) { const t = v.tex.trim(); if ("$" + t + "$" !== node.attrs.raw) setAtom(view, pos, "math", t ? "$" + t + "$" : ""); else back(); },
        more(v) { mathDialog(view, pos, node, false, { from: pos, tex: v.tex }); },
        cancel: back,
      });
    } else if (node.attrs.kind === "wikilink") {
      const [target, ...alias] = node.attrs.raw.slice(2, -2).split("|");
      A.dialog.fields({
        rect, label: T("dialog.wikilink"),
        fields: [{ key: "target", label: T("dialog.note"), value: target }, { key: "alias", label: T("link.text"), value: alias.join("|") }],
        apply(v) {
          const t = v.target.trim(), raw = t ? "[[" + t + (v.alias.trim() ? "|" + v.alias.trim() : "") + "]]" : "";
          if (raw !== node.attrs.raw) setAtom(view, pos, "wikilink", raw); else back();
        },
        cancel: back,
      });
    }
  }
  function imagePopover(view, pos, node) {
    const dom = view.nodeDOM(pos);
    A.dialog.fields({
      rect: dom.getBoundingClientRect(), label: T("dialog.image"),
      fields: [{ key: "alt", label: T("dialog.alt"), value: node.attrs.alt }, { key: "src", label: T("link.url"), value: node.attrs.src }, { key: "title", label: T("dialog.imgtitle"), value: node.attrs.title || "" }],
      apply(v) {
        const src = v.src.trim(), tr = view.state.tr;
        if (!src) tr.delete(pos, pos + node.nodeSize);
        else tr.setNodeMarkup(pos, null, { src, alt: v.alt, title: v.title.trim() || null });
        view.dispatch(tr);
        view.focus();
      },
      cancel() { view.focus(); },
    });
  }

  // ------------------------------------------------------------ opening
  /* The dialog for the island at pos. fresh: it was just made by typing. */
  function open(view, pos, fresh = false) {
    const node = view.state.doc.nodeAt(pos);
    if (!node || !view.editable || A.dialog.open) return false;
    if (node.type === N.image) { imagePopover(view, pos, node); return true; }
    if (node.type === N.iatom) { if (node.attrs.kind === "footnote") return A.notes.edit(view, A.notes.labelOf(node)); atomPopover(view, pos, node); return true; }
    if (node.type !== N.island || node.attrs.virtual) return false;
    const kind = node.attrs.kind;
    if (kind === "code") codeDialog(view, pos, node, fresh);
    else if (kind === "math") mathDialog(view, pos, node, fresh);
    else if (kind === "frontmatter") frontDialog(view, pos, node);
    else rawDialog(view, pos, node);
    return true;
  }
  /* "```lang" or "$$" and Enter in a paragraph of its own: a new island, and its dialog at once. */
  function onEnter(state, dispatch, view) {
    const { $from, empty } = state.selection, p = $from.parent;
    if (!empty || p.type !== N.paragraph || p.childCount !== 1 || !p.firstChild.isText || $from.parentOffset !== p.content.size) return false;
    const code = /^(```|~~~)([^\s`]*)$/.exec(p.textContent), math = p.textContent === "$$";
    if (!code && !math) return false;
    if (dispatch) {
      const raw = code ? code[1] + code[2] + "\n" + code[1] : "$$\n\n$$";
      const island = blocksOf(raw, (A.edit.storeOf(state))).find((n) => n.type === N.island) || N.island.create({ kind: code ? "code" : "math", raw });
      const pos = $from.before();
      dispatch(state.tr.replaceWith(pos, $from.after(), island));
      if (view) setTimeout(() => open(view, pos, true), 0);
    }
    return true;
  }

  A.islands = { open, onEnter, replace, blocksOf, parseCode, buildCode, parseMath, buildMath, parseFront, buildFront, mathPreview, kit: { infoBar, follow, html: htmlOf } };
})();
