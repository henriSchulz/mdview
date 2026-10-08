/* mdview active mode — from the editor's document back to Markdown.
 *
 * Only a block that was changed gets here (document.js writes the others from
 * their original slice). It is written in two steps:
 *
 * 1. canonical form: what this file would write for the block if it had no
 *    history — `*` for emphasis unless the node says otherwise, one line per
 *    paragraph, minimal escaping;
 * 2. three-way merge with the block's original text. The canonical form of
 *    the block *as loaded* is the base, the original text is one side (it
 *    differs from the base wherever the author spelled things their way:
 *    line breaks, `_` for emphasis, escapes, indentation, reference links),
 *    the canonical form of the block *now* is the other side (it differs
 *    where the user edited). Outside the edit the original's spelling wins.
 *
 * The result is parsed again and compared with the editor's block. If it does
 * not say the same, the next candidate is tried: more escaping, and finally
 * the canonical form alone.
 */
"use strict";
(() => {
  const A = window.MdActive;

  // ------------------------------------------------------------ style
  /* How the document spells things, by majority; used for what is new. */
  function profileOf(text) {
    const pr = window.MdPrefs || {};
    if (pr.style === "fixed") { // the settings say how new Markdown looks (what is there stays as it is)
      const auto = autoProfile(text);
      return { ...auto, bullet: pr.bullet || auto.bullet, ordered: pr.ordered || auto.ordered, em: pr.emphasis || auto.em, strong: pr.strongMark || auto.strong };
    }
    return autoProfile(text);
  }
  function autoProfile(text) {
    const count = (re) => (text.match(re) || []).length;
    const pick = (pairs, fallback) => {
      let best = fallback, n = 0;
      for (const [value, c] of pairs) if (c > n) { best = value; n = c; }
      return best;
    };
    return {
      bullet: pick([["-", count(/^[ \t>]*- /gm)], ["*", count(/^[ \t>]*\* /gm)], ["+", count(/^[ \t>]*\+ /gm)]], "-"),
      ordered: pick([[".", count(/^[ \t>]*\d+\. /gm)], [")", count(/^[ \t>]*\d+\) /gm)]], "."),
      em: pick([["*", count(/(^|[^*\\])\*[^\s*][^*\n]*\*(?!\*)/gm)], ["_", count(/(^|[^\w\\])_[^\s_][^_\n]*_(?!\w)/gm)]], "*"),
      strong: pick([["**", count(/\*\*[^\s*]/g)], ["__", count(/(^|\W)__[^\s_]/gm)]], "**"),
      rule: pick([["---", count(/^ {0,3}-{3,}[ \t]*$/gm)], ["***", count(/^ {0,3}\*{3,}[ \t]*$/gm)], ["___", count(/^ {0,3}_{3,}[ \t]*$/gm)]], "---"),
      hardBreak: pick([["\\", count(/\\\n/g)], ["  ", count(/\S {2,}\n/g)]], "\\"),
      // nested bullets: by the marker's width (2), or four spaces, or a tab
      indent: pick([[4, count(/^ {4}[-*+] /gm)], ["\t", count(/^\t[-*+] /gm)], [0, count(/^ {2,3}[-*+] /gm)]], 0),
    };
  }

  // ------------------------------------------------------------ escaping
  const PUNCT = "!\"#$%&'()*+,\\-./:;<=>?@\\[\\\\\\]^_`{|}~";
  /* level 0: what would be something else for sure (a backslash before
   * punctuation, an entity, a tag); 1: also the characters that start inline
   * constructs; 2: all punctuation. Higher levels are only tried when a lower
   * one does not parse back to the same block. */
  function escapeText(str, level, inLink) {
    let s = str.replace(new RegExp(`\\\\(?=[${PUNCT}]|$)`, "g"), "\\\\");
    s = s.replace(/&(?=#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[a-zA-Z][a-zA-Z0-9]{1,31};)/g, "\\&");
    s = s.replace(/<(?=[a-zA-Z/!?])/g, "\\<");
    s = s.replace(/\n/g, "&#10;"); // a line break that is text (it came from an entity)
    if (inLink && level < 1) s = s.replace(/[[\]]/g, "\\$&"); // a bracket would end the link's text
    if (level === 1) {
      s = s.replace(/[`[\]$~^]|\*|==|%%/g, (m) => "\\" + m)
        .replace(/_/g, (m, i, all) => (/[\p{L}\p{N}]/u.test(all[i - 1] || "") && /[\p{L}\p{N}]/u.test(all[i + 1] || "") ? m : "\\_"));
    } else if (level >= 2) {
      s = s.replace(new RegExp(`(?<!\\\\)[${PUNCT.replace("\\\\\\\\", "").replace("&", "").replace("<", "")}]`, "g"), (m) => "\\" + m);
      s = s.replace(/(?<!\\)</g, "\\<"); // (also where no tag could start: "<3" is a heart to some)
    }
    return s;
  }
  // What would start another kind of block at the beginning of a line.
  function guardLine(line, first) {
    return line
      .replace(/^( {0,3})(#{1,6})(?=[ \t]|$)/, "$1\\$2")
      .replace(/^( {0,3})([-+*])(?=[ \t]|$)/, "$1\\$2")
      .replace(/^( {0,3}\d{1,9})([.)])(?=[ \t]|$)/, "$1\\$2")
      .replace(/^( {0,3})>/, "$1\\>")
      .replace(/^( {0,3})(`{3,}(?=[^`]*$)|~{3,})/, (m, a, b) => a + "\\" + b) // (backticks later in the line: a code span, no fence)
      .replace(/^( {0,3})([-_*=])(?=(?:[ \t]*\2)*[ \t]*$)/, (m, a, b) => (b === "=" && first ? m : a + "\\" + b))
      .replace(/^( {0,3})\$\$/, "$1\\$$$$")
      .replace(/^( {0,3}):(?=[ \t])/, "$1\\:")
      .replace(/^( {0,3})\[(?=[^\]]*\]:)/, "$1\\[")
      .replace(/^( {0,3})\|/, "$1\\|");
  }

  // ------------------------------------------------------------ inline
  /* Is a link with this text and address one that needs no brackets: <address>, or a bare address? */
  const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  function plainOk(markup, text, href) {
    if (markup === "autolink") return (text === href && /^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*$/.test(text)) || (href === "mailto:" + text && EMAIL.test(text));
    if (markup === "linkify") return (text === href && /^https?:\/\/[^\s<>]*[^\s<>.,;:!?)\]'"]$/.test(text)) || (href === "mailto:" + text && EMAIL.test(text));
    return false;
  }
  const DELIM = { s: "~~", mark: "==", sub: "~", sup: "^" };
  const WRAPS = new Set(["mark", "link", "strong", "em", "s", "sub", "sup"]); // marks written as delimiters around text
  const wordChar = (c) => !!c && /[\p{L}\p{N}]/u.test(c);

  function inline(parent, cx) {
    const { profile, level } = cx;
    let out = "";
    const active = []; // marks open in the output, outermost first
    const wraps = (n) => (n ? n.marks.filter((m) => WRAPS.has(m.type.name)) : []);
    // one emphasis is like another, whatever delimiter it was written with; a link is its address
    const like = (a, b) => a.type === b.type && (a.type.name !== "link" || a.eq(b));
    const has = (marks, m) => marks.some((x) => like(x, m));
    const isCode = (n) => n.isText && n.marks.some((m) => m.type.name === "code");
    const kids = [];
    parent.forEach((n) => {
      const last = kids[kids.length - 1];
      // code next to code under the same marks is one code span (two would run their backticks together)
      if (last && isCode(n) && isCode(last) && wraps(n).length === wraps(last).length && wraps(n).every((m) => has(wraps(last), m))) kids[kids.length - 1] = last.withText(last.text + n.text);
      else kids.push(n);
    });
    // a block does not end in a break, nor in white space
    while (kids.length && kids[kids.length - 1].type.name === "hard_break") kids.pop();

    // <address> and a bare address only work while the text is an address, and the same one
    const plainLink = (mark) => {
      if (!mark.attrs.markup) return "";
      let text = "", only = true;
      for (const k of kids) if (has(k.marks, mark)) { if (k.isText && k.marks.length === 1) text += k.text; else only = false; }
      return only && plainOk(mark.attrs.markup, text, mark.attrs.href) ? mark.attrs.markup : "";
    };
    const open = (mark, next) => {
      switch (mark.type.name) {
        case "em": return emphasis(mark.attrs.markup || profile.em, out, next);
        case "strong": return emphasis(mark.attrs.markup || profile.strong, out, next);
        case "link": { const kind = plainLink(mark); return kind === "autolink" ? "<" : kind === "linkify" ? "" : "["; }
        default: return DELIM[mark.type.name];
      }
    };
    const close = (mark, opened, after) => {
      switch (mark.type.name) {
        case "link":
          if (opened === "<") return ">";
          if (opened === "") return "";
          if (mark.attrs.ref) return "][" + mark.attrs.ref + "]";
          return "](" + linkTarget(mark.attrs.href) + (mark.attrs.title ? ' "' + mark.attrs.title.replace(/"/g, '\\"') + '"' : "") + ")";
        default: return opened;
      }
    };
    // `_` does not open or close inside a word; there `*` has to do
    const emphasis = (want, before, next) => {
      const last = before[before.length - 1], other = want[0] === "_" ? "*" : "_";
      if (want[0] === "_" && wordChar(last) && wordChar(next)) return want.length === 2 ? "**" : "*";
      // right after a closing delimiter of the same character the two would run together: take the other one
      if (last === want[0] && !(other === "_" && wordChar(next) && wordChar(last))) return other.repeat(want.length);
      return want;
    };

    const closeTo = (keep, after) => {
      while (active.length > keep) {
        const a = active.pop();
        let d = close(a.mark, a.delim, after);
        if (a.mark.type.name !== "link" && d[0] === "_" && wordChar(after) && wordChar(out[out.length - 1])) {
          // closing `_` inside a word: rewrite the pair as `*`
          const star = d.length === 2 ? "**" : "*";
          out = out.slice(0, a.at) + star + out.slice(a.at + d.length);
          d = star;
        }
        out += d;
      }
    };

    // how many of the open marks (outermost first) a set of marks continues
    const kept = (open, marks) => { let k = 0; while (k < open.length && has(marks, open[k])) k++; return k; };
    for (let i = 0; i < kids.length; i++) {
      const node = kids[i];
      let text = node.isText ? node.text : null;
      const code = node.marks.find((m) => m.type.name === "code");
      const link = node.marks.find((m) => m.type.name === "link");
      let marks = wraps(node);
      const nextMarks = wraps(kids[i + 1]);
      const open0 = active.map((a) => a.mark);
      if ((text != null && !code && !text.trim()) || node.type.name === "hard_break") {
        // white space or a line break alone: inside the marks that go on over it, outside all that start or end here
        marks = open0.slice(0, kept(open0, marks.filter((m) => has(nextMarks, m))));
      }
      const keep = kept(open0, marks);
      // what opens here: the mark that lasts longest goes outermost, so the others can end inside it
      const lasting = (m) => { let n = 0; while (kids[i + n + 1] && has(kids[i + n + 1].marks, m)) n++; return n; };
      const opening = marks.filter((m) => !has(open0.slice(0, keep), m))
        .map((m, k) => [m, lasting(m), k]).sort((x, y) => y[1] - x[1] || x[2] - y[2]).map((x) => x[0]);
      const after = open0.slice(0, keep).concat(opening);
      // white space at the edge of a mark goes outside of it
      let lead = "", trail = "";
      if (text != null && !code && text.trim()) {
        if (opening.length) { lead = /^\s*/.exec(text)[0]; text = text.slice(lead.length); }
        if (kept(after, nextMarks) < after.length) { trail = /\s*$/.exec(text)[0]; text = text.slice(0, text.length - trail.length); }
      }
      let body = text == null ? leaf(node, cx) : code ? codeSpan(text, code)
        : link && plainLink(link) ? text // an address is written as it is
        : escapeText(text, level, !!link);
      // A backslash at the end of a line right behind an address: some parsers take it into the
      // address. There the break is written with two spaces.
      if (node.type.name === "hard_break" && !node.attrs.soft && body[0] === "\\" && /(?:[:.@]\S*|[a-z0-9]\.[a-z]{2,}\S*)$/i.test(out.slice(out.lastIndexOf("\n") + 1).split(/\s/).pop() || "")) body = "  \n";
      // A literal *, _ or ~ touching a delimiter: parsers disagree on which of them delimits. Escaped, none do.
      if (text != null && !code && !(link && plainLink(link)) && level < 2) {
        const before = keep < open0.length || opening.length > 0;
        const next = kids[i + 1], behind = !!next && (kept(after, nextMarks) < after.length || nextMarks.some((m) => !has(after, m)));
        if (before && !lead && /^[*_~]/.test(body)) body = "\\" + body;
        if (behind && !trail && /(?<!\\)[*_~]$/.test(body)) body = body.slice(0, -1) + "\\" + body.slice(-1);
      }
      closeTo(keep, lead ? lead[0] : body[0] || "");
      out += lead;
      for (const mark of opening) {
        const delim = open(mark, body[0] || "");
        active.push({ mark, delim, at: out.length });
        out += delim;
      }
      out += body;
      if (trail) {
        closeTo(kept(after, nextMarks), trail[0]);
        out += trail;
      }
    }
    closeTo(0, "");
    // a no-break space at either end would be trimmed away with the white space: as an entity it stays
    return out.replace(/^[ \t]+|[ \t]+$/g, "").replace(/^\u00a0+|\u00a0+$/g, (m) => "&nbsp;".repeat(m.length));
  }
  function codeSpan(text) {
    let longest = 0;
    for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
    const fence = "`".repeat(longest + 1);
    const pad = /^`|`$/.test(text) || (/^ .* $/.test(text) && text.trim()) ? " " : "";
    return fence + pad + text + pad + fence;
  }
  function linkTarget(href) {
    if (href === "" || /[\s<>]/.test(href) || !balanced(href)) return "<" + href.replace(/[<>]/g, "\\$&") + ">";
    return href;
  }
  function balanced(s) {
    let d = 0;
    for (const c of s) { if (c === "(") d++; else if (c === ")" && --d < 0) return false; }
    return d === 0;
  }
  function leaf(node, cx) {
    switch (node.type.name) {
      case "hard_break": return node.attrs.soft ? "\n" : (cx.profile.hardBreak === "\\" ? "\\\n" : "  \n");
      case "image": {
        const { src, alt, title } = node.attrs;
 return "![" + escapeText(alt, 1).replace(/&#10;/g, "\n") + "](" + linkTarget(src) + (title ? ' "' + title.replace(/"/g, '\\"') + '"' : "") + ")";
      }
      case "iatom": return node.attrs.raw;
      default: return "";
    }
  }

  // ------------------------------------------------------------ blocks
  // -> lines of the block, without the marks of what it sits in
  /* A line wrapped at spaces to at most `width` characters (a word longer than that keeps its
   * line). A line never starts with what would make it something else: a marker, a fence. */
  function wrapLine(line, width) {
    if (line.length <= width) return [line];
    const end = /(\\| {2,})$/.exec(line), body = end ? line.slice(0, -end[0].length) : line; // (a hard break stays at the end)
    const out = [];
    let cur = "";
    for (const word of body.split(" ")) {
      if (cur && (cur + " " + word).length > width && word && !/^([-+*>#=|]|\d+[.)]|`{3}|~{3}|\$\$)/.test(word)) { out.push(cur); cur = word; }
      else cur = cur ? cur + " " + word : word;
    }
    out.push(cur + (end ? end[0] : ""));
    return out;
  }
  function lines(node, cx) {
    switch (node.type.name) {
      case "paragraph": {
        const ls = inline(node, cx).split("\n");
        return (cx.wrap > 0 ? ls.flatMap((l) => wrapLine(l, cx.wrap)) : ls).map((l, i) => guardLine(l, i === 0));
      }
      case "heading": {
        const text = inline(node, cx);
        const { level, markup } = node.attrs;
        if ((markup === "=" || markup === "-") && level <= 2 && text) {
          const ls = text.split("\n").map((l, i) => guardLine(l, i === 0));
          return ls.concat((level === 1 ? "=" : "-").repeat(3)); // the underline keeps the length it has (see merge3)
        }
        const one = text.replace(/\\?\n/g, " ").replace(/(^|[ \t])(#+)$/, "$1\\$2");
        return ["#".repeat(level) + (one ? " " + one : "")];
      }
      case "horizontal_rule": return [node.attrs.markup || cx.profile.rule];
      case "blockquote": {
        const lines = children(node, cx, false).map((l) => (l ? "> " + l : ">"));
        // a decoration says what it is in a line of its own before the text
        if (node.attrs.callout) return ["> [!" + node.attrs.callout + "]" + (node.attrs.fold || "") + (node.attrs.title ? " " + node.attrs.title : "")].concat(lines);
        return node.attrs.deco ? ["> [!" + node.attrs.deco + (node.attrs.color ? "|" + node.attrs.color : "") + "]"].concat(lines) : lines;
      }
      case "columns": {
        // a part of a row (a selection that reaches into one column of it): its blocks, no row — one
        // column between the comment lines would read as nothing but two stray comments
        if (node.childCount < 2) { const part = []; node.forEach((col) => part.push(...children(col, cx, false))); return part; }
        // one under the other, between the comment lines that say what stands side by side
        const widths = [];
        node.forEach((col) => widths.push(Math.round(col.attrs.width * 100) / 100));
        const out = ["<!-- columns" + (widths.every((w) => w === widths[0]) ? "" : " " + widths.join(":")) + " -->"];
        node.forEach((col, _o, i) => {
          if (i) out.push("<!-- column -->");
          const kids = children(col, cx, false);
          out.push("", ...(kids.some((l) => l) ? kids.concat("") : [])); // (a column with nothing in it: one empty line)
        });
        return out.concat("<!-- /columns -->");
      }
      case "bullet_list":
      case "ordered_list": return list(node, cx);
      case "table": return table(node, cx);
      case "island":
      case "hidden": return node.attrs.raw.split("\n");
      default: return [];
    }
  }
  // the blocks inside a quote or a list item, a blank line between them unless tight allows none
  // Two lists of one kind in a row would read as one: the second takes the other marker.
  const markerOf = (list, cx) => (list.type.name === "ordered_list" ? (/^[.)]$/.test(list.attrs.markup || "") ? list.attrs.markup : cx.profile.ordered)
    : [list.firstChild && list.firstChild.attrs.markup, list.attrs.markup].find((m) => /^[-+*]$/.test(m || "")) || cx.profile.bullet);
  function apart(child, prev, cx) {
    if (!prev || prev.type !== child.type || !/_list$/.test(child.type.name)) return cx;
    const before = cx.swap && cx.swap.node === prev ? cx.swap.marker : markerOf(prev, cx);
    const mine = markerOf(child, cx);
    if (mine !== before) return cx;
    const other = child.type.name === "ordered_list" ? (mine === "." ? ")" : ".") : mine === "-" ? "*" : "-";
    return { ...cx, swap: { node: child, marker: other } };
  }
  function children(node, cx, tight) {
    const out = [];
    let prev = null;
    node.forEach((child) => {
      if (child.type.name === "paragraph" && !child.content.size && node.childCount > 1) return;
      const ls = lines(child, apart(child, prev, cx));
      if (prev && !(tight && !(prev.type.name === "paragraph" && child.type.name === "paragraph"))) out.push("");
      out.push(...ls);
      prev = child;
    });
    return out;
  }
  /* A table is written whole, in the way it was formatted (padded columns or
   * not, pipes at the ends or not). A cell that was not changed keeps its
   * own Markdown; `|` in a cell is escaped. */
  function table(node, cx) {
    const style = A.tables.styleOf(node.attrs.raw);
    const rows = [], aligns = [];
    node.forEach((row, _o, r) => {
      const out = [];
      row.forEach((cell) => {
        if (r === 0) aligns.push(cell.attrs.align);
        const kept = cell.content.size ? A.tables.source.get(cell.content) : null;
        out.push(kept != null ? kept : inline(cell, cx).replace(/\n/g, " ").replace(/\|/g, "\\|")); // (every "|", also one behind a backslash — a norm in a formula, \|v\|: the table takes one backslash off each, and what is left is the cell's text)
      });
      rows.push(out);
    });
    const lines = A.tables.write(rows, aligns, style);
    // the line that says how it looks: as it was written, where it still says so; else written anew, or none
    const core = window.MdView.core, was = node.attrs.mark ? core.tableLook(node.attrs.mark) : null;
    const mark = was && was.wide === !!node.attrs.wide && was.head === (node.attrs.head || "") ? node.attrs.mark : core.tableMark({ wide: !!node.attrs.wide, head: node.attrs.head || "" });
    return mark ? [style.indent + mark].concat(lines) : lines;
  }
  // -> the lines of every item of a list
  function listItems(node, cx) {
    const ordered = node.type.name === "ordered_list";
    const { start } = node.attrs;
    const tight = node.attrs.tight && !needsLoose(node);
    const nums = [];
    node.forEach((item) => nums.push(item.attrs.num));
    // "1. 1. 1." stays that way; anything else counts up
    const written = nums.filter((n) => n != null);
    const same = ordered && written.length > 1 && written.every((n) => Number(n) === start);
    const items = [];
    const bullet = markerOf(node, cx); // one bullet for the whole list: another one would start another list
    node.forEach((item, _o, i) => {
      const forced = cx.swap && cx.swap.node === node ? cx.swap.marker : null;
      const marker = ordered ? String(same ? start : start + i) + (forced || (/^[.)]$/.test(node.attrs.markup || "") ? node.attrs.markup : cx.profile.ordered))
        : forced || bullet;
      const task = item.attrs.task != null && item.attrs.box ? `[${item.attrs.task}] ` : "";
      const width = marker.length + 1;
      const body = [];
      let prev = null;
      item.forEach((child) => {
        if (child.type.name === "paragraph" && !child.content.size && item.childCount > 1) return; // (an item cannot start with an empty line and go on)
        let ls = lines(child, apart(child, prev, cx));
        if (prev && (!(tight && !(prev.type.name === "paragraph" && child.type.name === "paragraph")) || child.type.name === "table")) body.push("");
        // a list under a bullet may be indented further than the text needs (four spaces, a tab)
        const nested = /_list$/.test(child.type.name) && !ordered && prev ? cx.profile.indent : 0;
        if (nested === "\t") ls = ls.map((l) => (l ? "\t" + l : l));
        else if (nested > width) ls = ls.map((l) => (l ? " ".repeat(nested - width) + l : l));
        body.push(...ls);
        prev = child;
      });
      const out = [];
      const pad = " ".repeat(width);
      body.forEach((l, k) => {
        if (k === 0) out.push(l ? marker + " " + task + l : (marker + " " + task).trimEnd()); // (a line may end in the two spaces of a hard break)
        else out.push(l ? (l[0] === "\t" ? l : pad + l) : "");
      });
      if (!body.length) out.push(marker);
      items.push(out);
    });
    return { items, tight };
  }
  function list(node, cx) {
    const { items, tight } = listItems(node, cx);
    const out = [];
    items.forEach((ls, i) => { if (!tight && i > 0) out.push(""); out.push(...ls); });
    return out;
  }
  // two paragraphs in a row in one item need a blank line between them, and that makes the list loose
  function needsLoose(list) {
    let yes = false;
    list.forEach((item) => {
      for (let i = 1; i < item.childCount; i++) if (item.child(i).type.name === "paragraph" && item.child(i - 1).type.name === "paragraph") yes = true;
    });
    return yes;
  }
  const canonical = (node, cx) => lines(node, cx).join("\n");

  // ------------------------------------------------------------ three-way merge
  /* Tokens: words, single other characters, and runs of white space. A line
   * break takes the indentation and quote marks of the next line with it, and
   * so does the start of the block: "\n> " is the same place as " ".
   * -> { text: [...], keys: [...] }; any white space has the key " ". */
  const TOKEN = /(?<w>^[ \t>]+(?:\n[ \t>]*)*|[ \t]*(?:\n[ \t>]*)+|[ \t]+)|[\p{L}\p{N}]+|[^]/gu;
  function tokens(s) {
    const text = [], keys = [];
    for (const m of s.matchAll(TOKEN)) { text.push(m[0]); keys.push(m.groups.w ? " " : m[0]); }
    return { text, keys };
  }
  /* Longest common subsequence of two token lists by key (Myers, greedy).
   * -> pairs [i, j] of matching positions, in order. */
  function match(a, b) {
    const n = a.length, m = b.length;
    let pre = 0;
    while (pre < n && pre < m && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
    const A1 = a.slice(pre, n - suf), B1 = b.slice(pre, m - suf);
    const N = A1.length, M = B1.length, max = N + M;
    const pairs = [];
    for (let i = 0; i < pre; i++) pairs.push([i, i]);
    if (N && M) {
      const v = new Int32Array(2 * max + 2), trace = [];
      let found = false;
      for (let d = 0; d <= max && !found; d++) {
        trace.push(v.slice());
        for (let k = -d; k <= d; k += 2) {
          let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
          let y = x - k;
          while (x < N && y < M && A1[x] === B1[y]) { x++; y++; }
          v[max + k] = x;
          if (x >= N && y >= M) { found = true; break; }
        }
      }
      const mid = [];
      let x = N, y = M;
      for (let d = trace.length - 1; d > 0; d--) {
        const vd = trace[d], k = x - y;
        const pk = k === -d || (k !== d && vd[max + k - 1] < vd[max + k + 1]) ? k + 1 : k - 1;
        const px = vd[max + pk], py = px - pk;
        while (x > px && y > py) { x--; y--; mid.push([pre + x, pre + y]); }
        x = px; y = py;
      }
      while (x > 0 && y > 0) { x--; y--; mid.push([pre + x, pre + y]); }
      mid.reverse();
      pairs.push(...mid);
    }
    for (let i = 0; i < suf; i++) pairs.push([n - suf + i, m - suf + i]);
    return pairs;
  }
  /* base: canonical form as loaded; ours: the original text; theirs: canonical form now.
   * reach: the original's own spelling is given up this many tokens around an
   * edit (0: only where the edit itself is) — a reference link whose text was
   * edited needs its label written out, which stands right behind it. White
   * space keeps the original's spelling at any reach: its line breaks stay. */
  function merge3(base, ours, theirs, reach = 0) {
    if (base === theirs) return ours;
    if (base === ours) return theirs;
    const tb = tokens(base), to = tokens(ours), tt = tokens(theirs);
    const B = tb.text, O = to.text, T = tt.text;
    const inO = new Int32Array(B.length).fill(-1), inT = new Int32Array(B.length).fill(-1);
    for (const [i, j] of match(tb.keys, to.keys)) inO[i] = j;
    for (const [i, j] of match(tb.keys, tt.keys)) inT[i] = j;
    // pieces: a token that all three have, or the stretch between two such
    const pieces = [];
    let b = 0, o = 0, t = 0;
    while (b < B.length || o < O.length || t < T.length) {
      if (b < B.length && inO[b] === o && inT[b] === t) {
        pieces.push({ base: B[b], ours: O[o], theirs: T[t], at: b, stable: true, space: tb.keys[b] === " " });
        b++; o++; t++;
        continue;
      }
      let nb = b;
      while (nb < B.length && !(inO[nb] !== -1 && inT[nb] !== -1 && inO[nb] >= o && inT[nb] >= t)) nb++;
      const no = nb < B.length ? inO[nb] : O.length, nt = nb < B.length ? inT[nb] : T.length;
      pieces.push({ base: B.slice(b, nb).join(""), ours: O.slice(o, no).join(""), theirs: T.slice(t, nt).join(""), at: b, end: nb });
      b = nb; o = no; t = nt;
    }
    const edited = pieces.filter((p) => p.theirs !== p.base);
    const near = (p) => reach > 0 && !p.space && edited.some((e) => {
      const a0 = p.at, a1 = p.end ?? p.at + 1, e0 = e.at, e1 = e.end ?? e.at + 1;
      return a0 <= e1 + reach && e0 <= a1 + reach;
    });
    let out = "";
    for (const p of pieces) {
      if (p.stable) {
        // white space: the original's, unless the edit changed it or sits right next to it
        out += p.theirs !== p.base ? p.theirs : p.ours !== p.base && near(p) ? p.base : p.ours;
      } else if (p.theirs === p.base) out += near(p) ? p.base : p.ours; // only the original differs
      else if (p.ours === p.base) out += p.theirs;                       // only the edit differs
      else if (!p.base && p.ours === "\\") out += p.theirs + p.ours;     // typed in front of an escaped character
      else if (!p.base && !p.ours.trim()) out += p.ours + p.theirs;       // typed where the original has indentation
      else {
        // both differ. If the original only has white space around what the base has (a quote's empty
        // last line, indentation), that stays around the edit.
        const at = p.base ? p.ours.indexOf(p.base) : -1;
        const pre = at < 0 ? "" : p.ours.slice(0, at), post = at < 0 ? "" : p.ours.slice(at + p.base.length);
        out += at >= 0 && /^[ \t\n>]*$/.test(pre + post) ? pre + p.theirs + post : p.theirs;
      }
    }
    return out;
  }

  // ------------------------------------------------------------ comparing
  /* Do two blocks say the same? Spelling aside: which delimiter, which bullet.
   * Marks a parser adds by itself to plain text (tags, bare URLs) do not count. */
  const KEEP = {
    table_cell: ["header", "align"], table: ["wide", "head"], blockquote: ["deco", "color", "callout", "title", "fold"], heading: ["level"], ordered_list: ["start", "tight"], bullet_list: ["tight"], list_item: ["task"],
    image: ["src", "alt", "title"], iatom: ["kind", "raw"], hard_break: [], island: ["raw"], hidden: ["raw"],
  };
  function shape(node) {
    if (node.type.name === "heading" && !node.content.size) return ["island", ["#".repeat(node.attrs.level)], []];
    if (node.isTextblock) {
      // runs of text with the same marks. White space carries no formatting worth telling apart, a
      // line break carries none, and where exactly a space sits between two runs says nothing:
      // the runs are compared without the space at their edges, the whole text with it.
      const runs = [];
      let plain = "";
      const heading = node.type.name === "heading";
      node.forEach((n) => {
        const isBreak = n.type.name === "hard_break";
        if (isBreak && heading) { // a heading is one line: the break is a space there
          plain += " ";
          if (runs.length) runs[runs.length - 1][1] += " ";
          return;
        }
        // a bare address is a link by itself (the parser makes it one), and <an address> links to what its text says
        const bare = (m) => m.type.name === "link" && n.isText && plainOk(m.attrs.markup, n.text, m.attrs.href);
        const marks = isBreak ? "" : n.marks.filter((m) => !/^(tag|abbr)$/.test(m.type.name) && !(bare(m) && m.attrs.markup === "linkify"))
          .map((m) => m.type.name + (m.type.name === "link" && !bare(m) ? JSON.stringify([m.attrs.href, m.attrs.title || null]) : "")).sort().join("+");
        const what = n.isText ? n.text : "\u0000" + n.type.name + JSON.stringify((KEEP[n.type.name] || []).map((a) => n.attrs[a] ?? null));
        plain += what;
        const last = runs[runs.length - 1];
        if (n.isText && !n.text.trim()) { if (last) last[1] += " "; return; } // a space belongs to whatever run it is in
        if (last && last[0] === marks) last[1] += what; else runs.push([marks, what]);
      });
      const BREAKS = /(\s*\u0000hard_break\[\])+\s*$/; // a break at the end says nothing
      const flat = runs.map(([m, t]) => [m, t.replace(/\s+/g, " ").trim()]).filter(([, t]) => t);
      while (flat.length && BREAKS.test(flat[flat.length - 1][1])) {
        const t = flat[flat.length - 1][1].replace(BREAKS, "");
        if (t) { flat[flat.length - 1][1] = t; break; }
        flat.pop();
      }
      const text = plain.replace(/\s+/g, " ").trim().replace(/(\s*\u0000hard_break\[\])+$/, "");
      for (const run of flat) run[1] = run[1].replace(/\s*(\u0000hard_break\[\])\s*/g, "$1"); // the space around a break shows nowhere
      return [node.type.name, (KEEP[node.type.name] || []).map((a) => node.attrs[a] ?? null), flat, text.replace(/\s+/g, "")];
    }
    const kids = [];
    // (an empty paragraph next to other blocks is a place to type, nothing the file holds)
    node.forEach((n) => { if (!(n.type.name === "paragraph" && !n.content.size && (node.childCount > 1 || node.type.name === "column"))) kids.push(shape(n)); }); // (a column with only empty lines holds nothing)
    const attrs = (KEEP[node.type.name] || []).map((a) => {
      const v = node.attrs[a] ?? null;
      if (a === "raw" && node.attrs.kind === "code" && A.islands) { // code is its language and its text, however it is fenced
        const c = A.islands.parseCode(String(v));
        return JSON.stringify([c.lang, c.code.replace(/\s+$/, "")]);
      }
      if (a === "raw") return String(v).replace(/[ \t]+$/gm, "").replace(/\n{2,}/g, "\n\n").trim();
      if (a === "tight") return (v && !needsLoose(node)) || !canBeLoose(node); // a list with nothing to put a blank line between is tight
      if (a === "task") return v != null && node.firstChild.type.name !== "paragraph" && node.attrs.box ? null : v;
      return v;
    });
    // columns: what counts is each one's share of the row (1:1 and 2:2 say the same)
    if (node.type.name === "columns") {
      let sum = 0;
      node.forEach((col) => { sum += col.attrs.width; });
      node.forEach((col) => attrs.push(Math.round((col.attrs.width / (sum || 1)) * 200) / 200));
    }
    return [node.type.name, attrs, kids];
  }
  function canBeLoose(list) {
    if (list.childCount > 1) return true;
    let many = false;
    list.forEach((item) => { if (item.childCount > 1) many = true; });
    return many;
  }
  const same = (a, b) => JSON.stringify(shape(a)) === JSON.stringify(shape(b));

  /* Parse one block's Markdown on its own, with the document's definitions. */
  function parseBlock(text, store) {
    const d = A.document.open({ text, raw: text, links: store.env.links, vault: store.vault }, {
      references: store.env.references, footnotes: store.env.footnotes && store.env.footnotes.refs, abbreviations: store.env.abbreviations,
    });
    const blocks = [];
    d.doc.forEach((n) => { if (!(n.type.name === "island" && n.attrs.virtual)) blocks.push(n); });
    return blocks.length === 1 ? blocks[0] : null;
  }
  function says(text, node, store) {
    const parsed = parseBlock(text, store);
    return !!parsed && same(parsed, node);
  }

  /* The Markdown for a top-level block that is not as it was loaded.
   * d: { store, loaded } of the document. */
  function block(node, d, marker = null) {
    const store = d.store;
    const profile = store.profile || (store.profile = profileOf(store.text));
    if (node.type.name === "island" || node.type.name === "hidden") return node.attrs.raw;
    const was = node.attrs.bid == null ? null : d.loaded.get(node.attrs.bid);
    const seg = was ? store.segs[node.attrs.bid] : null;
    // marker: the list marker to use instead of the list's own (see document.js)
    const canon = (n, level) => canonical(n, { profile, level, swap: marker && n === node ? { node, marker } : null });
    if (node.type.name === "table") { // re-formatted as a whole; its unchanged cells keep their Markdown
      for (const level of [0, 1, 2]) {
        const text = canon(node, level);
        if (level === 2 || says(text, node, store)) return text;
      }
    }
    if (seg && was.type === node.type && /_list$/.test(node.type.name)) {
      const text = listByItem(node, was, seg, profile, marker, store);
      if (text != null) return text;
    }
    if (seg && was.type.name !== "island" && was.type.name !== "hidden") {
      for (const level of [0, 1, 2]) {
        const base = canon(was, level), now = canon(node, level);
        for (const reach of [0, 3, 12, Infinity]) {
          const merged = merge3(base, seg.raw, now, reach).replace(/^[ \t]*\n+|\n+$/g, "");
          if (says(merged, node, store)) return merged;
        }
      }
    }
    // a block that is new: wrapped, if the settings say so
    const wrap = Number((window.MdPrefs || {}).wrap) || 0;
    if (wrap > 0 && !seg) {
      for (const level of [0, 1, 2]) {
        const text = canonical(node, { profile, level, wrap, swap: marker ? { node, marker } : null });
        if (says(text, node, store)) return text;
      }
    }
    for (const level of [0, 1, 2]) {
      const text = canon(node, level);
      if (says(text, node, store)) return text;
    }
    // Nothing reads back as the same block (Markdown cannot say it, see expressible()): the plain
    // form is at least one block of the right kind, which a merge with the old text need not be.
    const text = canon(node, 0);
    A.markdown.onMismatch?.(node, text);
    return text;
  }
  /* A list is written item by item: an item that is as it was loaded keeps
   * its lines, one that changed is merged with its own lines, a new one is
   * written plainly. So one edit in a long list does not put the others at
   * the mercy of the merge. -> the text, or null if that does not work out. */
  function listByItem(node, was, seg, profile, marker, store) {
    const rawLines = seg.raw.split("\n");
    // the source lines of each loaded item (with the blank lines after it), by the line it starts on
    const starts = [];
    was.forEach((item) => starts.push(item.attrs.line == null ? null : item.attrs.line - seg.line));
    if (starts.some((l, i) => l == null || l < 0 || (i ? l <= starts[i - 1] : l !== 0))) return null;
    const rawOf = (i) => rawLines.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : rawLines.length);
    for (const level of [0, 1, 2]) {
      const cx = { profile, level, swap: marker ? { node, marker } : null };
      const now = listItems(node, cx), before = listItems(was, { profile, level, swap: null });
      // the loaded item each item is: unchanged, or the next one that started on the same line
      const from = [];
      let used = -1;
      node.forEach((item) => {
        let j = -1;
        for (let k = used + 1; k < was.childCount && j < 0; k++) if (was.child(k) === item || was.child(k).eq(item)) j = k;
        if (j < 0 && item.attrs.line != null) {
          for (let k = used + 1; k < was.childCount && j < 0; k++) if (was.child(k).attrs.line === item.attrs.line) j = k;
        }
        if (j >= 0) used = j;
        from.push(j);
      });
      const out = [];
      node.forEach((item, _o, i) => {
        const last = i === node.childCount - 1, j = from[i];
        let blanks = 0;
        if (j < 0) out.push(...now.items[i]); // new: written plainly
        else {
          const raw = rawOf(j);
          while (blanks < raw.length - 1 && !raw[raw.length - 1 - blanks].trim()) blanks++;
          const body = raw.slice(0, raw.length - blanks).join("\n");
          const same = was.child(j) === item || was.child(j).eq(item);
          out.push(...(same && !marker ? body : merge3(before.items[j].join("\n"), body, now.items[i].join("\n"), 0)).split("\n"));
        }
        if (last) return;
        // two items that followed each other keep what stood between them; elsewhere the list's spacing
        const kept = j >= 0 && from[i + 1] === j + 1;
        for (let k = 0; k < (kept ? blanks : Math.max(blanks, now.tight ? 0 : 1)); k++) out.push("");
      });
      const text = out.join("\n").replace(/\n+$/, "");
      if (says(text, node, store)) return text;
    }
    return null;
  }
  /* Can Markdown say this block at all? (Emphasis that starts with a bracket
   * right after a letter, "x*(y)*", cannot be written.) */
  function expressible(node, d) {
    const profile = d.store.profile || (d.store.profile = profileOf(d.store.text));
    return [0, 1, 2].some((level) => says(canonical(node, { profile, level }), node, d.store));
  }

  /* A block that no Markdown reads back as it is shown (emphasis that would run into the letters
   * beside it, …) is written in its plain form. That is said, once for each such text — else what
   * is on screen and what is in the file differ without a word. */
  const unsaid = new Set();
  const cannotSay = (_node, text) => {
    if (unsaid.has(text) || !window.MdView?.core?.toast) return;
    if (unsaid.size > 200) unsaid.clear();
    unsaid.add(text);
    window.MdView.core.toast(window.MdStrings.t("active.cannotSay"));
  };
  A.markdown = { onMismatch: cannotSay, plainOk, block, canonical, markerOf: (list, d) => markerOf(list, { profile: d.store.profile || (d.store.profile = profileOf(d.store.text)) }), merge3, same, shape, parseBlock, profileOf, escapeText, expressible };
})();
