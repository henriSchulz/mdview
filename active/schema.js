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
  const { md, renderProps, isExternal } = window.MdView.core;
  const { Schema, Node } = PM.model;

  const line = { default: null };
  const lineAttr = (node) => (node.attrs.line == null ? {} : { "data-line": node.attrs.line });
  const block = (spec) => ({ group: "block", ...spec, attrs: { bid: { default: null }, line, ...spec.attrs } });

  const nodes = {
    doc: { content: "block+" },
    paragraph: block({
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: (n) => ["p", lineAttr(n), 0],
    }),
    heading: block({
      content: "inline*",
      defining: true,
      attrs: { level: { default: 1 }, id: { default: null }, markup: { default: "#" } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: "h" + level, attrs: { level } })),
      toDOM: (n) => ["h" + n.attrs.level, { ...(n.attrs.id ? { id: n.attrs.id } : {}), ...lineAttr(n) }, 0],
    }),
    horizontal_rule: block({
      attrs: { markup: { default: "---" } },
      parseDOM: [{ tag: "hr" }],
      toDOM: (n) => ["hr", lineAttr(n)],
    }),
    blockquote: block({
      content: "block+",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: (n) => ["blockquote", lineAttr(n), 0],
    }),
    bullet_list: block({
      content: "list_item+",
      attrs: { tight: { default: true }, tasks: { default: false }, markup: { default: "-" } },
      parseDOM: [{ tag: "ul" }],
      toDOM: (n) => ["ul", { ...listAttrs(n), ...lineAttr(n) }, 0],
    }),
    ordered_list: block({
      content: "list_item+",
      attrs: { tight: { default: true }, tasks: { default: false }, markup: { default: "." }, start: { default: 1 } },
      parseDOM: [{ tag: "ol", getAttrs: (dom) => ({ start: dom.hasAttribute("start") ? Number(dom.getAttribute("start")) : 1 }) }],
      toDOM: (n) => ["ol", { ...(n.attrs.start === 1 ? {} : { start: n.attrs.start }), ...listAttrs(n), ...lineAttr(n) }, 0],
    }),
    list_item: {
      content: "block+",
      defining: true,
      // task: null, or the character between the brackets; box: this node draws the checkbox
      attrs: { bid: { default: null }, line, markup: { default: "-" }, task: { default: null }, box: { default: true }, boxLine: { default: null } },
      parseDOM: [{ tag: "li" }],
      toDOM(n) {
        const { task, box, boxLine } = n.attrs;
        if (task == null) return ["li", lineAttr(n), 0];
        const checked = task !== " ";
        const attrs = { class: "task-item" + (checked ? " is-checked" : ""), ...(/[ xX]/.test(task) ? {} : { "data-task": task }), ...lineAttr(n) };
        if (!box) return ["li", attrs, 0];
        const input = { type: "checkbox", class: "task", contenteditable: "false", ...(checked ? { checked: "" } : {}),
          ...(boxLine == null || boxLine < 0 ? { disabled: "" } : { "data-line": boxLine }) };
        return ["li", attrs, ["input", input], ["div", { class: "li-body" }, 0]];
      },
    },
    // rendered by the reading view's renderer, edited in a dialog
    island: block({
      atom: true,
      selectable: true,
      attrs: { kind: { default: "other" }, html: { default: "" }, virtual: { default: false } },
      toDOM: () => ["div", { class: "isl" }],
    }),
    // source lines without output of their own (definitions); kept in place, never shown
    hidden: block({
      atom: true,
      selectable: false,
      toDOM: () => ["div", { class: "hid", hidden: "" }],
    }),
    text: { group: "inline" },
    image: {
      group: "inline", inline: true, atom: true,
      attrs: { src: { default: "" }, alt: { default: "" }, title: { default: null } },
      parseDOM: [{ tag: "img[src]", getAttrs: (dom) => ({ src: dom.getAttribute("src"), alt: dom.getAttribute("alt") || "", title: dom.getAttribute("title") }) }],
      toDOM: (n) => ["img", { src: n.attrs.src, alt: n.attrs.alt, ...(n.attrs.title == null ? {} : { title: n.attrs.title }) }],
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
      attrs: { kind: { default: "other" }, html: { default: "" }, src: { default: "" } },
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
      attrs: { href: { default: "" }, title: { default: null }, cls: { default: null }, markup: { default: "" } },
      parseDOM: [{ tag: "a[href]", getAttrs: (dom) => ({ href: dom.getAttribute("href"), title: dom.getAttribute("title") }) }],
      toDOM: (m) => ["a", { href: m.attrs.href, ...(m.attrs.title == null ? {} : { title: m.attrs.title }), ...(m.attrs.cls ? { class: m.attrs.cls } : {}) }, 0],
    },
    code: { code: true, attrs: { markup: { default: "`" } }, parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
    strong: simple("strong", { attrs: { markup: { default: "**" } } }),
    em: simple("em", { attrs: { markup: { default: "*" } } }),
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

  function build(store) {
    const env = store.env;
    const html = (toks) => md.renderer.render(toks, md.options, env);
    const island = (kind, toks, attrs = {}) => ({ type: "island", attrs: { kind, html: html(toks), line: lineOf(toks[0]), ...attrs } });

    function inlineOf(tok) {
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
      const atom = (kind, c) => {
        const html = md.renderer.renderInline([c], md.options, env), before = seen;
        leaf({ type: "iatom", attrs: { kind, html, src: c.content || "" } });
        // a formula that only defines a macro draws nothing
        seen = before || /<(img|svg)\b/.test(html) || /\S/.test(html.replace(/<[^>]*>/g, ""));
      };
      for (const c of tok.children || []) {
        const open = /^(.+)_open$/.exec(c.type), close = /^(.+)_close$/.exec(c.type);
        if (open && MARK_OF[open[1]]) {
          const type = MARK_OF[open[1]];
          const attrs = type === "link" ? { href: c.attrGet("href") || "", title: c.attrGet("title"), cls: linkClass(c), markup: c.markup || "" }
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
            text(c.content, [{ type: "code", attrs: { markup: c.markup } }]);
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
            atom("math", c);
            break;
          case "wikilink": atom("wikilink", c); break;
          case "footnote_ref": atom("footnote", c); break;
          case "task_checkbox": break; // drawn by the list item
          default: throw new Unsupported(c.type);
        }
      }
      // A block with nothing to see has no height in the reading view (and the
      // margins around it fall together); a text block in the editor always has a line.
      if (!seen) throw new Unsupported("nothing to see");
      const last = out[out.length - 1]; // a block does not end in a space
      if (last && last.type === "text" && last.text.endsWith(" ")) {
        if (last.text.length > 1) last.text = last.text.slice(0, -1);
        else out.pop();
      }
      return out;
    }

    function blocksOf(toks) {
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
              out.push({ type: "heading", attrs: { ...attrs, level: Number(t.tag.slice(1)), id: t.attrGet("id"), markup: t.markup }, content: inlineOf(inner[0]) });
              break;
            case "hr":
              out.push({ type: "horizontal_rule", attrs: { ...attrs, markup: t.markup } });
              break;
            case "blockquote_open":
              if (t.tag !== "blockquote") throw new Unsupported("callout");
              if (!inner.length) throw new Unsupported("empty quote");
              out.push({ type: "blockquote", attrs, content: blocksOf(inner) });
              break;
            case "bullet_list_open":
            case "ordered_list_open":
              out.push(listOf(t, inner, attrs));
              break;
            default:
              throw new Unsupported(t.type);
          }
        } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          out.push(island(A.store.typeOf(t), group));
        }
        i = j;
      }
      return out;
    }
    const orParagraph = (blocks) => (blocks.length ? blocks : [{ type: "paragraph" }]);

    function listOf(t, inner, attrs) {
      const items = [];
      let tight = false;
      for (let i = 0; i < inner.length; i++) {
        const li = inner[i], j = closeIndex(inner, i);
        const body = inner.slice(i + 1, j);
        if (body.some((x, k) => x.type === "paragraph_open" && x.hidden && closeDepth(body, k) === 0)) tight = true;
        const first = body[0] && body[0].type === "paragraph_open" ? body[1] : null;
        const cb = first && first.children && first.children[0] && first.children[0].type === "task_checkbox" ? first.children[0] : null;
        const content = orParagraph(blocksOf(body));
        items.push({ type: "list_item", content, attrs: {
          line: lineOf(li), markup: li.markup,
          task: cb ? cb.meta.ch : null, boxLine: cb ? cb.meta.line : null,
          // a first paragraph that became an island draws its own checkbox
          box: !(cb && content[0].type === "island"),
        } });
        i = j;
      }
      const ordered = t.type === "ordered_list_open";
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
      if (seg.kind === "hidden") node = { type: "hidden" };
      else if (seg.type === "frontmatter") node = { type: "island", attrs: { kind: "frontmatter", html: renderProps(seg.props, { links: env.links, depth: 1 }), line: 0 } };
      else {
        const built = seg.type === "html" ? [] : blocksOf(seg.tokens); // html: maybe several blocks under one open element
        node = built.length === 1 ? built[0] : island(seg.type, seg.tokens);
      }
      node.attrs = { ...node.attrs, bid: seg.id };
      blocks.push(node);
    }
    for (const g of store.virtual) blocks.push(island(g.type, g.tokens, { virtual: true }));
    return Node.fromJSON(schema, { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] });
  }

  A.schema = schema;
  A.build = build;
})();
