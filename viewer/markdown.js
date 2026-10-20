/* mdview, the page — markdown-it as the app sets it up: a note's own HTML made harmless, and the
 * rules for what Markdown alone does not have (callouts, tasks, tags, wikilinks, formulas, fences
 * for diagrams and pictures, tables, columns, files). */
"use strict";
(() => {
  const P = window.MdPage;
  const { T, esc, ICON, fileHref, fileSize, fileExt, PDF_COLORS, DECO_COLORS, CALLOUT_ALIAS, CALLOUT_ICON,
    slugify, inlineText } = P; // viewer/base.js

  const md = window.markdownit({ html: true, linkify: true, typographer: false, breaks: false });
  md.validateLink = (url) => !/^\s*(javascript|vbscript):/i.test(url);
  /* A note's own HTML is shown as it is written — but not what would reach beyond the note: a
   * page that is sent elsewhere at once (meta), styles and style sheets for the whole window,
   * forms, frames, scripts, another base for its addresses. Notes come from shared and synced
   * folders too. (Scripts and handlers are kept out by the page's policy as well; this is the
   * note's side of it.) */
  const BEYOND = "meta|link|base|style|script|form|iframe|frame|frameset|object|embed|applet";
  const safeHtml = (html) => String(html)
    .replace(new RegExp("<(style|script)\\b[\\s\\S]*?(?:<\\/\\1\\s*>|$)", "gi"), "")
    .replace(new RegExp("<\\/?(?:" + BEYOND + ")\\b[^>]*>?", "gi"), "")
    .replace(/(<[^>]*?)\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "$1")
    .replace(/(<[^>]*?\s(?:href|src|action|formaction|xlink:href)\s*=\s*["']?)\s*(?:javascript|vbscript):/gi, "$1#");
  md.renderer.rules.html_inline = (t, i) => safeHtml(t[i].content);
  const plugin = (p) => { if (p) md.use(p.full || p.default || p); };
  [window.markdownitFootnote, window.markdownitDeflist, window.markdownitMark,
    window.markdownitSub, window.markdownitSup, window.markdownitAbbr,
    window.markdownitEmoji].forEach(plugin);
  md.linkify.set({ fuzzyLink: false });

  // --- math ($…$, $$…$$, ```math)
  const tex = (src, display) => {
    try {
      return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: "ignore", output: "html" });
    } catch (e) {
      return `<code class="math-error">${esc(src)}</code>`;
    }
  };
  md.inline.ruler.before("escape", "math_inline", (state, silent) => {
    const s = state.src, pos = state.pos;
    if (s.charCodeAt(pos) !== 0x24) return false;
    const display = s.charCodeAt(pos + 1) === 0x24;
    const delim = display ? "$$" : "$";
    const start = pos + delim.length;
    if (!display) {
      const c = s.charCodeAt(start);
      if (Number.isNaN(c) || c === 0x20 || c === 0x09 || c === 0x0a || c === 0x24) return false;
    }
    let end = start;
    for (;;) {
      end = s.indexOf(delim, end);
      if (end === -1) return false;
      if (s.charCodeAt(end - 1) === 0x5c) { end += 1; continue; }
      if (!display) {
        const prev = s.charCodeAt(end - 1), next = s.charCodeAt(end + 1);
        if (prev === 0x20 || prev === 0x09 || prev === 0x0a) { end += 1; continue; }
        if (next >= 0x30 && next <= 0x39) { end += 1; continue; }
      }
      break;
    }
    if (end === start) return false;
    if (!silent) {
      const t = state.push("math_inline", "math", 0);
      t.content = s.slice(start, end);
      t.meta = { display };
    }
    state.pos = end + delim.length;
    return true;
  });
  md.block.ruler.before("fence", "math_block", (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    if (pos + 2 > max || state.src.slice(pos, pos + 2) !== "$$") return false;
    const first = state.src.slice(pos + 2, max);
    let line = startLine, found = false;
    const lines = [];
    if (first.trim().length >= 2 && first.trim().endsWith("$$")) {
      lines.push(first.trim().slice(0, -2));
      found = true;
    } else {
      lines.push(first);
      for (line = startLine + 1; line < endLine; line++) {
        const p = state.bMarks[line] + state.tShift[line], m = state.eMarks[line];
        if (p < m && state.sCount[line] < state.blkIndent) break;
        const text = state.src.slice(p, m);
        if (text.trim().endsWith("$$")) { lines.push(text.trim().slice(0, -2)); found = true; break; }
        lines.push(text);
      }
    }
    if (!found) return false;
    if (silent) return true;
    const t = state.push("math_block", "math", 0);
    t.block = true;
    t.content = lines.join("\n");
    t.map = [startLine, line + 1];
    state.line = line + 1;
    return true;
  }, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.renderer.rules.math_inline = (t, i) => t[i].meta.display
    ? `<span class="math-display">${tex(t[i].content, true)}</span>`
    : tex(t[i].content, false);
  md.renderer.rules.math_block = (t, i) =>
    `<div class="math-block"${lineAttr(t[i])}>${tex(t[i].content, true)}</div>`;

  // --- wikilinks + embeds
  md.inline.ruler.before("link", "wikilink", (state, silent) => {
    const s = state.src;
    let pos = state.pos, embed = false;
    if (s.charCodeAt(pos) === 0x21 && s.startsWith("[[", pos + 1)) { embed = true; pos += 1; }
    else if (!s.startsWith("[[", pos)) return false;
    const end = s.indexOf("]]", pos + 2);
    if (end < 0) return false;
    const inner = s.slice(pos + 2, end);
    if (!inner.trim() || inner.includes("\n") || inner.includes("[[")) return false;
    if (!silent) {
      const bar = inner.indexOf("|");
      const t = state.push(embed ? "wiki_embed" : "wikilink", "", 0);
      t.meta = {
        target: (bar < 0 ? inner : inner.slice(0, bar)).trim(),
        alias: bar < 0 ? null : inner.slice(bar + 1).trim(),
      };
    }
    state.pos = end + 2;
    return true;
  });
  const wikiLabel = (target) => {
    const [file, ...rest] = target.split("#");
    const sub = rest.join("#").replace(/^\^/, "");
    const name = file.split("/").pop().replace(/\.md$/i, "");
    return name ? (sub ? `${name} › ${sub}` : name) : sub;
  };
  // a link of the note on screen that leads nowhere (written just now, or said to be nowhere): the application is asked —
  // see resolveSoon; never for a note drawn elsewhere (a tile, the sheet beside), whose links are not the note's
  const askWhere = (env, target) => { if (env.links && P.current && env.links === P.current.links) P.resolveSoon(target); };
  md.renderer.rules.wikilink = (t, i, _o, env) => {
    const { target, alias } = t[i].meta;
    const label = esc(alias || wikiLabel(target));
    if (target.startsWith("#")) return `<a class="wikilink" href="#${esc(target.slice(1))}">${label}</a>`;
    const ok = env.links && env.links[target];
    if (!ok) askWhere(env, target);
    return `<a class="wikilink${ok ? "" : " unresolved"}" href="#" data-wiki="${esc(target)}">${label}</a>`;
  };
  const sectionOf = (text, sub) => {
    if (!sub) return text;
    const lines = text.split("\n");
    if (sub.startsWith("^")) {
      const id = sub.slice(1);
      const hit = lines.find((l) => l.trimEnd().endsWith("^" + id));
      return hit ? hit.replace(new RegExp(`\\s*\\^${id}\\s*$`), "") : text;
    }
    const want = slugify(sub);
    let start = -1, level = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
      if (!m) continue;
      if (start < 0 && slugify(m[2]) === want) { start = i; level = m[1].length; continue; }
      if (start >= 0 && m[1].length <= level) return lines.slice(start, i).join("\n");
    }
    return start >= 0 ? lines.slice(start).join("\n") : text;
  };
  md.renderer.rules.wiki_embed = (t, i, _o, env) => {
    const { target, alias } = t[i].meta;
    const info = env.links && env.links[target];
    if (!info) { // (written just now: the application is asked where it points; see linkResolved)
      askWhere(env, target);
      return `<span class="embed-missing" data-wiki="${esc(target)}">${esc(wikiLabel(target))}</span>`;
    }
    // how large: |300 or |300x200 (as Obsidian), |full for the column's whole width; nothing: its own size
    // … and turned: |r90, |r180, |r270 before the size (picTail, below)
    const tail = alias ? picTail("|" + alias) : null, said = tail && !tail.alt ? tail : { size: "", turn: "" };
    const size = /^(\d+)(?:x(\d+))?$/.exec(said.size), full = said.size === "full", turn = said.turn;
    const dims = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ""}` : "";
    const url = esc(info.url);
    switch (info.kind) {
      case "image": return `<img class="embed${full ? " full" : ""}" src="${url}" alt="${esc(size || full || turn ? wikiLabel(target) : alias || wikiLabel(target))}"${dims}${turn ? ` data-turn="${turn}"` : ""}>`;
      case "audio": return `<audio controls src="${url}"></audio>`;
      case "video": return `<video controls src="${url}"${dims}></video>`;
      case "pdf": { // the page, or the part of it the link points to (pdfview.js draws it)
        P.pdfEmbedsSoon();
        const frag = target.includes("#") ? target.slice(target.indexOf("#") + 1) : "";
        return `<span class="pdf-embed${full ? " full" : ""}" data-pdf="${esc(info.path)}" data-frag="${esc(frag)}" data-wiki="${esc(target)}"${size ? ` data-width="${size[1]}"` : ""}${full ? " data-full" : ""} title="${esc(wikiLabel(target))}"></span>`;
      }
      case "text": // a file of text, as code (the host read it: it is one)
        if (info.text == null) break;
        return fileCode(target, alias, info);
      case "md": {
        if ((env.depth || 0) >= 2 || info.text == null) break;
        const sub = target.includes("#") ? target.slice(target.indexOf("#") + 1) : "";
        const body = sectionOf(P.stripFrontmatter(info.text).body, sub);
        const inner = md.render(P.stripComments(body), { links: env.links, depth: (env.depth || 0) + 1 });
        return `<div class="transclusion"><a class="transclusion-head wikilink" href="#" data-wiki="${esc(target)}">${esc(alias || wikiLabel(target))}</a>${inner}</div>`;
      }
    }
    return `<a class="wikilink file" href="#" data-wiki="${esc(target)}">${esc(alias || wikiLabel(target))}</a>`;
  };

  // A Markdown picture says how large it is at the end of its description, as in Obsidian:
  // ![a tree|300](tree.png), ![a tree|full](tree.png). (imageSize: the same, for the active mode's node.)
  // It may be turned too, by quarters, said before the size: ![a tree|r90|300](tree.png), ![[tree.png|r90]] — r90 a quarter to the
  // right, r180 upside down, r270 a quarter to the left. (A reader that knows only the width still finds it at the end.)
  // picTail: "a tree|r90|300" → { alt: "a tree", turn: "90", size: "300" }; picText: the way back.
  const PIC_TAIL = /(?:\|(?:r(?:90|180|270)|\d+(?:x\d+)?|full))+$/i;
  const picTail = (text) => {
    const m = PIC_TAIL.exec(text || ""), out = { alt: m ? text.slice(0, m.index) : text || "", size: "", turn: "" };
    if (m) for (const p of m[0].slice(1).split("|")) { if (/^r/i.test(p)) out.turn = p.slice(1); else out.size = p.toLowerCase(); }
    return out;
  };
  const picText = (alt, turn, size) => (alt || "") + (turn ? "|r" + turn : "") + (size ? "|" + size : "");
  const imageSize = picTail;
  const plainImage = md.renderer.rules.image;
  md.renderer.rules.image = (toks, idx, opts, env, self) => {
    const t = toks[idx], last = t.children && t.children[t.children.length - 1];
    const said = last && last.type === "text" ? picTail(last.content) : null;
    if (said && (said.size || said.turn)) {
      last.content = said.alt;
      const dims = /^(\d+)(?:x(\d+))?$/.exec(said.size);
      if (said.size === "full") t.attrJoin("class", "full"); else if (dims) { t.attrSet("width", dims[1]); if (dims[2]) t.attrSet("height", dims[2]); }
      if (said.turn) t.attrSet("data-turn", said.turn);
    }
    return plainImage(toks, idx, opts, env, self);
  };

  // --- #tags
  md.inline.ruler.after("wikilink", "tag", (state, silent) => {
    const s = state.src, pos = state.pos;
    if (s.charCodeAt(pos) !== 0x23) return false;
    if (pos > 0 && !/[\s(]/.test(s[pos - 1])) return false;
    const m = /^#([\p{L}\p{N}_\-/]+)/u.exec(s.slice(pos));
    if (!m || /^[\d/_-]+$/.test(m[1])) return false;
    if (!silent) state.push("tag", "", 0).content = m[1];
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.tag = (t, i) => `<span class="tag">#${esc(t[i].content)}</span>`;

  // --- callouts (Obsidian + GitHub alerts)
  const calloutKind = (type) => CALLOUT_ALIAS[type] || (CALLOUT_ICON[type] ? type : type === "pdf" && CALLOUT_ICON.quote ? "quote" : "note");
  const calloutTitle = (type, given) => given || (type === "pdf" ? "PDF" : type.charAt(0).toUpperCase() + type.slice(1));
  md.core.ruler.after("block", "callouts", (state) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      const open = toks[i];
      if (open.type !== "blockquote_open") continue;
      const para = toks[i + 1], inl = toks[i + 2];
      if (!para || para.type !== "paragraph_open" || !inl || inl.type !== "inline") continue;
      const [head, ...restLines] = inl.content.split("\n");
      // ([!type|meta]: Obsidian's metadata; a quote copied from a PDF carries its highlight colour there)
      const m = /^\[!([\w-]+)(?:\|([^\]]*))?\]([+-]?)\s*(.*)$/.exec(head.trim());
      if (!m) continue;
      const type = m[1].toLowerCase();
      // a decoration: a quote with a look of its own and no title — [!block], [!focus|red], or both
      // at once, [!block-focus] — and [!indent]: nothing but standing further in (what Tab makes of
      // a block that has no list to go under). It stays a quote.
      if (/^(block|focus|block-focus|focus-block|indent)$/.test(type) && !m[3] && !m[4]) {
        const color = DECO_COLORS.includes((m[2] || "").trim().toLowerCase()) ? m[2].trim().toLowerCase() : null;
        const deco = type.includes("-") ? "block-focus" : type;
        open.attrJoin("class", "deco " + deco.split("-").map((d) => "deco-" + d).join(" ") + (color ? ` deco-${color}` : ""));
        open.meta = { deco, color };
        const rest = restLines.join("\n");
        if (rest.trim()) {
          inl.content = rest;
          if (inl.map) inl.map = [inl.map[0] + 1, inl.map[1]];
          if (para.map) para.map = [para.map[0] + 1, para.map[1]];
        } else toks.splice(i + 1, 3);
        continue;
      }
      const kind = calloutKind(type);
      const fold = m[3];
      open.meta = { callout: { type: m[1], title: m[4] || "", fold: fold || "", meta: m[2] || "" } }; // (as written: what the active mode writes back; fold: "-" folded, "+" open, "" none)
      let depth = 0, j = i;
      for (; j < toks.length; j++) {
        if (toks[j].type === "blockquote_open") depth++;
        else if (toks[j].type === "blockquote_close" && --depth === 0) break;
      }
      const tag = fold ? "details" : "div";
      open.tag = toks[j].tag = tag;
      open.attrJoin("class", `callout callout-${kind}`);
      open.attrSet("data-callout", type);
      if (type === "pdf") open.attrSet("style", `--cc: color-mix(in srgb, ${PDF_COLORS[(m[2] || "").trim().toLowerCase()] || PDF_COLORS.yellow} 72%, var(--fg))`);
      if (fold === "+") open.attrSet("open", "");
      const titleOpen = new state.Token("callout_title_open", fold ? "summary" : "div", 1);
      titleOpen.meta = { kind, fold: !!fold };
      const title = new state.Token("inline", "", 0);
      title.content = calloutTitle(type, m[4]);
      title.children = [];
      title.map = inl.map;
      const titleClose = new state.Token("callout_title_close", fold ? "summary" : "div", -1);
      titleClose.meta = titleOpen.meta;
      const bodyOpen = new state.Token("callout_body_open", "div", 1);
      const bodyClose = new state.Token("callout_body_close", "div", -1);
      toks.splice(j, 0, bodyClose);
      const rest = restLines.join("\n");
      if (rest.trim()) {
        inl.content = rest;
        if (inl.map) inl.map = [inl.map[0] + 1, inl.map[1]];
        if (para.map) para.map = [para.map[0] + 1, para.map[1]];
        toks.splice(i + 1, 0, titleOpen, title, titleClose, bodyOpen);
      } else {
        toks.splice(i + 1, 3, titleOpen, title, titleClose, bodyOpen);
      }
    }
  });
  md.renderer.rules.callout_title_open = (t, i) =>
    `<${t[i].tag} class="callout-title"><span class="callout-icon">${CALLOUT_ICON[t[i].meta.kind]}</span><span class="callout-title-text">`;
  md.renderer.rules.callout_title_close = (t, i) =>
    `</span>${t[i].meta.fold ? `<span class="callout-fold">${ICON.chevron}</span>` : ""}</${t[i].tag}>`;
  md.renderer.rules.callout_body_open = () => '<div class="callout-content">';
  md.renderer.rules.callout_body_close = () => "</div>";

  /* Where a paragraph or a heading stands in its line: a comment at its end says so — "A line <!-- center -->", "<!-- right -->";
   * none: at the left, as text stands. Any other program shows the text and nothing of the comment. The comment is taken out of
   * what the block holds; the block has the class (ta-center, ta-right: viewer/text.css) and says it in its meta (align). */
  const ALIGN = /^<!--\s*(center|right)\s*-->$/;
  const alignMark = (align) => (align === "center" || align === "right" ? ` <!-- ${align} -->` : "");
  md.core.ruler.after("inline", "block_align", (state) => {
    const toks = state.tokens;
    for (let i = 0; i + 1 < toks.length; i++) {
      const t = toks[i], inl = toks[i + 1];
      if ((t.type !== "paragraph_open" && t.type !== "heading_open") || inl.type !== "inline" || !inl.children) continue;
      const kids = inl.children;
      let last = kids.length - 1;
      while (last >= 0 && kids[last].type === "text" && !kids[last].content.trim()) last--;
      const m = last > 0 && kids[last].type === "html_inline" ? ALIGN.exec(kids[last].content) : null; // (a comment alone in its line is a comment, and no line)
      if (!m) continue;
      kids.splice(last);
      if (kids.length && kids[kids.length - 1].type === "text") kids[kids.length - 1].content = kids[kids.length - 1].content.replace(/[ \t]+$/, "");
      inl.content = inl.content.replace(/[ \t]*<!--\s*(?:center|right)\s*-->[ \t]*$/, "");
      t.attrJoin("class", "ta-" + m[1]);
      t.meta = { ...(t.meta || {}), align: m[1] };
    }
  });

  /* A link to a note that stands alone in its paragraph, with a comment behind it that says how it
   * looks — [[Name]] <!-- link row -->, <!-- link card -->, one of the theme's colours after that —
   * is a block of its own: drawn as the line of a page is, opened by a click. Any other program
   * shows the link. (Not in a list: there a link is a line of text.) */
  const LINK_ROW = /^ {0,3}\[\[([^\[\]\n]+)\]\][ \t]*<!--\s*link(?:\s+([a-z]+(?:\s+[a-z]+)?))?\s*-->\s*$/;
  const linkMark = (inner, look) => `[[${inner}]] <!-- link ${[look.style, look.color].filter(Boolean).join(" ")} -->`;
  md.core.ruler.after("inline", "link_rows", (state) => {
    const toks = state.tokens;
    let lists = 0;
    for (let i = 0; i + 2 < toks.length; i++) {
      const t = toks[i];
      if (/^(bullet_list|ordered_list|dl)_(open|close)$/.test(t.type)) lists += t.nesting;
      if (lists || t.type !== "paragraph_open" || t.hidden || toks[i + 1].type !== "inline") continue;
      const kids = (toks[i + 1].children || []).filter((k) => !(k.type === "text" && !k.content.trim()));
      if (kids.length !== 2 || kids[0].type !== "wikilink" || kids[1].type !== "html_inline") continue;
      const m = /^<!--\s*link(?:\s+([a-z]+(?:\s+[a-z]+)?))?\s*-->$/.exec(kids[1].content);
      if (!m) continue;
      const row = new state.Token("link_row", "", 0);
      row.block = true; row.map = t.map; row.level = t.level; row.meta = { ...kids[0].meta, look: m[1] || "" };
      toks.splice(i, 3, row);
    }
  });
  md.renderer.rules.link_row = (t, i, _o, env) => {
    const { target, alias, look: words } = t[i].meta, look = P.pageLook(words), ok = target.startsWith("#") || (env.links && env.links[target]);
    if (!P.LINK_STYLES.includes(look.style)) look.style = "card"; // (what is in another note is not at hand here: no sheet, no widget)
    return `<div class="page-row link-row${ok ? "" : " unresolved"}" data-style="${look.style}"${look.color ? ` data-color="${look.color}" style="--pc: var(--c-${look.color})"` : ""} data-wiki="${esc(target)}" role="link" tabindex="0"><span class="page-row-icon">${ICON.note}</span><span class="page-row-name">${esc(alias || wikiLabel(target))}</span><span class="page-row-go">${ICON.chevron}</span></div>\n`;
  };

  // --- task lists (clickable, written back to the file)
  /* A file block: a paragraph that is nothing but a link to a file beside the note — not a note,
   * not an address elsewhere. It is drawn as a card that names the file; a click opens it, or
   * hands it out. (The active mode marks the same paragraphs: context.js.) */
  md.core.ruler.after("inline", "file_blocks", (state) => {
    const toks = state.tokens;
    for (let i = 0; i + 2 < toks.length; i++) {
      if (toks[i].type !== "paragraph_open" || toks[i + 1].type !== "inline" || toks[i].hidden) continue; // (a tight list's item has no paragraph of its own to draw)
      const kids = (toks[i + 1].children || []).filter((k) => !(k.type === "text" && !k.content));
      // (the link, and in it nothing but its text — which may be in pieces: an escaped character is one of its own)
      if (kids.length < 3 || kids[0].type !== "link_open" || kids[kids.length - 1].type !== "link_close" || !kids.slice(1, -1).every((k) => k.type === "text" || k.type === "text_special")) continue;
      const href = kids[0].attrGet("href");
      if (!fileHref(href)) continue;
      // how large it is drawn stands where a link has its title: "small", "large" (none: medium)
      const size = fileSize(kids[0].attrGet("title"));
      toks[i].attrJoin("class", "file-block" + (size ? " file-" + size : ""));
      toks[i].attrSet("data-ext", fileExt(href));
      // (not a title to show — but the token keeps it: the active mode reads the block's size from it. Taken off
      // the token here, a card set to Large was Medium again once the note was read anew.)
      if (size) kids[0].meta = { ...kids[0].meta, fileSize: size };
    }
  });
  /* A picture alone in its paragraph is a block of its own: it has the line to itself, whatever
   * room is left beside it, and stands in its middle (viewer/*.css: p.pic-block). The same for a
   * picture that is embedded by its name (![[tree.png]]). */
  md.core.ruler.after("inline", "picture_blocks", (state) => {
    const toks = state.tokens, PIC = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i, BOARD = /\.board\.svg$/i;
    for (let i = 0; i + 2 < toks.length; i++) {
      if (toks[i].type !== "paragraph_open" || toks[i + 1].type !== "inline" || toks[i].hidden) continue;
      const kids = (toks[i + 1].children || []).filter((k) => !((k.type === "text" && !k.content.trim()) || k.type === "softbreak"));
      if (kids.length !== 1) continue;
      const k = kids[0];
      if (k.type === "image" || (k.type === "wiki_embed" && PIC.test(String(k.meta.target || "").split("#")[0].trim()))) toks[i].attrJoin("class", "pic-block");
      // … and a whiteboard is a block of its own kind: its picture in a frame, opened by a click (board.js)
      if (BOARD.test(k.type === "image" ? k.attrGet("src") || "" : k.type === "wiki_embed" ? String(k.meta.target || "").split(/[#|]/)[0].trim() : "")) toks[i].attrJoin("class", "board-block");
    }
  });
  /* A caption: a line that begins with ": " right under a picture that stands alone (an embed, a whiteboard, a PDF's page or
   * region), a code block or a formula block — as Pandoc writes a table's caption:
   *
   *   ![](tree.png)            ```js              $$
   *   : A tree in winter       const a = 1;       e^{i\pi} + 1 = 0
   *                            ```                $$
   *                            : The first line   : Euler
   *
   * The two are one figure (<figure>, the caption a <figcaption>, in Markdown of its own). Under a picture the line makes a
   * definition list of the two (markdown-it-deflist: a term, ": " its definition) — that is read as the figure too. Any other
   * program shows the line under the thing. */
  const CAPTION = /^:[ \t]+(?=\S)/;
  md.core.ruler.after("inline", "captions", (state) => {
    const toks = state.tokens, T = state.Token;
    const loneIn = (inl) => { const kids = ((inl && inl.children) || []).filter((k) => !((k.type === "text" && !k.content.trim()) || k.type === "softbreak")); return kids.length === 1 && (kids[0].type === "image" || kids[0].type === "wiki_embed") ? kids[0] : null; };
    const open = (type, tag, map, cls) => { const t = new T(type, tag, 1); t.block = true; t.map = map; if (cls) t.attrSet("class", cls); return t; };
    const close = (type, tag) => { const t = new T(type, tag, -1); t.block = true; return t; };
    const figure = (map, inner, cap) => [open("figure_open", "figure", map, "fig"), ...inner, open("figcaption_open", "figcaption", null), cap, close("figcaption_close", "figcaption"), close("figure_close", "figure")];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      // a definition list of one term, a picture alone, and one definition: the picture and its caption
      if (t.type === "dl_open" && toks[i + 1] && toks[i + 1].type === "dt_open" && toks[i + 3] && toks[i + 3].type === "dt_close" && toks[i + 4] && toks[i + 4].type === "dd_open") {
        const pic = loneIn(toks[i + 2]), p = i + 5, end = p + 4;
        if (!pic || !toks[p] || toks[p].type !== "paragraph_open" || !toks[p + 1] || toks[p + 1].type !== "inline" || !toks[end - 1] || toks[end - 1].type !== "dd_close" || !toks[end] || toks[end].type !== "dl_close") continue;
        const para = open("paragraph_open", "p", t.map); // (a picture's block, a whiteboard's: picture_blocks says which)
        toks.splice(i, end - i + 1, ...figure(t.map, [para, toks[i + 2], close("paragraph_close", "p")], toks[p + 1]));
        continue;
      }
      // a code block, a formula block, a picture alone — and under it a paragraph that begins with ": "
      const lone = t.type === "paragraph_open" && toks[i + 1] && toks[i + 1].type === "inline" && loneIn(toks[i + 1]);
      if (t.type !== "fence" && t.type !== "math_block" && !lone) continue;
      const end = lone ? i + 2 : i, c = end + 1, inl = toks[c + 1];
      if (!toks[c] || toks[c].type !== "paragraph_open" || toks[c].level !== t.level || !inl || inl.type !== "inline" || !CAPTION.test(inl.content)) continue;
      inl.content = inl.content.replace(CAPTION, "");
      const first = (inl.children || [])[0];
      if (first && first.type === "text") first.content = first.content.replace(CAPTION, "");
      const map = t.map && toks[c].map ? [t.map[0], toks[c].map[1]] : t.map;
      toks.splice(i, c + 3 - i, ...figure(map, toks.slice(i, end + 1), inl));
    }
  });
  md.core.ruler.after("inline", "tasks", (state) => {
    const toks = state.tokens, env = state.env;
    for (let i = 2; i < toks.length; i++) {
      const t = toks[i];
      if (t.type !== "inline" || toks[i - 1].type !== "paragraph_open" || toks[i - 2].type !== "list_item_open") continue;
      const m = /^\[([ xX/\-<>?!*])\](?=\s|$)/.exec(t.content);
      const first = t.children[0];
      if (!m || !first || first.type !== "text" || !first.content.startsWith(m[0])) continue;
      first.content = first.content.slice(m[0].length).replace(/^\s/, "");
      const ch = m[1];
      const cb = new state.Token("task_checkbox", "", 0);
      const line = toks[i - 1].map ? toks[i - 1].map[0] + (env.lineOffset || 0) : -1;
      cb.meta = { checked: ch !== " ", ch, line: env.depth ? -1 : line };
      t.children.unshift(cb);
      toks[i - 2].attrJoin("class", "task-item" + (ch !== " " ? " is-checked" : ""));
      if (!/[ xX]/.test(ch)) toks[i - 2].attrSet("data-task", ch);
      for (let k = i - 3; k >= 0; k--) {
        if (toks[k].type === "bullet_list_open" || toks[k].type === "ordered_list_open") {
          if (toks[k].level === toks[i - 2].level - 1) { toks[k].attrJoin("class", "contains-task-list"); break; }
        }
      }
    }
  });
  md.renderer.rules.task_checkbox = (t, i) => {
    const { checked, line } = t[i].meta;
    return `<input type="checkbox" class="task"${checked ? " checked" : ""}${line < 0 ? " disabled" : ` data-line="${line}"`}>`;
  };

  // --- heading ids + outline, source lines for scroll anchoring
  md.core.ruler.push("anchors", (state) => {
    const env = state.env;
    const slugs = env.slugs || (env.slugs = new Map());
    for (let i = 0; i < state.tokens.length; i++) {
      const t = state.tokens[i];
      const block = t.nesting === 1 || (t.nesting === 0 && t.block && t.type !== "inline");
      if (t.map && block && !env.depth) t.attrSet("data-line", t.map[0] + (env.lineOffset || 0));
      if (t.type !== "heading_open") continue;
      const text = inlineText(state.tokens[i + 1].children);
      let slug = slugify(text) || "section";
      const n = slugs.get(slug) || 0;
      slugs.set(slug, n + 1);
      if (n) slug += "-" + n;
      if (env.depth) continue;
      t.attrSet("id", slug);
      env.outline?.push({ level: Number(t.tag.slice(1)), text, slug, line: t.map ? t.map[0] + (env.lineOffset || 0) : 0 });
    }
  });
  const lineAttr = (t) => (t.map && t.attrGet && t.attrGet("data-line") != null ? ` data-line="${t.attrGet("data-line")}"` : "");

  // A fence of SVG is the picture it describes. Its code is parsed as SVG and written out again
  // without what could run (scripts, handlers, foreign content, javascript: links); code that is
  // not one <svg> gives null, and the fence stays code.
  function svgPicture(code) {
    if (!/<svg[\s>]/i.test(code)) return null;
    let root;
    try { root = new DOMParser().parseFromString(code.trim(), "image/svg+xml").documentElement; } catch (e) { return null; }
    if (!root || root.localName !== "svg" || root.getElementsByTagName("parsererror").length) return null;
    for (const el of [...root.querySelectorAll("script, foreignObject, iframe")]) el.remove();
    for (const el of [root, ...root.querySelectorAll("*")]) {
      for (const a of [...el.attributes]) {
        if (/^on/i.test(a.name) || (/^(xlink:)?href$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
      }
    }
    return new XMLSerializer().serializeToString(root);
  }

  // a fence's head line that puts its code away: "<language> hide <title>" → { title, size }, else null
  // (how large its card is drawn, as a file block's: "hide:small", "hide:large" — none: medium)
  function codeHidden(info) {
    const m = /^\S+[ \t]+hide(?::(small|large))?(?:[ \t]+(.*))?$/i.exec(String(info || "").trim());
    return m ? { title: (m[2] || "").trim().replace(/^(["'])(.*)\1$/, "$2"), size: (m[1] || "").toLowerCase() } : null;
  }
  // --- code fences: highlight, copy button, mermaid, math, svg
  md.renderer.rules.fence = (toks, idx) => {
    const t = toks[idx];
    const lang = t.info.trim().split(/\s+/)[0].toLowerCase();
    if (lang === "svg") {
      const svg = svgPicture(t.content);
      if (svg) return `<div class="svg-block"${lineAttr(t)}>${svg}</div>`;
    }
    if (lang === "mermaid") {
      return `<div class="mermaid-block"${lineAttr(t)}><pre class="mermaid">${esc(t.content)}</pre></div>`;
    }
    if (lang === "math") return `<div class="math-block"${lineAttr(t)}>${tex(t.content, true)}</div>`;
    return codeHtml(lang, t.content, codeHidden(t.info), lineAttr(t));
  };
  /* A block of code: highlighted, with its language and Copy. hidden ({ title, size }): put away
   * behind a card — its title, or the code's first line — and a click shows it in a window of its
   * own. from ({ label, html }): the code is a file's (![[main.c]], below): the block says which. */
  function codeHtml(lang, content, hidden, attr, from) {
    let code;
    try {
      code = lang && hljs.getLanguage(lang)
        ? hljs.highlight(content, { language: lang, ignoreIllegals: true }).value
        : esc(content);
    } catch (e) {
      code = esc(content);
    }
    if (hidden) {
      const lines = content.replace(/\n+$/, "").split("\n"), first = lines.find((l) => l.trim()) || "", title = hidden.title || (from ? from.label : "");
      return `<div class="code-block code-hidden${hidden.size ? " code-" + hidden.size : ""}${from ? " code-file" : ""}"${attr}><button class="code-card" type="button" aria-haspopup="dialog">` +
        `<span class="code-card-icon">${ICON.source}</span>` +
        (title ? `<span class="code-card-title">${esc(title)}</span>` : `<span class="code-card-title code-card-peek">${esc(first.trim())}</span>`) +
        (lang ? `<span class="code-lang">${esc(lang)}</span>` : "") + `<span class="code-card-count">${lines.length === 1 ? "1 line" : lines.length + " lines"}</span></button>` +
        `<pre hidden><code class="hljs${lang ? " language-" + esc(lang) : ""}">${code}</code></pre></div>`;
    }
    return `<div class="code-block${from ? " code-file" : ""}"${attr}>${from ? `<div class="code-from">${from.html}</div>` : ""}<div class="code-tools">` +
      (lang ? `<span class="code-lang">${esc(lang)}</span>` : "") +
      `<button class="btn code-copy" type="button" title="${esc(T("Copy code"))}">${esc(T("Copy"))}</button></div>` +
      `<pre><code class="hljs${lang ? " language-" + esc(lang) : ""}">${code}</code></pre></div>`;
  }
  /* A file that is text — source code, a list of files, a log — can stand in a note as the code it
   * is, read from the file each time the note is: ![[main.c]], lines 10 to 20 of it
   * ![[main.c#L10-L20]], put away behind a card ![[main.c|hide]] (with a size and a title as a
   * fence has them: |hide:small The ALU). codeLang: the language its name stands for ("" for
   * plain text), or null where the name does not say that it is text. */
  const TEXT_EXT = /^(txt|text|log|csv|tsv|f|lst|list|cfg|conf|ini|env|toml|lock|tcl|sdc|xdc|ucf|ld|lds|s|asm|vhd|vhdl|sv|svh|v|vh|mk|cmake|proto|tex|bib|srt|vtt|patch|diff|gitignore|editorconfig|properties|gradle|csproj|sln)$/i;
  const codeLang = (path) => {
    const name = String(path || "").split(/[\\/]/).pop().split(/[?#]/)[0], ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : name.toLowerCase();
    return /^(md|markdown|pdf)$/.test(ext) ? null : hljs.getLanguage(ext) ? ext : TEXT_EXT.test(ext) ? "" : null;
  };
  function fileCode(target, alias, info) {
    const sub = target.includes("#") ? target.slice(target.indexOf("#") + 1).trim() : "", range = /^L(\d+)(?:\s*-\s*L?(\d+))?$/i.exec(sub);
    let lines = String(info.text).replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
    const first = range ? Math.max(1, Math.min(lines.length, Number(range[1]))) : 1, last = range ? Math.max(first, Math.min(lines.length, Number(range[2] || range[1]))) : lines.length;
    if (range) lines = lines.slice(first - 1, last);
    const name = String(info.path).split(/[\\/]/).pop(), label = name + (range ? ":" + first + (last > first ? "–" + last : "") : "");
    const how = /^hide(?::(small|large))?(?:\s+(.*))?$/i.exec(alias || "");
    return codeHtml(codeLang(info.path) || "", lines.join("\n") + "\n", how ? { title: (how[2] || "").trim(), size: (how[1] || "").toLowerCase() } : null, "",
      { label, html: `<a class="wikilink file" href="#" data-wiki="${esc(target.split("#")[0])}">${esc(label)}</a>` + (alias && !how ? `<span class="code-from-title">${esc(alias)}</span>` : "") });
  }
  md.renderer.rules.code_block = (toks, idx) =>
    `<div class="code-block"${lineAttr(toks[idx])}><div class="code-tools"><button class="btn code-copy" type="button" title="${esc(T("Copy code"))}">${esc(T("Copy"))}</button></div><pre><code class="hljs">${esc(toks[idx].content)}</code></pre></div>`;
  /* How a table looks is said by a line before it, a comment no renderer shows:
   *     <!-- table narrow head=#cfeefc -->
   * narrow: as wide as what it holds (else as wide as the text column, which is how a table stands
   * when nothing is said); head=…: its head row in a colour — one of the theme's by name (blue,
   * green …) or any colour written as #rgb / #rrggbb. (<!-- wide -->, the line of before, is read
   * as it was: a table as wide as the column.) cols=30,20,50: how wide its columns are, as shares of the table in percent — set by
   * pulling the line between two columns in the active mode (active/tableui.js); a table with them is as wide as the column.
   * tableLook: that line, read → { wide, head, cols };
   * tableMark: the line for a look, or "" where none is needed; tableStyle: a head colour as CSS. */
  const TABLE_MARK = /^<!--\s*(wide|table(?:\s+[^>]*?)?)\s*-->\s*$/;
  const headColor = (v) => { v = String(v || "").trim().toLowerCase(); return DECO_COLORS.includes(v) || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(v) ? v : ""; };
  function tableLook(line) {
    const m = TABLE_MARK.exec(String(line || "").trim());
    if (!m) return null;
    const words = m[1].split(/\s+/).slice(1), head = words.map((w) => /^head=(.+)$/i.exec(w)).find(Boolean);
    const cols = colsOf((words.map((w) => /^cols=(.+)$/i.exec(w)).find(Boolean) || [])[1]);
    return { wide: !cols && !words.some((w) => /^narrow$/i.test(w)) || !!cols, head: head ? headColor(head[1]) : "", cols };
  }
  // "30,20,50" → [30, 20, 50]: two or more shares, each a whole number from 1 to 100 (anything else: none)
  const colsOf = (v) => { const a = String(v || "").split(",").map((x) => Number(x.trim())); return a.length > 1 && a.every((x) => Number.isInteger(x) && x >= 1 && x <= 100) ? a : null; };
  const tableMark = (look) => (look.wide !== false && !look.head && !look.cols ? "" : `<!-- table${look.wide === false && !look.cols ? " narrow" : ""}${look.head ? " head=" + look.head : ""}${look.cols ? " cols=" + look.cols.join(",") : ""} -->`);
  function tableStyle(head) {
    head = headColor(head);
    if (!head) return "";
    if (!head.startsWith("#")) return `--th: color-mix(in srgb, var(--c-${head}) 24%, var(--bg));`;
    // (a colour of one's own: its text in black or white, whichever is read on it)
    const h = head.length === 4 ? [...head.slice(1)].map((c) => c + c).join("") : head.slice(1), [r, g, b] = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16));
    return `--th: ${head}; --th-ink: ${0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1d1d1f" : "#fff"};`;
  }
  md.renderer.rules.table_open = (t, i, o, _e, self) => {
    const look = t[i].meta || {}, style = tableStyle(look.head);
    if (look.cols) t[i].attrSet("class", "has-cols"); // (its columns as wide as said: a table of fixed layout, as wide as the column)
    return `<div class="table-wrap${look.wide === false ? "" : " wide"}"${style ? ` style="${style}"` : ""}>` + self.renderToken(t, i, o) + (look.cols ? `<colgroup>${look.cols.map((c) => `<col style="width:${c}%">`).join("")}</colgroup>` : "");
  };
  /* Columns: blocks side by side. In the file they stand one under the other, between comment
   * lines no renderer shows — elsewhere the text simply reads top to bottom:
   *     <!-- columns 2:1 -->      (the widths, as a ratio; without it all are alike)
   *     …blocks…
   *     <!-- column -->
   *     …blocks…
   *     <!-- /columns -->
   * Only among the document's own blocks (not in a list or a quote), and not inside each other. */
  const COLS = /^<!--\s*columns(?:\s+(\d+(?:\.\d+)?(?:\s*:\s*\d+(?:\.\d+)?)*))?\s*-->$/, COL = /^<!--\s*column\s*-->$/, COLS_END = /^<!--\s*\/columns\s*-->$/;
  md.core.ruler.after("block", "columns", (state) => {
    const toks = state.tokens;
    const token = (type, nesting, level) => { const t = new state.Token(type, "div", nesting); t.block = true; t.level = level; return t; };
    for (let i = 0; i < toks.length; i++) {
      const open = toks[i], m = open.type === "html_block" && open.level === 0 && open.map ? COLS.exec(open.content.trim()) : null;
      if (!m) continue;
      let end = -1;
      const cuts = [];
      for (let j = i + 1; j < toks.length; j++) {
        const t = toks[j], c = t.type === "html_block" && t.level === 0 ? t.content.trim() : "";
        if (!c) continue;
        if (COLS.test(c)) break; // (a second beginning: the first has no end)
        if (COLS_END.test(c)) { end = j; break; }
        if (COL.test(c)) cuts.push(j);
      }
      if (end < 0 || !cuts.length || !toks[end].map) continue;
      const n = cuts.length + 1, given = m[1] ? m[1].split(":").map(Number) : [];
      const widths = given.length === n && given.every((w) => w > 0) ? given : Array(n).fill(1);
      const all = token("columns_open", 1, 0);
      all.attrSet("class", "cols");
      all.map = [open.map[0], toks[end].map[1]];
      const out = [all], bounds = [i, ...cuts, end];
      for (let k = 0; k < n; k++) {
        const col = token("column_open", 1, 1), inner = toks.slice(bounds[k] + 1, bounds[k + 1]);
        col.attrSet("class", "col");
        col.attrSet("style", `--w: ${widths[k]}`); // (its share of the row: viewer/*.css makes the flex of it)
        col.meta = { width: widths[k] };
        col.map = [toks[bounds[k]].map[1], toks[bounds[k + 1]].map[0]];
        for (const t of inner) t.level += 2;
        out.push(col, ...inner, token("column_close", -1, 1));
      }
      out.push(token("columns_close", -1, 0));
      toks.splice(i, end - i + 1, ...out);
      i += out.length - 1;
    }
  });
  /* A rule has four looks, by how its line is written: --- a thin line (as ever), *** three dots,
   * ___ a heavy line, - - - a dotted one. (Any other Markdown program draws a rule for each.)
   * The token keeps the line as it stands (markup), so it is written back as it was. */
  const ruleLook = (markup) => { const m = String(markup || "").trim(); return m.startsWith("*") ? "dots" : m.startsWith("_") ? "heavy" : /^-\s/.test(m) ? "dotted" : ""; };
  md.core.ruler.after("block", "rule_looks", (state) => {
    const lines = state.src.split("\n");
    for (const t of state.tokens) {
      if (t.type !== "hr" || !t.map) continue;
      const line = (lines[t.map[0]] || "").trim();
      if (/^([-*_])(\s*\1){2,}\s*$/.test(line)) t.markup = line;
      const look = ruleLook(t.markup);
      if (look) t.attrJoin("class", "hr-" + look);
    }
  });
  // the line before a table that says how it looks (tableLook, above) is the table's own
  md.core.ruler.after("block", "wide_tables", (state) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length - 1; i++) {
      const c = toks[i], t = toks[i + 1];
      const look = c.type === "html_block" && t.type === "table_open" && c.map && t.map && c.map[1] === t.map[0] ? tableLook(c.content) : null;
      if (!look) continue;
      t.meta = { ...t.meta, ...look, mark: c.content.trim() };
      t.map = [c.map[0], t.map[1]]; // (the line belongs to the table)
      toks.splice(i, 1);
    }
  });
  md.renderer.rules.table_close = (t, i, o, _e, self) => self.renderToken(t, i, o) + "</div>";
  const isExternal = (href) => /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href);
  const defaultLinkOpen = md.renderer.rules.link_open || ((t, i, o, _e, self) => self.renderToken(t, i, o));
  md.renderer.rules.link_open = (t, i, o, e, self) => {
    const href = t[i].attrGet("href") || "";
    if (isExternal(href) && !/\bexternal\b/.test(t[i].attrGet("class") || "")) t[i].attrJoin("class", "external");
    if (t[i].meta && t[i].meta.fileSize) { // a file block's size, written where a title stands: not drawn as one
      const all = t[i].attrs;
      t[i].attrs = all.filter(([k]) => k !== "title");
      const html = defaultLinkOpen(t, i, o, e, self);
      t[i].attrs = all;
      return html;
    }
    return defaultLinkOpen(t, i, o, e, self);
  };

  // what the page's other files use of this one
  Object.assign(P, { md, safeHtml, tex, imageSize, picTail, picText, alignMark, calloutKind, calloutTitle, LINK_ROW, linkMark,
    svgPicture, codeHidden, codeLang, headColor, tableLook, tableMark, tableStyle, colsOf, ruleLook, isExternal });
})();
