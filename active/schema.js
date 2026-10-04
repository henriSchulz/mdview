/* mdview active mode — ProseMirror schema and the builder that turns the
 * store's markdown-it tokens into a document.
 *
 * The document has to look exactly like the reading view, so:
 * - text blocks use the tags and classes the markdown-it renderer emits;
 * - whatever is not edited inline is an "island": an atom whose HTML comes
 *   from the reading view's own renderer;
 * - the text in the model is the text as displayed: a run of spaces or a
 *   soft line break is one space, an emoji shortcode is the emoji. The editor
 *   needs `white-space: pre-wrap` and would show the source's spelling
 *   otherwise. How the source spelled it is not kept in the model (an extra
 *   element around a space moves the text next to it by a fraction of a
 *   pixel); the serializer gets it back from the block's original text.
 * Anything the builder is not sure about becomes an island: better one
 * island too many than a damaged file.
 */
"use strict";
(() => {
  const A = window.MdActive;
  const { md, renderProps, isExternal, slugify, inlineText } = window.MdView.core;
  const { Schema, Node } = PM.model;

  const line = { default: null };
  const lineAttr = (node) => (node.attrs.line == null ? {} : { "data-line": node.attrs.line });
  // a quote as the reading view shows it — and a callout: its title (not typed in) above what it holds
  const quoteDOM = (n) => ["blockquote", { ...lineAttr(n), ...(n.attrs.deco ? { class: "deco " + n.attrs.deco.split("-").map((d) => "deco-" + d).join(" ") + (n.attrs.color ? ` deco-${n.attrs.color}` : "") } : null) }, 0];
  function calloutDOM(n) {
    const C = window.MdView.core, type = n.attrs.callout.toLowerCase();
    const dom = document.createElement("div");
    dom.className = "callout callout-" + C.callout.kind(type);
    dom.setAttribute("data-callout", type);
    if (n.attrs.line != null) dom.setAttribute("data-line", n.attrs.line);
    const title = dom.appendChild(document.createElement("div"));
    title.className = "callout-title";
    title.contentEditable = "false";
    title.innerHTML = `<span class="callout-icon">${C.callout.icon[C.callout.kind(type)]}</span><span class="callout-title-text">${C.md.renderInline(C.callout.title(type, n.attrs.title), { links: {}, outline: [], depth: 1 })}</span>`;
    const content = dom.appendChild(document.createElement("div"));
    content.className = "callout-content";
    return { dom, contentDOM: content };
  }
  const block = (spec) => ({ group: "block", ...spec, attrs: { bid: { default: null }, line, ...spec.attrs } });

  const nodes = {
    doc: { content: "(block | columns)+" },
    paragraph: block({
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: (n) => ["p", lineAttr(n), 0],
    }),
    heading: block({
      content: "inline*",
      defining: true,
      // markup: "#", or "=" / "-" for a heading underlined in the source.
      // slug: what its id is made from, as long as its text is `slugOf` (the id itself is a decoration, see edit.js)
      attrs: { level: { default: 1 }, markup: { default: null }, slug: { default: null }, slugOf: { default: null } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: "h" + level, attrs: { level } })),
      toDOM: (n) => ["h" + n.attrs.level, lineAttr(n), 0],
    }),
    horizontal_rule: block({
      attrs: { markup: { default: null } },
      parseDOM: [{ tag: "hr" }],
      toDOM: (n) => ["hr", lineAttr(n)],
    }),
    blockquote: block({
      content: "block+",
      defining: true,
      // deco: null (a quote), "block", "focus" or "block-focus"; color: null or one of the theme's colours
      // callout: null, or the type of a callout as written ("info", "WARNING"), with its title (null: the type's name)
      attrs: { deco: { default: null }, color: { default: null }, callout: { default: null }, title: { default: null } },
      parseDOM: [{ tag: "div.callout", contentElement: ".callout-content", getAttrs: (dom) => ({ callout: dom.getAttribute("data-callout") || "note" }) }, { tag: "blockquote", getAttrs: (dom) => {
        const deco = ["block", "focus"].filter((d) => dom.classList.contains("deco-" + d)).join("-") || null, color = /\bdeco-(red|orange|yellow|green|cyan|blue|magenta)\b/.exec(dom.className);
        return { deco, color: deco && color ? color[1] : null };
      } }],
      toDOM: (n) => (n.attrs.callout ? calloutDOM(n) : quoteDOM(n)),
    }),
    /* Columns: blocks side by side, only among the document's own blocks. A column's width is its
     * share of the row (1 and 1: alike; 2 and 1: two thirds and one). */
    columns: {
      content: "column column+",
      attrs: { bid: { default: null }, line },
      isolating: true,
      parseDOM: [{ tag: "div.cols" }],
      toDOM: (n) => ["div", { class: "cols", ...lineAttr(n) }, 0],
    },
    column: {
      content: "block+",
      attrs: { width: { default: 1 } },
      isolating: true,
      parseDOM: [{ tag: "div.col", getAttrs: (dom) => ({ width: parseFloat(dom.style.getPropertyValue("--w")) || 1 }) }],
      toDOM: (n) => ["div", { class: "col", style: `--w: ${n.attrs.width}` }, 0],
    },
    bullet_list: block({
      content: "list_item+",
      attrs: { tight: { default: true }, tasks: { default: false }, markup: { default: null } },
      parseDOM: [{ tag: "ul" }],
      toDOM: (n) => ["ul", { ...listAttrs(n), ...lineAttr(n) }, 0],
    }),
    ordered_list: block({
      content: "list_item+",
      attrs: { tight: { default: true }, tasks: { default: false }, markup: { default: null }, start: { default: 1 } },
      parseDOM: [{ tag: "ol", getAttrs: (dom) => ({ start: dom.hasAttribute("start") ? Number(dom.getAttribute("start")) : 1 }) }],
      toDOM: (n) => ["ol", { ...(n.attrs.start === 1 ? {} : { start: n.attrs.start }), ...listAttrs(n), ...lineAttr(n) }, 0],
    }),
    list_item: {
      content: "block+",
      defining: true,
      // markup: the bullet as written; num: the number as written (ordered lists);
      // task: null, or the character between the brackets; box: this node draws the checkbox
      attrs: { bid: { default: null }, line, markup: { default: null }, num: { default: null }, task: { default: null }, box: { default: true } },
      parseDOM: [{ tag: "li", getAttrs: (dom) => ({ task: dom.hasAttribute("data-task") ? dom.getAttribute("data-task") : null }) }],
      toDOM(n) {
        const { task, box } = n.attrs;
        if (task == null) return ["li", lineAttr(n), 0];
        const checked = task !== " ";
        const attrs = { class: "task-item" + (checked ? " is-checked" : ""), ...(/[ xX]/.test(task) ? {} : { "data-task": task }), ...lineAttr(n) };
        if (!box) return ["li", attrs, 0];
        return ["li", attrs, ["input", { type: "checkbox", class: "task", contenteditable: "false", tabindex: "-1", ...(checked ? { checked: "" } : {}) }],
          ["div", { class: "li-body" }, 0]];
      },
    },
    /* A table as GFM has it: the first row is the header, a column has one
     * alignment. Rows sit directly in <table> (the editor needs one element
     * for them; active.css stripes them as the reading view's <tbody> rows).
     * raw: its Markdown as loaded, for the way it was formatted. */
    table: block({
      content: "table_row+",
      tableRole: "table",
      isolating: true,
      // wide: as wide as the text column (a line <!-- wide --> before it in the file)
      attrs: { raw: { default: null }, wide: { default: false } },
      parseDOM: [{ tag: "table", getAttrs: (dom) => ({ wide: !!(dom.parentElement && dom.parentElement.classList.contains("wide")) }) }],
      toDOM: (n) => ["div", { class: "table-wrap" + (n.attrs.wide ? " wide" : ""), ...lineAttr(n) }, ["table", 0]],
    }),
    table_row: { content: "table_cell+", tableRole: "row", parseDOM: [{ tag: "tr" }], toDOM: () => ["tr", 0] },
    table_cell: {
      content: "inline*",
      tableRole: "cell",
      isolating: true,
      attrs: { header: { default: false }, align: { default: null }, colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } },
      parseDOM: ["td", "th"].map((tag) => ({ tag, getAttrs: (dom) => ({ header: tag === "th", align: /^(left|center|right)$/.test(dom.style.textAlign) ? dom.style.textAlign : null }) })),
      toDOM: (n) => [n.attrs.header ? "th" : "td", n.attrs.align ? { style: `text-align:${n.attrs.align}` } : {}, 0],
    },
    // rendered by the reading view's renderer, edited in a dialog
    island: block({
      atom: true,
      selectable: true,
      // raw: its Markdown (without the indentation or quote marks of what it sits in)
      attrs: { kind: { default: "other" }, html: { default: "" }, raw: { default: "" }, virtual: { default: false } },
      // (a code block out of pasted HTML: clip.js hands it over as its Markdown)
      parseDOM: [{ tag: "div[data-md-code]", getAttrs(dom) {
        const raw = dom.getAttribute("data-md-code"), made = A.islands.blocksOf(raw, A.view.store || { env: { links: {} }, vault: false }).find((n) => n.type.name === "island");
        return made ? { kind: made.attrs.kind, html: made.attrs.html, raw } : { kind: "code", raw };
      } }],
      toDOM: () => ["div", { class: "isl" }],
    }),
    // source lines without output of their own (definitions); kept in place, never shown
    hidden: block({
      atom: true,
      selectable: false,
      attrs: { raw: { default: "" } },
      toDOM: () => ["div", { class: "hid", hidden: "" }],
    }),
    text: { group: "inline" },
    image: {
      group: "inline", inline: true, atom: true,
      attrs: { src: { default: "" }, alt: { default: "" }, title: { default: null } },
      // (its size is the end of the description — "a tree|300", "a tree|full" — and shows as the reading view shows it)
      parseDOM: [{ tag: "img[src]", getAttrs: (dom) => ({ src: dom.getAttribute("src"), title: dom.getAttribute("title"),
        alt: (dom.getAttribute("alt") || "") + (dom.classList.contains("full") ? "|full" : /^\d+$/.test(dom.getAttribute("width") || "") ? "|" + dom.getAttribute("width") : "") }) }],
      toDOM: (n) => {
        const { alt, size } = window.MdView.core.imageSize(n.attrs.alt);
        return ["img", { src: n.attrs.src, alt, ...(n.attrs.title == null ? {} : { title: n.attrs.title }), ...(size === "full" ? { class: "full" } : size ? { width: size } : {}) }];
      },
    },
    hard_break: {
      group: "inline", inline: true, selectable: false,
      attrs: { soft: { default: false } }, // soft: a plain line break that shows as one (Obsidian vaults)
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
    // inline island: math, wikilink, footnote reference
    iatom: {
      group: "inline", inline: true, atom: true,
      attrs: { kind: { default: "other" }, html: { default: "" }, raw: { default: "" } },
      toDOM: () => ["span", { class: "ia" }],
    },
  };
  const listAttrs = (n) => ({
    ...(n.attrs.tasks ? { class: "contains-task-list" } : {}),
    ...(n.attrs.tight ? { "data-tight": "" } : {}),
  });

  /* Order = nesting, outermost first. Marks that draw a box (highlight, tag,
   * code) stay in one piece when something inside them changes style. */
  const simple = (tag, extra = {}) => ({ parseDOM: [{ tag }], toDOM: () => [tag, 0], ...extra });
  const marks = {
    mark: simple("mark"),
    tag: { inclusive: false, parseDOM: [{ tag: "span.tag" }], toDOM: () => ["span", { class: "tag" }, 0] },
    link: {
      inclusive: false,
      // markup: "autolink" (<url>), "linkify" (a bare url), else ""; ref: label of the definition it uses, if it does
      attrs: { href: { default: "" }, title: { default: null }, cls: { default: null }, markup: { default: "" }, ref: { default: null } },
      parseDOM: [{ tag: "a[href]", getAttrs: (dom) => ({ href: dom.getAttribute("href"), title: dom.getAttribute("title"), cls: isExternal(dom.getAttribute("href")) ? "external" : null }) }],
      toDOM: (m) => ["a", { href: m.attrs.href, ...(m.attrs.title == null ? {} : { title: m.attrs.title }), ...(m.attrs.cls ? { class: m.attrs.cls } : {}) }, 0],
    },
    code: { code: true, parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
    strong: simple("strong", { attrs: { markup: { default: null } } }),
    em: simple("em", { attrs: { markup: { default: null } } }),
    s: simple("s"),
    sub: simple("sub"),
    sup: simple("sup"),
    abbr: { attrs: { title: { default: "" } }, toDOM: (m) => ["abbr", { title: m.attrs.title }, 0] },
  };

  const schema = new Schema({ nodes, marks });

  // ---------------------------------------------------------------- builder
  class Unsupported extends Error {}
  const MARK_OF = { em: "em", strong: "strong", s: "s", mark: "mark", sub: "sub", sup: "sup", link: "link", abbr: "abbr" };
  const SPACES = /[ \t]+/g;

  // the class the reading view's link renderer ends up with
  const linkClass = (t) => {
    const cls = (t.attrGet("class") || "").split(/\s+/).filter((c) => c && c !== "external");
    if (isExternal(t.attrGet("href") || "")) cls.push("external");
    return cls.join(" ") || null;
  };

  function closeIndex(toks, i) {
    let depth = 0;
    for (let j = i; j < toks.length; j++) {
      depth += toks[j].nesting;
      if (depth === 0) return j;
    }
    return toks.length - 1;
  }
  const lineOf = (t) => {
    const v = t.attrGet ? t.attrGet("data-line") : null;
    return v == null ? null : Number(v);
  };

  /* Containers a nested block sits in, outermost first: { quote: true } or
   * { item: true, first: line, width: columns its content is indented by }.
   * strip() takes their marks off a source line, which leaves the block's own text. */
  function strip(text, line, ctx) {
    for (const c of ctx) {
      if (c.quote) text = text.replace(/^ {0,3}>[ \t]?/, "");
      else if (line === c.first) text = text.slice(Math.min(c.width, text.length));
      else text = text.replace(new RegExp(`^(?:\\t| {0,${c.width}})`), "");
    }
    return text;
  }
  function itemContext(head, first) {
    const m = /^(\s*)(?:[-+*]|\d{1,9}[.)])/.exec(head);
    const lead = m ? m[0].length : 0;
    const gap = /^[ \t]*/.exec(head.slice(lead))[0].length;
    return { item: true, first, width: lead + (gap >= 5 || gap === 0 ? 1 : gap) }; // 5 or more spaces: indented code after one
  }

  function build(store) {
    const env = store.env;
    const lines = store.text.split("\n");
    const html = (toks) => md.renderer.render(toks, md.options, env);
    const sourceOf = (toks, ctx) => {
      const map = toks[0].map;
      if (!map) return "";
      const from = map[0] + env.lineOffset;
      let to = Math.min(map[1] + env.lineOffset, lines.length);
      const out = [];
      for (let l = from; l < to; l++) out.push(strip(lines[l], l, ctx));
      while (out.length > 1 && !out[out.length - 1].trim()) out.pop();
      return out.join("\n");
    };
    const island = (kind, toks, ctx, attrs = {}) => ({ type: "island", attrs: { kind, html: html(toks), line: lineOf(toks[0]),
      // code by indentation: its own four spaces are not the container's
      raw: toks[0].type === "code_block" && ctx.length ? toks[0].content.replace(/\n$/, "").replace(/^(?=.)/gm, "    ") : sourceOf(toks, ctx),
      ...attrs } });

    // a link that goes where a definition goes is written as a reference to it
    const refs = Object.entries(env.references || {});
    const refOf = (c) => {
      const href = c.attrGet("href"), title = c.attrGet("title") || undefined;
      const hit = refs.find(([, r]) => r.href === href && (r.title || undefined) === title);
      return hit ? hit[0].toLowerCase() : null;
    };

    function inlineOf(tok, mayBeEmpty = false) {
      const out = [], stack = []; // stack: the marks around the current token, nested ones included
      let marks = [];            // the same without doubles (emphasis inside emphasis is one mark)
      const sync = () => {
        marks = stack.filter((m, k) => stack.findIndex((o) => o.type === m.type) === k).map(({ type, attrs }) => (attrs ? { type, attrs } : { type }));
      };
      const drop = (type) => {
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].type !== type) continue;
          // a mark needs text to sit on; an empty link would silently disappear
          if (stack[k].at === out.length) throw new Unsupported("empty " + type);
          stack.splice(k, 1);
          break;
        }
        sync();
      };
      // Text as displayed: white space collapses as it does in the reading
      // view, also across the edge of a mark ("a [ b](u)" shows one space).
      let spaced = true; // the line so far ends in a space, or is empty
      const text = (str, extra) => {
        const shown = str.replace(SPACES, " ");
        const s = spaced && shown[0] === " " ? shown.slice(1) : shown;
        if (!s) return;
        seen = true;
        out.push({ type: "text", text: s, marks: extra ? marks.concat(extra) : marks.slice() });
        spaced = s[s.length - 1] === " ";
      };
      let seen = false; // something in this block takes up room
      const leaf = (node, breaks) => { out.push({ ...node, marks: marks.slice() }); spaced = !!breaks; seen = true; };
      const atom = (kind, c, raw) => {
        const html = md.renderer.renderInline([c], md.options, env), before = seen;
        leaf({ type: "iatom", attrs: { kind, html, raw } });
        // a formula that only defines a macro draws nothing
        seen = before || /<(img|svg)\b/.test(html) || /\S/.test(html.replace(/<[^>]*>/g, ""));
      };
      for (const c of tok.children || []) {
        const open = /^(.+)_open$/.exec(c.type), close = /^(.+)_close$/.exec(c.type);
        if (open && MARK_OF[open[1]]) {
          const type = MARK_OF[open[1]];
          const attrs = type === "link" ? { href: c.attrGet("href") || "", title: c.attrGet("title"), cls: linkClass(c), markup: c.markup || "", ref: c.markup ? null : refOf(c) }
            : type === "abbr" ? { title: c.attrGet("title") || "" }
            : type === "em" || type === "strong" ? { markup: c.markup } : undefined;
          // nested in itself, emphasis looks the same; a highlight or a subscript does not
          if (/^(mark|sub|sup)$/.test(type) && stack.some((m) => m.type === type)) throw new Unsupported("nested " + type);
          stack.push({ type, attrs, at: out.length });
          sync();
          continue;
        }
        if (close && MARK_OF[close[1]]) { drop(MARK_OF[close[1]]); continue; }
        switch (c.type) {
          case "text": text(c.content); break;
          case "code_inline":
            if (!c.content.trim()) throw new Unsupported("empty code span");
            text(c.content, [{ type: "code" }]);
            break;
          case "softbreak":
            if (md.options.breaks) leaf({ type: "hard_break", attrs: { soft: true } }, true);
            else text(" ");
            break;
          case "hardbreak": leaf({ type: "hard_break" }, true); break;
          case "image":
            leaf({ type: "image", attrs: {
              src: c.attrGet("src") || "", title: c.attrGet("title"),
              alt: md.renderer.renderInlineAsText(c.children || [], md.options, env) } });
            break;
          case "tag": text("#" + c.content, [{ type: "tag" }]); break;
          case "emoji": text(c.content); break;
          case "math_inline":
            // $$…$$ inside a line is a block of its own there; the spaces around it would show
            if (c.meta && c.meta.display) throw new Unsupported("display math in a line");
            atom("math", c, "$" + c.content + "$");
            break;
          case "wikilink": atom("wikilink", c, "[[" + c.meta.target + (c.meta.alias == null ? "" : "|" + c.meta.alias) + "]]"); break;
          case "footnote_ref":
            if (c.meta.label == null) throw new Unsupported("inline footnote");
            atom("footnote", c, "[^" + c.meta.label + "]");
            break;
          case "task_checkbox": break; // drawn by the list item
          case "html_inline":
            // An HTML tag that stands by itself (a line break in a table cell, a comment, a picture) is
            // an atom of its own; one that opens or closes an element would cut what it wraps apart.
            if (/^<(br|wbr)\s*\/?>$/i.test(c.content) || /^<!--[\s\S]*-->$/.test(c.content) || /^<img\b[^>]*>$/i.test(c.content)) { atom("html", c, c.content); break; }
            throw new Unsupported("inline HTML");
          default: throw new Unsupported(c.type);
        }
      }
      // A block with nothing to see has no height in the reading view (and the
      // margins around it fall together); a text block in the editor always has a line.
      // A task without text yet is the exception: it has to stay a task one can type into.
      const emptyTask = out.length === 0 && (tok.children || []).length === 1 && tok.children[0].type === "task_checkbox";
      if (!seen && !emptyTask && !mayBeEmpty) throw new Unsupported("nothing to see");
      const last = out[out.length - 1]; // a block does not end in a space
      if (last && last.type === "text" && last.text.endsWith(" ")) {
        if (last.text.length > 1) last.text = last.text.slice(0, -1);
        else out.pop();
      }
      return out;
    }

    function blocksOf(toks, ctx) {
      const out = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i], j = closeIndex(toks, i);
        const group = toks.slice(i, j + 1), inner = toks.slice(i + 1, j);
        const attrs = { line: lineOf(t) };
        try {
          switch (t.type) {
            case "paragraph_open":
              out.push({ type: "paragraph", attrs, content: inlineOf(inner[0]) });
              break;
            case "heading_open":
              out.push(headingOf(t, inner[0], attrs));
              break;
            case "hr":
              out.push({ type: "horizontal_rule", attrs: { ...attrs, markup: t.markup } });
              break;
            case "blockquote_open":
              if (t.tag !== "blockquote") { // a callout: edited in place when it is a plain one with something in it
                const c = t.meta && t.meta.callout, b0 = inner.findIndex((x) => x.type === "callout_body_open");
                const body = b0 < 0 ? [] : inner.slice(b0 + 1, inner.length - 1);
                if (!c || c.fold || c.meta || t.tag !== "div" || !body.length) throw new Unsupported("callout");
                out.push({ type: "blockquote", attrs: { ...attrs, callout: c.type, title: c.title || null }, content: blocksOf(body, ctx.concat({ quote: true })) });
                break;
              }
              if (!inner.length) throw new Unsupported("empty quote");
              out.push({ type: "blockquote", attrs: { ...attrs, deco: (t.meta && t.meta.deco) || null, color: (t.meta && t.meta.color) || null }, content: blocksOf(inner, ctx.concat({ quote: true })) });
              break;
            case "columns_open": {
              const cols = [];
              for (let a = 0; a < inner.length; a++) {
                const b = closeIndex(inner, a), made = blocksOf(inner.slice(a + 1, b), ctx);
                cols.push({ type: "column", attrs: { width: (inner[a].meta && inner[a].meta.width) || 1 }, content: made.length ? made : [{ type: "paragraph" }] }); // (a column with nothing in it: a place to type)
                a = b;
              }
              out.push({ type: "columns", attrs, content: cols });
              break;
            }
            case "bullet_list_open":
            case "ordered_list_open":
              out.push(listOf(t, inner, attrs, ctx));
              break;
            case "table_open":
              out.push(tableOf(group, inner, attrs, ctx));
              break;
            default:
              throw new Unsupported(t.type);
          }
        } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          out.push(island(A.store.typeOf(t), group, ctx));
        }
        i = j;
      }
      return out;
    }
    function tableOf(group, inner, attrs, ctx) {
      const rows = [];
      let cells = null;
      for (let i = 0; i < inner.length; i++) {
        const t = inner[i];
        if (t.type === "tr_open") cells = [];
        else if (t.type === "tr_close") rows.push({ type: "table_row", content: cells });
        else if (t.type === "th_open" || t.type === "td_open") {
          const align = /text-align:\s*(left|center|right)/.exec(t.attrGet("style") || "");
          const content = inlineOf(inner[i + 1], true);
          if (content.some((n) => n.type === "hard_break")) throw new Unsupported("line break in a cell");
          cells.push({ type: "table_cell", attrs: { header: t.type === "th_open", align: align ? align[1] : null }, content });
        }
      }
      const width = rows.length ? rows[0].content.length : 0;
      if (!width || rows.some((r) => r.content.length !== width)) throw new Unsupported("ragged table");
      const wide = !!(group[0].meta && group[0].meta.wide), raw = sourceOf(group, ctx);
      return { type: "table", attrs: { ...attrs, wide, raw: wide ? raw.replace(/^[^\n]*\n/, "") : raw }, content: rows }; // (raw: the table's own lines)
    }
    function headingOf(t, inl, attrs) {
      const content = inlineOf(inl);
      const node = Node.fromJSON(schema, { type: "heading", content });
      return { type: "heading", content, attrs: { ...attrs, level: Number(t.tag.slice(1)), markup: t.markup,
        slug: slugify(inlineText(inl.children)) || "section", slugOf: node.textContent } };
    }
    const orParagraph = (blocks) => (blocks.length ? blocks : [{ type: "paragraph" }]);

    function listOf(t, inner, attrs, ctx) {
      const items = [], ordered = t.type === "ordered_list_open";
      let tight = true; // unless a paragraph in it shows as one (markdown-it hides them in a tight list)
      for (let i = 0; i < inner.length; i++) {
        const li = inner[i], j = closeIndex(inner, i);
        const body = inner.slice(i + 1, j);
        if (body.some((x, k) => x.type === "paragraph_open" && !x.hidden && closeDepth(body, k) === 0)) tight = false;
        const first = body[0] && body[0].type === "paragraph_open" ? body[1] : null;
        const cb = first && first.children && first.children[0] && first.children[0].type === "task_checkbox" ? first.children[0] : null;
        const first1 = li.map ? li.map[0] + env.lineOffset : -1;
        const inside = ctx.concat(itemContext(first1 < 0 ? "" : strip(lines[first1] || "", first1, ctx), first1));
        const content = orParagraph(blocksOf(body, inside));
        // a first paragraph that became an island draws its own checkbox, and writes it too
        const own = cb && content[0].type === "island";
        items.push({ type: "list_item", content, attrs: {
          line: lineOf(li), markup: li.markup, num: ordered ? li.info || null : null,
          task: cb ? cb.meta.ch : null, box: !own,
        } });
        i = j;
      }
      return {
        type: ordered ? "ordered_list" : "bullet_list",
        attrs: { ...attrs, tight, markup: t.markup, tasks: /\bcontains-task-list\b/.test(t.attrGet("class") || ""),
          ...(ordered ? { start: t.attrGet("start") == null ? 1 : Number(t.attrGet("start")) } : {}) },
        content: items,
      };
    }
    // nesting depth of token k within toks (0 = direct child)
    function closeDepth(toks, k) {
      let depth = 0;
      for (let i = 0; i < k; i++) depth += toks[i].nesting;
      return depth;
    }

    const blocks = [];
    for (const seg of store.segs) {
      let node;
      // (a line that marks columns but belongs to no row — left over, or typed by hand: it is kept in
      // the file and shown nowhere, like a definition; as a block it could be selected and moved about)
      if (seg.kind === "hidden" || (seg.type === "html" && /^<!--\s*(columns(\s+[\d.:\s]+)?|column|\/columns)\s*-->$/.test(seg.raw.trim()))) node = { type: "hidden" };
      else if (seg.type === "frontmatter") node = { type: "island", attrs: { kind: "frontmatter", html: renderProps(seg.props, { links: env.links, depth: 1 }), line: 0 } };
      else {
        const built = seg.type === "html" ? [] : blocksOf(seg.tokens, []); // html: maybe several blocks under one open element
        node = built.length === 1 ? built[0] : island(seg.type, seg.tokens, []);
      }
      node.attrs = { ...node.attrs, bid: seg.id };
      if (node.type === "island" || node.type === "hidden") node.attrs.raw = seg.raw;
      blocks.push(node);
    }
    for (const g of store.virtual) blocks.push(island(g.type, g.tokens, [], { virtual: true }));
    const doc = Node.fromJSON(schema, { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] });
    // every table cell's own Markdown, kept by the content it was built with (unchanged cells keep that object)
    doc.descendants((node) => {
      if (node.type !== schema.nodes.table) return !node.isTextblock;
      const src = A.tables.cells(node.attrs.raw);
      node.forEach((row, _o, r) => row.forEach((cell, _p, c) => {
        const line = src[r === 0 ? 0 : r + 1];
        if (cell.content.size && line && line[c] != null) A.tables.source.set(cell.content, line[c]);
      }));
      return false;
    });
    return doc;
  }

  A.schema = schema;
  A.build = build;
})();
