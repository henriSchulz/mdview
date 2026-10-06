/* mdview active mode — the clipboard.
 *
 * Copy puts two things there: the selection's Markdown (what was not changed,
 * as it stands in the file) and its HTML, for programs that take formatted
 * text.
 * Paste: plain text is read as Markdown and keeps the way it is written;
 * HTML from a browser or a word processor is reduced to what Markdown can
 * say — no styles, no classes, no HTML in the file. An address pasted over a
 * selection links it. In code, and with Ctrl+Shift+V, text is just text.
 */
"use strict";
(() => {
  const A = window.MdActive;
  const { Plugin, PluginKey, TextSelection, Selection } = PM.state;
  const { Slice, Fragment, DOMSerializer } = PM.model;
  const N = A.schema.nodes, M = A.schema.marks;
  const { isExternal, hydrate } = window.MdView.core;
  const post = (type, data = {}) => window.MdHost?.post(JSON.stringify({ type, ...data }));

  // ------------------------------------------------------------ HTML from elsewhere, reduced
  const SKIP = /^(script|style|head|meta|link|title|noscript|template|iframe|object|embed|svg|math|button|select|textarea|input|caption|colgroup|col|canvas|audio|video)$/;
  const SAME = /^(p|h[1-6]|blockquote|ul|ol|li|table|tr|hr|br)$/;
  const BLOCKISH = /^(div|section|article|main|header|footer|aside|nav|figure|figcaption|details|summary|dl|dt|dd|address|center|form|fieldset)$/;
  const INLINE = { b: "strong", strong: "strong", i: "em", em: "em", del: "s", s: "s", strike: "s", code: "code", kbd: "code", samp: "code", tt: "code" };
  const langOf = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const m = /\b(?:language|lang|highlight-source|highlight-text|brush:\s*)-?([\w+#.-]+)/.exec(e.className || ""); if (m) return m[1].replace(/^(text|source)-/, ""); if (e.tagName !== "CODE" && e.tagName !== "PRE") break; } return ""; };
  function fenced(code, lang) {
    const longest = Math.max(2, ...(code.match(/`+/g) || []).map((r) => r.length));
    const fence = "`".repeat(longest + 1);
    return fence + lang + "\n" + code.replace(/\n$/, "") + "\n" + fence;
  }
  function reduce(src, dst, doc) {
    for (const node of src.childNodes) {
      if (node.nodeType === 3) { dst.appendChild(doc.createTextNode(node.nodeValue)); continue; }
      if (node.nodeType !== 1) continue;
      const tag = node.tagName.toLowerCase();
      if (SKIP.test(tag) || node.hidden || node.style?.display === "none" || node.getAttribute("aria-hidden") === "true") continue;
      let el = null;
      if (tag === "pre") {
        el = doc.createElement("div");
        el.setAttribute("data-md-code", fenced(node.textContent, langOf(node.querySelector("code") || node) || langOf(node.parentElement)));
        dst.appendChild(el);
        continue;
      }
      if (tag === "img") {
        const srcAttr = node.getAttribute("src") || "";
        if (!srcAttr || /^data:/i.test(srcAttr)) continue; // never an embedded picture in the file
        el = doc.createElement("img");
        el.setAttribute("src", srcAttr);
        if (node.getAttribute("alt")) el.setAttribute("alt", node.getAttribute("alt"));
        if (node.getAttribute("title")) el.setAttribute("title", node.getAttribute("title"));
        dst.appendChild(el);
        continue;
      }
      if (tag === "a") {
        const href = node.getAttribute("href") || "";
        if (href && !/^\s*javascript:/i.test(href) && node.textContent.trim() + (node.querySelector("img") ? "x" : "")) {
          el = doc.createElement("a");
          el.setAttribute("href", href);
          if (node.getAttribute("title")) el.setAttribute("title", node.getAttribute("title"));
        }
      } else if (INLINE[tag]) {
        // (some word processors wrap everything in <b style="font-weight:normal">)
        const plain = INLINE[tag] === "strong" && /^(normal|[1-4]00)$/.test(node.style?.fontWeight || "");
        if (!plain) el = doc.createElement(INLINE[tag]);
      } else if (tag === "th" || tag === "td") {
        el = doc.createElement(tag);
        const align = (node.style?.textAlign || node.getAttribute("align") || "").toLowerCase();
        if (/^(left|center|right)$/.test(align)) el.style.textAlign = align;
      } else if (SAME.test(tag)) {
        el = doc.createElement(tag);
        if (tag === "ol" && node.hasAttribute("start")) el.setAttribute("start", node.getAttribute("start"));
        if (tag === "li") {
          const box = node.querySelector(":scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox], :scope > label > input[type=checkbox]");
          if (box) el.setAttribute("data-task", box.checked || box.hasAttribute("checked") ? "x" : " ");
        }
      } else if (BLOCKISH.test(tag)) el = doc.createElement("div");
      if (el) { reduce(node, el, doc); dst.appendChild(el); } else reduce(node, dst, doc);
    }
  }
  function clean(html) {
    const from = new DOMParser().parseFromString(html, "text/html");
    const out = document.implementation.createHTMLDocument("");
    reduce(from.body, out.body, out);
    return out.body.innerHTML;
  }
  const STRUCTURE = /<(h[1-6]|p|strong|b|em|i|a|ul|ol|li|table|blockquote|img|code|pre|del|s|hr)[\s>/]/i;
  // HTML that says more than its plain text, and is not this editor's own
  const foreign = (html) => !!html && !/data-pm-slice|data-mdview/.test(html) && STRUCTURE.test(html);

  // ------------------------------------------------------------ Markdown in
  /* Markdown -> blocks. They keep their text as written: its segments join the document's. */
  function blocksOf(state, text) {
    const d = A.edit.docOf(state), store = d.store;
    const lf = text.replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "");
    const other = A.document.open({ text: lf, raw: lf, links: store.env.links, vault: store.vault }, {
      references: store.env.references, footnotes: store.env.footnotes && store.env.footnotes.refs, abbreviations: store.env.abbreviations,
    });
    const base = A.store.adopt(store, other.store);
    const nodes = [];
    other.doc.forEach((n) => {
      if (n.type === N.island && (n.attrs.virtual || n.attrs.kind === "frontmatter")) return;
      const node = n.attrs.bid == null ? n : n.type.create({ ...n.attrs, bid: base + n.attrs.bid, line: null }, n.content, n.marks);
      if (node.attrs.bid != null) d.loaded.set(node.attrs.bid, node);
      nodes.push(node);
    });
    return nodes;
  }
  function insertMarkdown(view, text) {
    const state = view.state, { $from } = state.selection;
    let nodes = blocksOf(state, text);
    // A picture put into a line that has text stays in the line (alone, a picture is a block of
    // its own: read with a letter before it, it is a picture in a line, and the letter goes again).
    if ($from.parent.inlineContent && $from.parent.content.size && /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(text)) {
      const para = blocksOf(state, "x" + text.trim()).find((n) => n.type === N.paragraph);
      if (para && para.content.size > 1) nodes = [para.copy(para.content.cut(1))];
    }
    if (!nodes.length) return true;
    const tr = state.tr;
    const visible = nodes.filter((n) => n.type !== N.hidden);
    // a cell holds one line of text
    if ($from.parent.type === N.table_cell && !(visible.length === 1 && visible[0].type === N.paragraph)) return insertPlain(view, text);
    if (visible.length === 1 && visible[0].type === N.paragraph && $from.parent.inlineContent) {
      // a line of text into a line of text; what it defines goes behind the block
      // (Markdown drops the spaces around a paragraph; between words they are meant)
      const space = (on) => (on ? [state.schema.text(" ", $from.marks())] : []);
      const content = Fragment.from([...space(/^[ \t]+\S/.test(text)), ...visible[0].content.content, ...space(/\S[ \t]+\n*$/.test(text))]);
      tr.replaceSelection(new Slice(content, 0, 0));
      const hidden = nodes.filter((n) => n.type === N.hidden);
      if (hidden.length) tr.insert(tr.doc.resolve(tr.selection.from).after(1), hidden);
    } else if ($from.parent.type === N.paragraph && !$from.parent.content.size && $from.depth === 1) {
      tr.replaceWith($from.before(), $from.after(), nodes);
      tr.setSelection(PM.state.Selection.near(tr.doc.resolve(Math.min($from.before() + Fragment.from(nodes).size, tr.doc.content.size)), -1));
    } else tr.replaceSelection(Slice.maxOpen(Fragment.from(nodes)));
    view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
    hydrate(view.dom);
    return true;
  }
  // text that stays text: nothing in it is read as Markdown
  function insertPlain(view, text) {
    const state = view.state, { $from } = state.selection;
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
    const tr = state.tr;
    if (lines.length === 1 || M.code.isInSet(state.storedMarks || $from.marks()) || !$from.parent.inlineContent || $from.parent.type === N.table_cell) {
      tr.insertText(lines.length === 1 ? lines[0] : lines.filter((l) => l.trim()).join(" "));
    } else {
      const paras = lines.filter((l) => l.trim()).map((l) => N.paragraph.create(null, state.schema.text(l)));
      if (!paras.length) return true;
      tr.replaceSelection(new Slice(Fragment.from(paras), 1, 1));
    }
    view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
    return true;
  }
  const ADDRESS = /^(?:https?:\/\/|mailto:)\S+$/i;

  // ------------------------------------------------------------ Markdown out
  /* The Markdown of a slice. Whole blocks that were not changed are their text in the file. */
  function markdownOf(state, slice) {
    const d = A.edit.docOf(state);
    let content = slice.content, open = Math.min(slice.openStart, slice.openEnd), parent = null;
    if (!content.childCount) return "";
    // inside one block: what is selected of it, not the block around it
    while (open > 0 && content.childCount === 1 && !content.firstChild.isLeaf) { parent = content.firstChild; content = parent.content; open--; }
    if (parent && /^(list_item|table_row|table_cell)$/.test(content.firstChild.type.name) && parent.type !== N.table_row) content = Fragment.from(parent); // several items, several rows
    const first = content.firstChild;
    if (first.isInline) content = Fragment.from(N.paragraph.create(null, content));
    else if (first.type === N.list_item) content = Fragment.from(N.bullet_list.create(null, content));
    else if (first.type === N.table_row) content = Fragment.from(N.table.create(null, content));
    else if (first.type === N.table_cell) { // cells: their text, tab between
      const out = [];
      content.forEach((cell) => out.push(cell.textContent));
      return out.join("\t");
    }
    let doc;
    try { doc = state.schema.topNodeType.createChecked(null, content); } catch (_e) { return slice.content.textBetween(0, slice.content.size, "\n\n"); }
    // a block cut open by the selection is not the block that was loaded (it is written by what it holds)
    return A.document.serialize({ ...d, store: { ...d.store, head: { raw: "", orig: "" } } }, doc, false).replace(/^\n+|\s+$/g, "");
  }
  // HTML as the page shows it: islands and formulas with what they render
  const base = DOMSerializer.fromSchema(A.schema);
  const serializer = new DOMSerializer({
    ...base.nodes,
    island: (n) => { const div = document.createElement("div"); div.innerHTML = n.attrs.html; return div; },
    hidden: () => document.createElement("span"),
    iatom: (n) => { const span = document.createElement("span"); span.innerHTML = n.attrs.html; return span; },
  }, base.marks);

  /* What is on the clipboard, into the document (from a paste event, or handed over by the application
   * for the menu's Paste). -> false: the editor reads the HTML itself. */
  function pasteData(view, text, html) {
    const { $from, empty } = view.state.selection;
    if (!text && !foreign(html)) {
      // a picture: the application saves it beside the note and answers with its Markdown (MdView.insertImage)
      if (A.view.payload && A.view.payload.path) post("pasteimage", { path: A.view.payload.path });
      return true;
    }
    if (M.code.isInSet(view.state.storedMarks || $from.marks())) return insertPlain(view, text);
    if (!empty && ADDRESS.test(text.trim()) && $from.sameParent(view.state.selection.$to) && $from.parent.inlineContent) {
      const href = text.trim(), { from, to } = view.state.selection;
      view.dispatch(view.state.tr.removeMark(from, to, M.link).addMark(from, to, M.link.create({ href, cls: isExternal(href) ? "external" : null })).setMeta("paste", true));
      return true;
    }
    if (foreign(html)) {
      if ($from.parent.type === N.table_cell) return insertPlain(view, text); // a cell holds one line of text
      return false; // the editor reads the reduced HTML with the schema's own rules
    }
    return insertMarkdown(view, text);
  }
  // from the application (MdView.pasteClip)
  function pasteFrom(view, text, html) {
    if (!view.editable) return;
    view.focus();
    if (!pasteData(view, text || "", html || "")) view.pasteHTML(html);
  }

  const plugin = new Plugin({
    key: new PluginKey("clip"),
    props: {
      clipboardSerializer: serializer,
      clipboardTextSerializer: (slice, view) => markdownOf(view.state, slice),
      transformPastedHTML: (html) => (foreign(html) ? clean(html) : html),
      handleKeyDown(view, e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "v") {
          // the page cannot read the clipboard by itself: the application hands the text over (MdView.pasteText)
          e.preventDefault();
          post("pastetext");
          return true;
        }
        return false;
      },
      // files dropped from elsewhere: the application keeps them beside the note (or finds them there) and answers
      // (insertDropped) — a picture as a picture, any other file as a block that names it
      handleDrop(view, event) {
        if (view.dragging || !view.editable) return false;
        const dt = event.dataTransfer;
        const uris = (dt && dt.getData("text/uri-list") || "").split(/\r?\n/).filter((u) => /^file:/.test(u.trim())).map((u) => u.trim());
        // (in a browser there are no addresses, only the files themselves: a host that takes them says so with MdHost.drop)
        const files = !uris.length && dt && dt.files && dt.files.length && window.MdHost && window.MdHost.drop ? [...dt.files] : [];
        if (!uris.length && !files.length) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (at) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
        view.focus();
        if (!(A.view.payload && A.view.payload.path)) return true;
        if (files.length) window.MdHost.drop(files, A.view.payload.path); else post("dropfiles", { uris, path: A.view.payload.path });
        return true;
      },
      handlePaste(view, event) {
        const cd = event.clipboardData;
        if (!cd || !view.editable) return false;
        // files on the clipboard — a picture copied, a screenshot — and no text beside them: a host
        // that takes files gets them as they are (in a browser they are in this event, and nowhere
        // else without asking the user for the clipboard)
        const files = window.MdHost && window.MdHost.drop && !cd.getData("text/plain").trim() ? [...(cd.files || [])] : [];
        if (files.length && A.view.payload && A.view.payload.path) { window.MdHost.drop(files, A.view.payload.path, { pasted: true }); return true; }
        return pasteData(view, cd.getData("text/plain"), cd.getData("text/html"));
      },
    },
  });

  // what the application made of dropped files: their Markdown, where they were dropped
  function insertDropped(view, markups) {
    if (!view.editable || !markups.length) return;
    // (pictures stand in a row, in the text; a file is a block of its own — below the block it was
    // dropped in, not in its text, where it would be a link in a line)
    if (markups.every((m) => m.startsWith("!"))) return insertMarkdown(view, markups.join(" "));
    const state = view.state, { $from } = state.selection, nodes = blocksOf(state, markups.join("\n\n"));
    if (!nodes.length) return;
    if ($from.depth < 1 || !$from.parent.inlineContent || !$from.parent.content.size) return insertMarkdown(view, markups.join("\n\n")); // (an empty line: in its place)
    const at = $from.after(), tr = state.tr.insert(at, nodes);
    view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(at + nodes.reduce((n, x) => n + x.nodeSize, 0), tr.doc.content.size)), -1)).setMeta("step", true).scrollIntoView());
  }
  A.clip = { insertDropped, plugin, clean, foreign, insertMarkdown, insertPlain, markdownOf, blocksOf, pasteFrom };
})();
