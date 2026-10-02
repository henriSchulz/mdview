/* mdview active mode — document store.
 *
 * The Markdown string is the document. The store cuts it into segments that
 * concatenate back to the original, byte for byte:
 *
 *   head · seg · sep · seg · sep · … · seg · sep
 *
 * A segment is one top-level block as markdown-it sees it (by source lines),
 * or a "hidden" run of lines that produces no output of its own (link
 * reference, footnote and abbreviation definitions). A separator is whatever
 * stands between two segments, usually "\n\n". What the user did not touch is
 * written back from these slices, never re-generated.
 *
 * Line endings: parsing works on "\n" only. Every slice also keeps its
 * original spelling (`orig`), so mixed endings survive in untouched blocks.
 */
"use strict";
(() => {
  const A = (window.MdActive = window.MdActive || {});
  const { md, stripFrontmatter, stripComments } = window.MdView.core;

  const BLANK = /^[ \t]*$/;
  // token type of the first token of a top-level group -> segment type
  const TYPES = {
    paragraph_open: "paragraph", heading_open: "heading", bullet_list_open: "list", ordered_list_open: "list",
    blockquote_open: "blockquote", table_open: "table", fence: "code", code_block: "code", math_block: "math",
    html_block: "html", dl_open: "deflist", hr: "rule", footnote_block_open: "footnotes",
  };

  // Offsets of every line in the normalised text and in the original.
  function lineTable(original) {
    const starts = [0], origStarts = [0], ends = [];
    const count = { "\n": 0, "\r\n": 0, "\r": 0 };
    let text = "", last = 0;
    const re = /\r\n|\r|\n/g;
    for (let m = re.exec(original); m; m = re.exec(original)) {
      text += original.slice(last, m.index);
      ends.push(text.length);
      text += "\n";
      count[m[0]]++;
      last = m.index + m[0].length;
      starts.push(text.length);
      origStarts.push(last);
    }
    text += original.slice(last);
    ends.push(text.length);
    const eol = count["\r\n"] > count["\n"] && count["\r\n"] >= count["\r"] ? "\r\n"
      : count["\r"] > count["\n"] ? "\r" : "\n";
    return { text, starts, ends, origStarts, eol };
  }

  /* Top-level token groups of a parsed document: each opening token with
   * everything up to its closing one, or a token that stands alone. */
  function groups(tokens) {
    const out = [];
    let depth = 0, first = 0;
    tokens.forEach((t, i) => {
      if (depth === 0) first = i;
      depth += t.nesting;
      if (depth === 0) out.push({ tokens: tokens.slice(first, i + 1), map: tokens[first].map, type: TYPES[tokens[first].type] || "other" });
    });
    return out;
  }

  /* original: the file's text as it is on disk.
   * opts: { links, vault } as the reading view gets them. */
  function parse(original, opts = {}) {
    const t = lineTable(original);
    const text = t.text, nLines = t.starts.length;
    const fm = stripFrontmatter(text);
    const body = stripComments(fm.body);
    const frontLen = text.length - fm.body.length;
    // lines of the text as the parser sees them (comments blanked out)
    const seen = (text.slice(0, frontLen) + body).split("\n");

    md.set({ breaks: !!opts.vault });
    const env = { lineOffset: fm.offset, links: opts.links || {}, outline: [], depth: 0 };
    const tokens = md.parse(body, env);

    const segs = [];
    const origAt = (line, col) => t.origStarts[line] + col;
    const slice = (fromLine, toLine) => { // lines [fromLine, toLine), without the last line's newline
      const from = t.starts[fromLine], to = t.ends[toLine - 1];
      return {
        from, to, line: fromLine, lines: toLine - fromLine,
        raw: text.slice(from, to),
        orig: original.slice(origAt(fromLine, 0), origAt(toLine - 1, to - t.starts[toLine - 1])),
      };
    };
    let cursor = 0; // first line not yet in a segment
    const hiddenUpTo = (line) => { // lines [cursor, line) that belong to no block
      let a = cursor, b = line;
      while (a < b && BLANK.test(seen[a])) a++;
      while (b > a && BLANK.test(seen[b - 1])) b--;
      if (a < b) segs.push({ kind: "hidden", type: "definition", tokens: null, ...slice(a, b) });
      cursor = Math.max(cursor, line);
    };

    if (fm.props && frontLen) {
      const lines = text.slice(0, frontLen).endsWith("\n") ? fm.offset : fm.offset + 1;
      segs.push({ kind: "block", type: "frontmatter", tokens: null, props: fm.props, ...slice(0, lines) });
      cursor = lines;
    }
    const virtual = [];
    for (const g of groups(tokens)) {
      if (!g.map) { virtual.push(g); continue; } // footnote section: output without a place in the source
      let start = g.map[0] + fm.offset, end = Math.min(g.map[1] + fm.offset, nLines);
      // an unclosed fence runs to the end of the file, blank lines included
      const open = g.tokens[0].type === "fence" && !closedFence(seen, start, end, g.tokens[0].markup);
      if (!open) while (end - 1 > start && BLANK.test(seen[end - 1])) end--;
      if (start < cursor) { // overlapping maps: fold into the block before, which then stays opaque
        const prev = segs[segs.length - 1];
        if (prev) {
          if (end > prev.line + prev.lines) Object.assign(prev, slice(prev.line, end));
          prev.tokens = (prev.tokens || []).concat(g.tokens);
          prev.type = "other";
        }
        cursor = Math.max(cursor, end);
        continue;
      }
      hiddenUpTo(start);
      segs.push({ kind: "block", type: g.type, tokens: g.tokens, ...slice(start, end) });
      cursor = end;
    }
    hiddenUpTo(nLines);

    joinOpenHtml(segs, slice, env);

    // separators: the text between two segments, and before the first one
    const store = { original, text, eol: t.eol, env, segs, virtual, head: { raw: "", orig: "" }, props: fm.props };
    const origOf = (pos) => { // normalised offset -> original offset (pos is a line start or a line end)
      let lo = 0, hi = nLines - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t.starts[mid] <= pos) lo = mid; else hi = mid - 1; }
      return origAt(lo, pos - t.starts[lo]);
    };
    const gap = (from, to) => ({ raw: text.slice(from, to), orig: original.slice(origOf(from), to === text.length ? original.length : origOf(to)) });
    if (!segs.length) { store.head = { raw: text, orig: original }; return store; }
    store.head = gap(0, segs[0].from);
    segs.forEach((s, i) => {
      s.id = i;
      s.sep = gap(s.to, i + 1 < segs.length ? segs[i + 1].from : text.length);
    });
    return store;
  }

  /* HTML in a note may open an element in one block and close it blocks
   * later (<details> … </details>), or never. The reading view parses the
   * whole page at once, so everything in between ends up inside that element.
   * Such a run of segments becomes one segment: it can only be shown, and
   * edited, as a whole. */
  const hasHtml = (toks) => toks.some((t) => t.type === "html_block" || (t.children && t.children.some((c) => c.type === "html_inline")));
  function joinOpenHtml(segs, slice, env) {
    if (!segs.some((s) => s.tokens && hasHtml(s.tokens))) return;
    // One parse of the whole page with a mark after every segment: a comment
    // (stays where it is put, also inside a table) and a character (ends up
    // inside any formatting element that is still open, like <b>).
    const MARK = "\uE000";
    const probe = document.createElement("template");
    probe.innerHTML = segs.map((s, k) => (s.tokens ? md.renderer.render(s.tokens, md.options, env) : "") + `<!--mdv:${k}-->${MARK}`).join("");
    const closed = new Array(segs.length).fill(false);
    for (const n of probe.content.childNodes) {
      const m = n.nodeType === 8 && /^mdv:(\d+)$/.exec(n.data);
      if (m && n.nextSibling && n.nextSibling.nodeType === 3 && n.nextSibling.data.startsWith(MARK)) closed[m[1]] = true;
    }
    for (let i = segs.length - 1, end = segs.length - 1; i >= 0; i--) {
      // segments i..end are one run if nothing before i is left open
      if (i > 0 && !closed[i - 1]) continue;
      if (end > i) {
        const run = segs.slice(i, end + 1);
        const tokens = run.flatMap((s) => s.tokens || []);
        segs.splice(i, run.length, { kind: "block", type: "html", tokens, ...slice(run[0].line, run[run.length - 1].line + run[run.length - 1].lines) });
      }
      end = i - 1;
    }
  }

  function closedFence(lines, start, end, markup) {
    if (end - 1 <= start) return false;
    const m = /^\s*(`{3,}|~{3,})[ \t]*$/.exec(lines[end - 1].replace(/^(?:[ \t]*>)+/, ""));
    return !!m && m[1][0] === markup[0] && m[1].length >= markup.length;
  }

  /* The document as a string. `parts` lists what stands in the document now,
   * in order: { id } for a segment that is as it was loaded, { text } for
   * new or changed Markdown (with "\n" line ends). Neighbours that were
   * neighbours on load keep their separator; anything else gets a blank line.
   * Called without `parts` it returns the loaded document. */
  function serialize(store, parts, exact = true) {
    const pick = (s) => (exact ? s.orig : s.raw);
    const nl = exact ? store.eol : "\n";
    const eol = (s) => (nl === "\n" ? s : s.replace(/\n/g, nl));
    const segs = store.segs;
    if (!parts) parts = segs.map((s) => ({ id: s.id }));
    if (!parts.length) return pick(store.head);
    let out = "";
    parts.forEach((p, i) => {
      const seg = p.id != null ? segs[p.id] : null;
      const prev = i ? parts[i - 1] : null;
      if (!i) out += seg && seg.id === 0 ? pick(store.head) : leadingOf(store, exact);
      else if (!(prev.id != null && seg && prev.id + 1 === seg.id)) out += nl + nl;
      else out += pick(segs[prev.id].sep);
      out += seg ? pick(seg) : eol(p.text);
    });
    const last = parts[parts.length - 1];
    out += last.id === segs.length - 1 ? pick(segs[last.id].sep) : trailingOf(store, exact);
    return out;
  }
  // What the file starts and ends with stays, whichever block is first or last now.
  const leadingOf = (store, exact) => (exact ? store.head.orig : store.head.raw);
  const trailingOf = (store, exact) => {
    const s = store.segs[store.segs.length - 1];
    return s ? (exact ? s.sep.orig : s.sep.raw) : "";
  };

  A.store = { parse, serialize, groups, lineTable, typeOf: (token) => TYPES[token.type] || "other" };
})();
