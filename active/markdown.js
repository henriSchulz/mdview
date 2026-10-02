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
  function escapeText(str, level) {
    let s = str.replace(new RegExp(`\\\\(?=[${PUNCT}]|$)`, "g"), "\\\\");
    s = s.replace(/&(?=#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[a-zA-Z][a-zA-Z0-9]{1,31};)/g, "\\&");
    s = s.replace(/<(?=[a-zA-Z/!?])/g, "\\<");
    s = s.replace(/\n/g, "&#10;"); // a line break that is text (it came from an entity)
    if (level === 1) {
      s = s.replace(/[`[\]$~^]|\*|==|%%/g, (m) => "\\" + m)
        .replace(/_/g, (m, i, all) => (/[\p{L}\p{N}]/u.test(all[i - 1] || "") && /[\p{L}\p{N}]/u.test(all[i + 1] || "") ? m : "\\_"));
    } else if (level >= 2) {
      s = s.replace(new RegExp(`(?<!\\\\)[${PUNCT.replace("\\\\\\\\", "").replace("&", "").replace("<", "")}]`, "g"), (m) => "\\" + m);
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
      .replace(/^( {0,3})(`{3,}|~{3,})/, (m, a, b) => a + "\\" + b)
      .replace(/^( {0,3})([-_*=])(?=(?:[ \t]*\2)*[ \t]*$)/, (m, a, b) => (b === "=" && first ? m : a + "\\" + b))
      .replace(/^( {0,3})\$\$/, "$1\\$$$$")
      .replace(/^( {0,3}):(?=[ \t])/, "$1\\:")
      .replace(/^( {0,3})\[(?=[^\]]*\]:)/, "$1\\[")
      .replace(/^( {0,3})\|/, "$1\\|");
  }

  // ------------------------------------------------------------ inline
  const DELIM = { s: "~~", mark: "==", sub: "~", sup: "^" };
  const WRAPS = new Set(["mark", "link", "strong", "em", "s", "sub", "sup"]); // marks written as delimiters around text
  const wordChar = (c) => !!c && /[\p{L}\p{N}]/u.test(c);

  function inline(parent, cx) {
    const { profile, level } = cx;
    let out = "";
    const active = []; // marks open in the output, outermost first
    const kids = [];
    parent.forEach((n) => kids.push(n));
    // a block does not end in a break, nor in white space
    while (kids.length && kids[kids.length - 1].type.name === "hard_break") kids.pop();

    const open = (mark, next) => {
      switch (mark.type.name) {
        case "em": return emphasis(mark.attrs.markup || profile.em, out, next);
        case "strong": return emphasis(mark.attrs.markup || profile.strong, out, next);
        case "link": return mark.attrs.markup === "autolink" ? "<" : mark.attrs.markup === "linkify" ? "" : "[";
        default: return DELIM[mark.type.name];
      }
    };
    const close = (mark, opened, after) => {
      switch (mark.type.name) {
        case "link":
          if (mark.attrs.markup === "autolink") return ">";
          if (mark.attrs.markup === "linkify") return "";
          if (mark.attrs.ref) return "][" + mark.attrs.ref + "]";
          return "](" + linkTarget(mark.attrs.href) + (mark.attrs.title ? ' "' + mark.attrs.title.replace(/"/g, '\\"') + '"' : "") + ")";
        default: return opened;
      }
    };
    // `_` does not open or close inside a word; there `*` has to do
    const emphasis = (want, before, next) =>
      (want[0] === "_" && (wordChar(before[before.length - 1]) && wordChar(next)) ? (want.length === 2 ? "**" : "*") : want);

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

    for (let i = 0; i < kids.length; i++) {
      const node = kids[i];
      let text = node.isText ? node.text : null;
      const code = node.marks.find((m) => m.type.name === "code");
      let marks = node.marks.filter((m) => WRAPS.has(m.type.name));
      const nextKid = kids[i + 1];
      const lasts = (m) => !nextKid || !m.isInSet(nextKid.marks);

      // white space at the edge of a mark goes outside of it
      let lead = "", trail = "";
      if (text != null && !code) {
        if (marks.some((m) => !active.some((a) => a.mark.eq(m)))) {
          const m = /^\s+/.exec(text);
          if (m) { lead = m[0]; text = text.slice(lead.length); }
        }
        if (marks.some(lasts)) {
          const m = /\s+$/.exec(text);
          if (m) { trail = m[0]; text = text.slice(0, -trail.length); }
        }
        if (!text) { // only white space: it belongs to no mark that starts or ends here
          marks = marks.filter((m) => active.some((a) => a.mark.eq(m)) && !lasts(m));
        }
      }
      // keep what is open in the order it was opened, then the new ones
      const kept = active.filter((a) => marks.some((m) => m.eq(a.mark)));
      let keep = 0;
      while (keep < active.length && kept[keep] === active[keep]) keep++;
      const body = text != null ? (code ? codeSpan(text, code) : escapeText(text, level)) : leaf(node, cx);
      const first = body[0] || "";
      closeTo(keep, lead ? lead[0] : first);
      out += lead;
      const order = kept.slice(0, keep).map((a) => a.mark).concat(marks.filter((m) => !kept.slice(0, keep).some((a) => a.mark.eq(m))));
      for (let k = keep; k < order.length; k++) {
        if (!text && text != null) break;
        const delim = open(order[k], first);
        active.push({ mark: order[k], delim, at: out.length });
        out += delim;
      }
      out += body;
      if (trail) {
        // close what ends here before the space
        const ending = active.findIndex((a) => lasts(a.mark));
        if (ending >= 0) closeTo(ending, trail[0]);
        out += trail;
      }
    }
    closeTo(0, "");
    return out.replace(/[ \t]+$/, "");
  }
  function codeSpan(text, mark) {
    let longest = 0;
    for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
    let fence = mark.attrs.markup || "`";
    if (fence.length <= longest) fence = "`".repeat(longest + 1);
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
        return "![" + escapeText(alt, 1) + "](" + linkTarget(src) + (title ? ' "' + title.replace(/"/g, '\\"') + '"' : "") + ")";
      }
      case "iatom": return node.attrs.raw;
      default: return "";
    }
  }

  // ------------------------------------------------------------ blocks
  // -> lines of the block, without the marks of what it sits in
  function lines(node, cx) {
    switch (node.type.name) {
      case "paragraph":
        return inline(node, cx).split("\n").map((l, i) => guardLine(l, i === 0));
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
      case "blockquote": return children(node, cx, false).map((l) => (l ? "> " + l : ">"));
      case "bullet_list":
      case "ordered_list": return list(node, cx);
      case "island":
      case "hidden": return node.attrs.raw.split("\n");
      default: return [];
    }
  }
  // the blocks inside a quote or a list item, a blank line between them unless tight allows none
  function children(node, cx, tight) {
    const out = [];
    let prev = null;
    node.forEach((child) => {
      const ls = lines(child, cx);
      if (prev && !(tight && !(prev.type.name === "paragraph" && child.type.name === "paragraph"))) out.push("");
      out.push(...ls);
      prev = child;
    });
    return out;
  }
  function list(node, cx) {
    const ordered = node.type.name === "ordered_list";
    const { tight, start } = node.attrs;
    const nums = [];
    node.forEach((item) => nums.push(item.attrs.num));
    // "1. 1. 1." stays that way; anything else counts up
    const same = ordered && nums.length > 1 && nums.every((n) => n != null && Number(n) === start);
    const out = [];
    node.forEach((item, _o, i) => {
      const marker = ordered ? String(same ? start : start + i) + (node.attrs.markup || cx.profile.ordered)
        : item.attrs.markup || node.attrs.markup || cx.profile.bullet;
      const task = item.attrs.task != null && item.attrs.box ? `[${item.attrs.task}] ` : "";
      const width = marker.length + 1;
      const body = [];
      let prev = null;
      item.forEach((child) => {
        let ls = lines(child, cx);
        if (prev && !(tight && !(prev.type.name === "paragraph" && child.type.name === "paragraph"))) body.push("");
        // a list under a bullet may be indented further than the text needs (four spaces, a tab)
        const nested = /_list$/.test(child.type.name) && !ordered && prev ? cx.profile.indent : 0;
        if (nested === "\t") ls = ls.map((l) => (l ? "\t" + l : l));
        else if (nested > width) ls = ls.map((l) => (l ? " ".repeat(nested - width) + l : l));
        body.push(...ls);
        prev = child;
      });
      if (!tight && i > 0) out.push("");
      const pad = " ".repeat(width);
      body.forEach((l, k) => {
        if (k === 0) out.push((marker + " " + task + l).replace(/[ \t]+$/, ""));
        else out.push(l ? (l[0] === "\t" ? l : pad + l) : "");
      });
      if (!body.length) out.push(marker);
    });
    return out;
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
    heading: ["level"], ordered_list: ["start", "tight"], bullet_list: ["tight"], list_item: ["task"],
    image: ["src", "alt", "title"], iatom: ["kind", "raw"], hard_break: [], island: ["raw"], hidden: ["raw"],
  };
  function shape(node) {
    if (node.isTextblock) {
      const runs = [];
      node.forEach((n) => {
        // a bare URL and <an autolink> are links to what their text says
        const marks = n.marks.filter((m) => !/^(tag|abbr)$/.test(m.type.name) && !(m.type.name === "link" && m.attrs.markup === "linkify"))
          .map((m) => m.type.name + (m.type.name === "link" && m.attrs.markup !== "autolink" ? JSON.stringify([m.attrs.href, m.attrs.title || null]) : "")).sort().join("+");
        const what = n.isText ? n.text : "\u0000" + n.type.name + JSON.stringify((KEEP[n.type.name] || []).map((a) => n.attrs[a] ?? null));
        const last = runs[runs.length - 1];
        if (last && last[0] === marks) last[1] += what; else runs.push([marks, what]);
      });
      // a break at the end says nothing; white space counts once
      const flat = runs.map(([m, t]) => [m, t.replace(/\s+/g, " ")]).filter(([, t]) => t);
      if (flat.length) {
        const last = flat[flat.length - 1];
        last[1] = last[1].replace(/(\u0000hard_break\[\]|\s)+$/, "");
        if (!last[1]) flat.pop();
      }
      return [node.type.name, (KEEP[node.type.name] || []).map((a) => node.attrs[a] ?? null), flat];
    }
    const kids = [];
    node.forEach((n) => kids.push(shape(n)));
    const attrs = (KEEP[node.type.name] || []).map((a) => {
      const v = node.attrs[a] ?? null;
      return a === "raw" ? String(v).replace(/[ \t]+$/gm, "").trim() : v;
    });
    return [node.type.name, attrs, kids];
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
  function block(node, d) {
    const store = d.store;
    const profile = store.profile || (store.profile = profileOf(store.text));
    if (node.type.name === "island" || node.type.name === "hidden") return node.attrs.raw;
    const was = node.attrs.bid == null ? null : d.loaded.get(node.attrs.bid);
    const seg = was ? store.segs[node.attrs.bid] : null;
    const canon = (n, level) => canonical(n, { profile, level });
    let first = null;
    if (seg && was.type.name !== "island" && was.type.name !== "hidden") {
      for (const level of [0, 1, 2]) {
        const base = canon(was, level), now = canon(node, level);
        for (const reach of [0, 3, 12, Infinity]) {
          const merged = merge3(base, seg.raw, now, reach);
          first ??= merged;
          if (says(merged, node, store)) return merged;
        }
      }
    }
    for (const level of [0, 1, 2]) {
      const text = canon(node, level);
      first ??= text;
      if (says(text, node, store)) return text;
    }
    // nothing reads back as the same block: write what is closest to the source
    A.markdown.onMismatch?.(node, first);
    return first;
  }
  /* Can Markdown say this block at all? (Emphasis that starts with a bracket
   * right after a letter, "x*(y)*", cannot be written.) */
  function expressible(node, d) {
    const profile = d.store.profile || (d.store.profile = profileOf(d.store.text));
    return [0, 1, 2].some((level) => says(canonical(node, { profile, level }), node, d.store));
  }

  A.markdown = { block, canonical, merge3, same, shape, parseBlock, profileOf, escapeText, expressible };
})();
