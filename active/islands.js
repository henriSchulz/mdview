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
  const { md, esc, tex, mermaidSvg, svgPicture, hydrate, copy, toast } = window.MdView.core;
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
    return { indented: false, closed, fence, indent, lang: im[2], rest: im[3], lead: im[1], code: body.join("\n") };
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

  const LANGS = () => [...new Set([...recent, ...hljs.listLanguages().filter((l) => !/^(plaintext|python-repl|php-template)$/.test(l)), "mermaid", "math", "svg"])];
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
  /* The island a dialog was opened for. If the document was built anew under the dialog (the
   * file changed on disk), the island is looked for again: the same Markdown, nearest to where it was. */
  let target = null;
  function locate(view, pos) {
    if (!target || target.pos !== pos) return pos;
    const doc = view.state.doc, same = (n) => !!n && n.type === target.node.type && n.attrs.raw === target.node.attrs.raw;
    if (pos <= doc.content.size && same(doc.nodeAt(pos))) return pos;
    let best = -1;
    doc.descendants((n, p) => { if (same(n) && (best < 0 || Math.abs(p - pos) < Math.abs(best - pos))) best = p; return !n.isTextblock; });
    return best;
  }
  function replace(view, at, raw) {
    const pos = locate(view, at);
    if (pos < 0) { copy(raw); toast(T("dialog.gone")); return; } // not lost: on the clipboard
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
      key: node.attrs.raw,
      build(body, tools, info) {
        lang = el("input", { class: "lp-field dlg-lang", type: "text", placeholder: T("dialog.nolang"), "aria-label": T("dialog.language"), spellcheck: "false", autocomplete: "off" });
        lang.value = c.lang;
        window.MdView.core.combo(lang, LANGS); // (the languages, offered in the app's own menu while it is typed in)
        tools.append(lang);
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
          if (kind !== "mermaid" && kind !== "math" && kind !== "svg") { if (preview) { preview.remove(); preview = null; } return; }
          if (!preview) { preview = el("div", { class: "dlg-preview" }); body.append(preview); }
          draw(ed.value);
        };
        let seq = 0;
        const draw = async (v) => {
          if (!preview) return;
          const kind = lang.value.trim().toLowerCase(), mine = ++seq;
          if (kind === "math") { preview.innerHTML = tex(v, true); return; }
          if (kind === "svg") { // (the picture; while the code is not one, the last one stays, dimmed)
            const svg = svgPicture(v);
            if (svg) preview.innerHTML = svg;
            preview.classList.toggle("stale", !svg);
            delete preview.dataset.error;
            return;
          }
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
        return { text: () => ed.value, setText: (v) => { ed.value = v; ed.input.dispatchEvent(new Event("input")); }, 
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
  // the caret into the line below a block (a new one, if none is there to write in)
  function below(view, pos) {
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type !== N.island) return;
    const end = pos + node.nodeSize, next = view.state.doc.resolve(end).nodeAfter;
    const tr = view.state.tr;
    if (!next || !next.isTextblock) tr.insert(end, N.paragraph.create());
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView());
    view.focus();
  }
  /* inline: { from, to } of the atom when the formula stands in a line */
  function mathDialog(view, pos, node, fresh, inline) {
    const p = inline ? { head: "$", tex: inline.tex, tail: "$" } : parseMath(node.attrs.raw);
    let ed, asInline = !!inline;
    A.dialog.show({
      title: T("dialog.math"),
      kind: "math",
      anchor: () => (inline ? (inline.create ? null : view.nodeDOM(inline.from)) : view.nodeDOM(pos)),
      key: inline ? (inline.create ? null : "$" + inline.tex + "$") : node.attrs.raw,
      build(body, tools, info) {
        const preview = el("div", { class: "dlg-preview math" }), error = el("div", { class: "dlg-error" });
        const bar = el("div", { class: "dlg-symbols" }, SYMBOLS.map(([label, , ], i) => `<button class="btn" type="button" data-i="${i}" tabindex="-1">${esc(label)}</button>`).join(""));
        ed = A.dialog.editor({ value: p.tex, language: "latex", pairs: true, label: T("dialog.math") });
        // snippets, tabstops, auto-fraction, matrix keys, tabout (Tab at the end leaves the formula)
        // (Tab at the end of a formula on its own lines: on with the line below it, as in a note)
        const suite = A.latexsuite.attach(ed, { block: () => !asInline, exit: () => { const own = !inline && !asInline; A.dialog.close("done"); if (own) below(view, pos); } });
        const hint = el("div", { class: "dlg-hint" });
        body.append(preview, error, bar, ed.el, hint);
        // block or in the line; the LaTeX, or the formula as a picture, to the clipboard
        const shape = el("div", { class: "dlg-seg", role: "radiogroup", "aria-label": T("dialog.mathShape") },
          `<button type="button" class="btn" role="radio" data-shape="block">${esc(T("dialog.block"))}</button><button type="button" class="btn" role="radio" data-shape="inline">${esc(T("dialog.inline"))}</button>`);
        const showShape = () => shape.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.shape === "inline") === asInline)));
        shape.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; asInline = b.dataset.shape === "inline"; showShape(); };
        showShape();
        const copyTex = el("button", { class: "btn", type: "button" }, esc(T("dialog.copyLatex")));
        copyTex.onclick = () => { copy(ed.value); toast(T("dialog.copied")); };
        const copyPic = el("button", { class: "btn", type: "button" }, esc(T("dialog.copyPicture")));
        copyPic.onclick = () => {
          // the formula's own box (its parts, not the full width it is centred in), on a plain ground
          const parts = [...preview.querySelectorAll(".katex-html > .base, .katex-html > .tag")];
          const rs = (parts.length ? parts : [preview]).map((x) => x.getBoundingClientRect());
          const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
          const right = Math.max(...rs.map((r) => r.right)), bottom = Math.max(...rs.map((r) => r.bottom));
          preview.classList.add("shooting");
          setTimeout(() => preview.classList.remove("shooting"), 900);
          requestAnimationFrame(() => requestAnimationFrame(() => window.webkit?.messageHandlers?.mdview?.postMessage(JSON.stringify({ type: "snapshot", x: left, y: top, w: right - left, h: bottom - top, said: T("dialog.pictureCopied") }))));
        };
        const box = el("button", { class: "btn", type: "button" }, esc(T("dialog.box")));
        box.onmousedown = (e) => e.preventDefault();
        box.onclick = () => { ed.input.focus({ preventScroll: true }); suite.box(); };
        tools.append(shape, box, copyTex, copyPic);
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
        return { text: () => ed.value, setText: (v) => { ed.value = v; ed.input.dispatchEvent(new Event("input")); }, 
          focus: () => ed.focus(),
          result() {
            const raw = inline ? "$" + ed.value.replace(/\s*\n\s*/g, " ").trim() + "$" : buildMath({ ...p, tex: ed.value });
            return !fresh && ed.value === p.tex && asInline === !!inline ? undefined : raw;
          },
        };
      },
      done(raw) {
        const tex = ed.value.trim();
        if (inline && inline.create) { // a formula made new, where the caret stood
          if (!tex) return;
          const line = "$" + tex.replace(/\s*\n\s*/g, " ") + "$", html = md.renderInline(line, { links: A.view.store.env.links, depth: 0 });
          const tr = view.state.tr.insert(inline.from, N.iatom.create({ kind: "math", raw: line, html }));
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, inline.from + 1)).setMeta("step", true));
          if (!asInline) toBlock(view, inline.from, tex);
          view.focus();
          return;
        }
        if (!inline && asInline) return toLine(view, pos, tex);                 // the block becomes a formula in a line
        if (inline && !asInline) return toBlock(view, inline.from, tex);        // and the other way round
        if (!inline) { replace(view, pos, /^\s*\$\$\s*\$\$\s*$/.test(raw) ? "" : raw); return; }
        setAtom(view, inline.from, "math", raw === "$$" ? "" : raw);
      },
      cancel() { if (fresh && !inline && !ed.value.trim()) unmake(view, pos); },
    });
  }

  /* Properties edited as a form: one field per property whose value is plain (text, a number, a
   * date, yes/no, a list of such). What the form changes is written into the YAML line by line;
   * every other line stays as it was. Anything deeper is edited as YAML. */
  const plainValue = (v) => v === null || ["string", "number", "boolean"].includes(typeof v) || v instanceof Date;
  const formable = (v) => plainValue(v) || (Array.isArray(v) && v.every((x) => plainValue(x) && !(x instanceof Date)));
  const asText = (v) => (v === null ? "" : v instanceof Date ? v.toISOString().slice(0, v.getUTCHours() || v.getUTCMinutes() ? 16 : 10).replace("T", " ") : String(v));
  // a value as YAML writes it on one line: as typed where YAML reads it back as that text, else quoted
  function yamlScalar(text) {
    try {
      const v = jsyaml.load("k: " + text);
      if (v && typeof v === "object" && !Array.isArray(v) && "k" in v && (v.k === null ? text.trim() === "" : !(typeof v.k === "object" && !(v.k instanceof Date))) && !/[#]/.test(text)) return text.trim();
    } catch (_e) { /* quoted below */ }
    return JSON.stringify(text);
  }
  // the lines of a top-level key: [from, to) in lines
  function keyLines(lines, key) {
    const esc2 = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^(?:${esc2}|"${esc2}"|'${esc2}')[ \t]*:`);
    const from = lines.findIndex((l) => re.test(l));
    if (from < 0) return null;
    let to = from + 1;
    while (to < lines.length && (/^[ \t]+\S/.test(lines[to]) || /^-[ \t]/.test(lines[to]) || (!lines[to].trim() && to + 1 < lines.length && /^[ \t]/.test(lines[to + 1])))) to++;
    return [from, to];
  }
  /* yaml with the form's changes: edits { key: text | text[] | boolean }, removed keys, added [key, text] */
  function applyForm(yaml, data, edits, removed, added) {
    const lines = yaml.split("\n");
    for (const [key, value] of Object.entries(edits)) {
      const at = keyLines(lines, key);
      if (!at) continue;
      const head = lines[at[0]].slice(0, lines[at[0]].indexOf(":") + 1);
      let out;
      if (Array.isArray(value)) {
        const block = at[1] > at[0] + 1 && /^[ \t]*-[ \t]/.test(lines[at[0] + 1]);
        const indent = block ? /^[ \t]*/.exec(lines[at[0] + 1])[0] : "  ";
        out = block && value.length ? [head, ...value.map((x) => indent + "- " + yamlScalar(x))] : [head + " [" + value.map(yamlScalar).join(", ") + "]"];
      } else if (typeof value === "boolean") out = [head + " " + value];
      else out = [value === "" ? head : head + " " + yamlScalar(value)];
      lines.splice(at[0], at[1] - at[0], ...out);
    }
    for (const key of removed) {
      const at = keyLines(lines, key);
      if (at) lines.splice(at[0], at[1] - at[0]);
    }
    for (const [key, text] of added) if (key.trim()) lines.push(yamlScalar(key.trim()).replace(/^"(.*)"$/, (m, k) => (/[:#]/.test(k) ? m : k)) + ":" + (text.trim() ? " " + yamlScalar(text) : ""));
    return lines.join("\n").replace(/^\n+/, "");
  }

  function frontDialog(view, pos, node) {
    const p = parseFront(node.attrs.raw);
    let ed, asForm = false, form = null, formState = null;
    A.dialog.show({
      title: T("dialog.frontmatter"),
      anchor: () => view.nodeDOM(pos),
      key: node.attrs.raw,
      build(body, tools, info) {
        const error = el("div", { class: "dlg-error" });
        ed = A.dialog.editor({ value: p.yaml, language: "yaml", label: T("dialog.frontmatter") });
        form = el("div", { class: "fm-form" });
        body.append(form, ed.el, error);
        const update = infoBar(info, ed);
        const check = (v) => {
          update();
          try { jsyaml.load(v); error.textContent = ""; ed.setError(null); return true; }
          catch (e) { error.textContent = String(e.reason || e.message || e); ed.setError(e.mark ? { pos: e.mark.position } : null); return false; }
        };
        ed.onInput = check;
        check(ed.value);
        // the form, made from the YAML as it is now
        function buildForm() {
          let data;
          try { data = jsyaml.load(ed.value) || {}; } catch (_e) { return false; }
          if (typeof data !== "object" || Array.isArray(data)) return false;
          formState = { data, edits: {}, removed: new Set(), added: [] };
          form.textContent = "";
          for (const [key, value] of Object.entries(data)) {
            const row = el("div", { class: "fm-row" });
            const name = el("span", { class: "fm-key" }, esc(key));
            let input;
            if (!formable(value)) input = el("span", { class: "fm-deep" }, esc(T("dialog.asYaml")));
            else if (typeof value === "boolean") {
              input = el("input", { type: "checkbox", class: "pf-switch" });
              input.checked = value;
              input.onchange = () => { formState.edits[key] = input.checked; };
            } else {
              input = el("input", { class: "lp-field fm-value", value: Array.isArray(value) ? value.map(asText).join(", ") : asText(value) });
              if (Array.isArray(value)) input.dataset.list = "";
              input.oninput = () => { formState.edits[key] = Array.isArray(value) ? input.value.split(",").map((x) => x.trim()).filter(Boolean) : input.value; };
            }
            const del = el("button", { class: "btn fm-del", type: "button", "aria-label": T("dialog.removeProperty") }, "×");
            del.onclick = () => { formState.removed.add(key); delete formState.edits[key]; row.remove(); };
            row.append(name, input, del);
            form.appendChild(row);
          }
          const add = el("button", { class: "btn fm-add", type: "button" }, esc(T("dialog.addProperty")));
          add.onclick = () => {
            const row = el("div", { class: "fm-row" });
            const k = el("input", { class: "lp-field fm-newkey", placeholder: T("dialog.propertyName") });
            const v = el("input", { class: "lp-field fm-value", placeholder: T("dialog.propertyValue") });
            const entry = ["", ""];
            formState.added.push(entry);
            k.oninput = () => { entry[0] = k.value; };
            v.oninput = () => { entry[1] = v.value; };
            row.append(k, v);
            form.insertBefore(row, add);
            k.focus();
          };
          form.appendChild(add);
          return true;
        }
        const yamlOfForm = () => applyForm(ed.value, formState.data, formState.edits, [...formState.removed], formState.added);
        const shape = el("div", { class: "dlg-seg", role: "radiogroup", "aria-label": T("dialog.frontmatter") },
          `<button type="button" class="btn" role="radio" data-shape="form">${esc(T("dialog.form"))}</button><button type="button" class="btn" role="radio" data-shape="yaml">YAML</button>`);
        const showShape = () => {
          shape.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.shape === "form") === asForm)));
          form.hidden = !asForm;
          ed.el.hidden = asForm;
        };
        shape.onclick = (e) => {
          const b = e.target.closest("button");
          if (!b || (b.dataset.shape === "form") === asForm) return;
          if (asForm) { ed.value = yamlOfForm(); ed.input.dispatchEvent(new Event("input")); asForm = false; }
          else if (check(ed.value) && buildForm()) asForm = true;
          showShape();
          (asForm ? form.querySelector("input") : ed.input)?.focus();
        };
        tools.append(shape);
        // simple properties open as the form, anything deeper as YAML
        let data = null;
        try { data = jsyaml.load(p.yaml); } catch (_e) { /* YAML */ }
        if (data && typeof data === "object" && !Array.isArray(data) && Object.values(data).every(formable) && buildForm()) asForm = true;
        showShape();
        return {
          text: () => (asForm ? yamlOfForm() : ed.value),
          setText: (v) => { ed.value = v; ed.input.dispatchEvent(new Event("input")); if (asForm) buildForm(); },
          focus: () => (asForm ? form.querySelector("input") || form : ed).focus(),
          result: () => { const y = asForm ? yamlOfForm() : ed.value; return y === p.yaml ? undefined : buildFront({ ...p, yaml: y }); },
        };
      },
      done(raw) { replace(view, pos, raw); },
    });
  }


  /* An embed of a PDF page — ![[file.pdf#page=3&rect=…]] — can have its region adjusted by hand: the
   * dialog's Adjust shows the whole page with a frame on it for what the embed shows; the frame is
   * moved and pulled at its edges and corners, the page can be changed, and every change is
   * written into the text as `page=` and `rect=`. A page embedded whole starts with the frame
   * around all of it. (Embeds of a text selection have no region to pull.) */
  const PDF_EMBED = /^(\s*!\[\[)([^\]|#]+\.pdf)#([^\]|]*)((?:\|[^\]]*)?\]\]\s*)$/i;
  function pdfAdjust(ed, preview, tools) {
    const btn = el("button", { class: "btn", type: "button", hidden: "" }, esc(T("dialog.adjust")));
    tools.append(btn);
    const self = { on: false, look };
    let shot = null, box = [0, 0, 1, 1], stage = null, frame = null, label = null, seq = 0;
    const parts = () => PDF_EMBED.exec(ed.value);
    const frag = () => { const m = parts(); return m ? window.MdPdf.parseFrag(m[3]) : null; };
    function look(text) { // (is what is written one embed of a page or a region?)
      const m = PDF_EMBED.exec(text), ok = !!m && !!window.MdPdf && !/(^|&)selection=/.test(m[3]) && !!preview.querySelector(".pdf-embed, .pdf-adjust");
      btn.hidden = !(ok || (self.on && m));
      if (self.on && !m) leave();
      if (adjustSoon && !btn.hidden && !self.on) { adjustSoon = false; btn.onclick(); } // (asked for from the menu)
    }
    function write() {
      const m = parts();
      if (!m || !shot) return;
      const rest = m[3].split("&").filter((p) => p && !/^(page|rect)=/.test(p));
      const whole = box[0] < 0.004 && box[1] < 0.004 && box[2] > 0.992 && box[3] > 0.992;
      const next = ["page=" + shot.page, ...(whole ? [] : ["rect=" + shot.rect(...box).join(",")]), ...rest].join("&");
      const text = m[1] + m[2] + "#" + next + m[4];
      if (text === ed.value) return;
      ed.value = text;
      ed.input.dispatchEvent(new Event("input"));
    }
    function place() {
      frame.style.left = box[0] * 100 + "%"; frame.style.top = box[1] * 100 + "%";
      frame.style.width = box[2] * 100 + "%"; frame.style.height = box[3] * 100 + "%";
    }
    async function show(page) {
      const m = parts(), span = preview.querySelector(".pdf-embed"), path = (span && span.dataset.pdf) || (stage && stage.dataset.pdf);
      if (!m || !path) return;
      const mine = ++seq, width = Math.min(900, Math.max(320, preview.clientWidth - 28));
      let got;
      try { got = await window.MdPdf.pageShot(path, page, width); } catch (e) { toast(String(e.message || e)); return; }
      if (mine !== seq) return;
      shot = got;
      stage = el("div", { class: "pdf-adjust" });
      stage.dataset.pdf = path;
      const bar = el("div", { class: "pa-bar" });
      const prev = el("button", { class: "btn", type: "button", "aria-label": T("dialog.adjustPrev") }, "‹"), next = el("button", { class: "btn", type: "button", "aria-label": T("dialog.adjustNext") }, "›");
      label = el("span", { class: "pa-page" }, esc(T("dialog.adjustPage", shot.page, shot.pages)));
      prev.disabled = shot.page <= 1; next.disabled = shot.page >= shot.pages;
      prev.onclick = () => show(shot.page - 1); next.onclick = () => show(shot.page + 1);
      bar.append(prev, label, next, el("span", { class: "pa-hint" }, esc(T("dialog.adjustHint"))));
      const sheet = el("div", { class: "pa-sheet" });
      frame = el("div", { class: "pa-frame" }, ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => `<i class="pa-h" data-h="${h}"></i>`).join(""));
      sheet.append(shot.img, frame);
      stage.append(bar, sheet);
      preview.replaceChildren(stage);
      place();
      sheet.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const r = sheet.getBoundingClientRect(), h = e.target.closest(".pa-h")?.dataset.h || (e.target.closest(".pa-frame") ? "move" : "new");
        const x0 = (e.clientX - r.left) / r.width, y0 = (e.clientY - r.top) / r.height, was = [...box], MIN = 0.02;
        const clamp = (v) => Math.max(0, Math.min(1, v));
        const move = (ev) => {
          const x = clamp((ev.clientX - r.left) / r.width), y = clamp((ev.clientY - r.top) / r.height);
          let [l, t, w, hh] = was, rr = l + w, bb = t + hh;
          if (h === "move") { l = Math.max(0, Math.min(1 - w, was[0] + x - x0)); t = Math.max(0, Math.min(1 - hh, was[1] + y - y0)); rr = l + w; bb = t + hh; }
          else if (h === "new") { l = Math.min(clamp(x0), x); rr = Math.max(clamp(x0), x); t = Math.min(clamp(y0), y); bb = Math.max(clamp(y0), y); }
          else {
            if (h.includes("w")) l = Math.min(x, rr - MIN);
            if (h.includes("e")) rr = Math.max(x, l + MIN);
            if (h.includes("n")) t = Math.min(y, bb - MIN);
            if (h.includes("s")) bb = Math.max(y, t + MIN);
          }
          if (rr - l < MIN || bb - t < MIN) return; // (a frame just begun: nothing yet)
          box = [l, t, rr - l, bb - t];
          place();
        };
        const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); stage.classList.remove("pulling"); write(); };
        stage.classList.add("pulling");
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });
      if (page !== (frag() || {}).page) write(); // (another page: the text says so)
    }
    function leave() {
      self.on = false; seq++;
      btn.textContent = T("dialog.adjust");
      btn.setAttribute("aria-pressed", "false");
      preview.innerHTML = htmlOf(ed.value);
      hydrate(preview);
    }
    btn.onclick = () => {
      if (self.on) { leave(); return; }
      const f = frag();
      if (!f) return;
      self.on = true;
      btn.textContent = T("dialog.adjustDone");
      btn.setAttribute("aria-pressed", "true");
      box = [0, 0, 1, 1];
      show(f.page).then(() => { if (shot && f.rect) { box = shot.box(f.rect).map((v) => Math.max(0, Math.min(1, v))); place(); } });
    };
    // (the embed is drawn a moment after the dialog opens: look again when it is there)
    new MutationObserver(() => look(ed.value)).observe(preview, { childList: true, subtree: true });
    return self;
  }

  /* How large a picture or an embedded PDF page shows: its own size, three fixed widths, the whole
   * column. Written as Obsidian writes a width — ![[tree.png|400]], ![a tree|400](tree.png) — and
   * |full for the column's width. */
  const SIZES = [["", "size.auto"], ["240", "size.small"], ["400", "size.medium"], ["640", "size.large"], ["full", "size.full"]];
  const sizeOptions = (now) => [...SIZES.map(([v, k]) => [v, T(k)]), ...(now && !SIZES.some(([v]) => v === now) ? [[now, /^\d+$/.test(now) ? now + " px" : now]] : [])];
  // what is written is one picture or one embed of a picture or a PDF: [before, size, after] of its size
  const WIKI_PIC = /^(\s*!\[\[[^\]|]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp|pdf)(?:#[^\]|]*)?)(?:\|([^\]]*))?(\]\]\s*)$/i, MD_PIC = /^(\s*!\[[^\]]*?)(?:\|(\d+|full))?(\]\([^)]*\)\s*)$/i;
  /* The same for the menu of a picture or an embed in the text (context.js): what it is, the size
   * it has, and how to give it another. null: not a picture. */
  function picture(view, pos, node) {
    if (node.type === N.image) {
      const was = window.MdView.core.imageSize(node.attrs.alt);
      return { size: was.size, pdf: false, sizes: sizeOptions(was.size),
        setSize(v) { view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, alt: was.alt + (v ? "|" + v : "") })); view.focus(); } };
    }
    if (node.type !== N.island || node.attrs.virtual || typeof node.attrs.raw !== "string") return null;
    const m = WIKI_PIC.exec(node.attrs.raw) || MD_PIC.exec(node.attrs.raw), now = m ? (m[2] || "").toLowerCase() : "";
    if (!m || (now && !/^(\d+(x\d+)?|full)$/.test(now))) return null;
    const pdf = PDF_EMBED.exec(node.attrs.raw);
    return { size: now, sizes: sizeOptions(now), pdf: !!pdf && !/(^|&)selection=/.test(pdf[3]),
      setSize(v) { target = null; replace(view, pos, m[1] + (v ? "|" + v : "") + m[3]); view.focus(); } }; // (no dialog is open: the block is the one at pos)
  }
  // the dialog of a PDF embed, opened with its region to be adjusted at once
  let adjustSoon = false;
  function adjust(view, pos) { adjustSoon = true; open(view, pos); setTimeout(() => { adjustSoon = false; }, 4000); }

  function sizeChoice(ed, tools) {
    const select = el("select", { "aria-label": T("dialog.size") }), parts = (t) => WIKI_PIC.exec(t) || MD_PIC.exec(t);
    tools.append(select);
    const wrap = window.MdView.core.popup(select);
    const look = (text) => {
      const m = parts(text), now = m ? (m[2] || "").toLowerCase() : "";
      wrap.hidden = !m || (!!now && !/^(\d+(x\d+)?|full)$/.test(now)); // (a description of one's own in the size's place: left alone)
      if (wrap.hidden) return;
      select.innerHTML = sizeOptions(now).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
      select.value = now;
      wrap.sync();
    };
    select.addEventListener("change", () => {
      const m = parts(ed.value);
      if (!m) return;
      ed.value = m[1] + (select.value ? "|" + select.value : "") + m[3];
      ed.input.dispatchEvent(new Event("input"));
    });
    return { look };
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
      key: node.attrs.raw,
      build(body, tools, info) {
        ed = A.dialog.editor({ value: node.attrs.raw, language: kind === "html" ? "xml" : "markdown", label: T(RAW_TITLE[kind] || "dialog.markdown") });
        const preview = el("div", { class: "dlg-preview doc" });
        body.append(ed.el, preview);
        ed.onInput = infoBar(info, ed);
        const size = sizeChoice(ed, tools), adjust = pdfAdjust(ed, preview, tools);
        follow(ed, (v) => {
          size.look(v);
          adjust.look(v);
          if (adjust.on) return; // (the page with its frame stands there: the frame writes the text, not the other way round)
          preview.innerHTML = htmlOf(v);
          hydrate(preview);
        });
        return { text: () => ed.value, setText: (v) => { ed.value = v; ed.input.dispatchEvent(new Event("input")); }, focus: () => ed.focus(), result: () => (ed.value === node.attrs.raw ? undefined : ed.value) };
      },
      done(raw) { replace(view, pos, raw); },
    });
  }

  // ------------------------------------------------------------ inline: a formula, a wikilink, a picture
  /* A formula block made a formula in a line: a paragraph of its own with it. */
  function toLine(view, at, tex) {
    const pos = locate(view, at), node = pos < 0 ? null : view.state.doc.nodeAt(pos);
    if (!node || !tex) return;
    const raw = "$" + tex.replace(/\s*\n\s*/g, " ") + "$";
    const html = md.renderInline(raw, { links: A.view.store.env.links, depth: 0 });
    const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, N.paragraph.create({ bid: node.attrs.bid }, N.iatom.create({ kind: "math", raw, html })));
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 2)).setMeta("step", true));
    view.focus();
  }
  /* A formula in a line made a block: the paragraph is cut there, the block stands between its halves. */
  function toBlock(view, from, tex) {
    const state = view.state, $p = state.doc.resolve(from), para = $p.parent;
    if (!tex || !$p.parent.isTextblock) return;
    const island = blocksOf("$$\n" + tex + "\n$$", A.view.store).find((n) => n.type === N.island);
    if (!island) return;
    const before = para.cut(0, $p.parentOffset), after = para.cut($p.parentOffset + 1);
    const nodes = [];
    if (before.textContent.trim() || before.childCount > 1) nodes.push(before);
    nodes.push(island);
    if (after.textContent.trim() || after.childCount > 1) nodes.push(N.paragraph.create(null, after.content));
    if (para.type !== N.paragraph || !$p.node(-1).canReplaceWith($p.index(-1), $p.indexAfter(-1), N.island)) return;
    const tr = state.tr.replaceWith($p.before(), $p.after(), nodes);
    const at = $p.before() + (nodes[0] === island ? 0 : nodes[0].nodeSize);
    view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).setMeta("step", true));
    view.focus();
  }
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
    const dom = view.nodeDOM(pos), was = window.MdView.core.imageSize(node.attrs.alt);
    A.dialog.fields({
      rect: dom.getBoundingClientRect(), label: T("dialog.image"),
      fields: [{ key: "alt", label: T("dialog.alt"), value: was.alt }, { key: "src", label: T("link.url"), value: node.attrs.src }, { key: "title", label: T("dialog.imgtitle"), value: node.attrs.title || "" },
        { key: "size", label: T("dialog.size"), value: was.size, options: sizeOptions(was.size) }],
      apply(v) {
        const src = v.src.trim(), tr = view.state.tr;
        if (!src) tr.delete(pos, pos + node.nodeSize);
        else tr.setNodeMarkup(pos, null, { src, alt: v.alt.replace(/\|(\d+|full)$/i, "") + (v.size ? "|" + v.size : ""), title: v.title.trim() || null });
        view.dispatch(tr);
        view.focus();
      },
      cancel() { // a picture just put in, still without an address, goes again
        const now = view.state.doc.nodeAt(pos);
        if (now && now.type === N.image && !now.attrs.src) view.dispatch(view.state.tr.delete(pos, pos + now.nodeSize));
        view.focus();
      },
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
    target = { pos, node };
    // the block is selected while its dialog is up: closing it hands the focus back to the block
    if (!(view.state.selection instanceof NodeSelection && view.state.selection.from === pos)) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
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

  // a formula in the line, made new at this position: its dialog opens empty
  const newMath = (view, pos) => mathDialog(view, pos, null, true, { from: pos, tex: "", create: true });
  A.islands = { picture, adjust, applyForm, open, newMath, onEnter, replace, blocksOf, parseCode, buildCode, parseMath, buildMath, parseFront, buildFront, mathPreview, kit: { infoBar, follow, html: htmlOf } };
})();
