/* mdview active mode — tables: how one was written, and each cell's own
 * Markdown. Used by the builder (schema.js) and the serializer (markdown.js). */
"use strict";
(() => {
  const A = window.MdActive;

  // the Markdown of a cell, by the content it was built with (an unchanged cell keeps that object)
  const source = new WeakMap();

  // one line of a table -> the text of its cells
  function splitRow(line, trim = true) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (/(^|[^\\])\|$/.test(s)) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((c) => (trim ? c.trim() : c));
  }
  const cells = (raw) => (raw ? raw.split("\n").map((l) => splitRow(l)) : []);
  const alignOf = (delim) => (/^:-+:$/.test(delim) ? "center" : /^:-+$/.test(delim) ? "left" : /^-+:$/.test(delim) ? "right" : null);

  /* How a table was formatted: { leading, trailing, spaced, aligned, delims, indent }.
   * aligned: the pipes stand under each other (cells padded to their column). */
  function styleOf(raw) {
    if (!raw) return { leading: true, trailing: true, spaced: true, delimSpaced: true, aligned: true, byAlign: false, delims: [], indent: "", lines: [], cells: [] };
    const lines = raw.split("\n");
    const head = lines[0], pipes = (l) => [...l.matchAll(/(?<!\\)\|/g)].map((m) => m.index);
    const at = pipes(head);
    // padded towards its alignment (numbers flush right), as some formatters do?
    const delims = lines[1] ? splitRow(lines[1]) : [];
    const pads = delims.map((_d, c) => {
      let start = false, end = false;
      lines.forEach((l, i) => { if (i === 1) return; const cell = splitRow(l, false)[c] || ""; if (/^\s{2,}\S/.test(cell)) start = true; if (/\S\s{2,}$/.test(cell)) end = true; });
      return start && end ? "center" : start ? "right" : end ? "left" : null;
    });
    return {
      byAlign: pads.some((p) => p === "right" || p === "center") && pads.every((p, c) => !p || (p === "left" ? !/^(right|center)$/.test(alignOf(delims[c]) || "") : p === alignOf(delims[c]))),
      indent: /^[ \t]*/.exec(head)[0],
      leading: /^\s*\|/.test(head),
      trailing: /(^|[^\\])\|\s*$/.test(head),
      spaced: /\|\s|\s\|/.test(head) || !/\|/.test(head.trim().slice(1, -1)),
      aligned: lines.length > 1 && at.length > 1 && lines.every((l) => { const p = pipes(l); return p.length === at.length && p.every((x, i) => x === at[i]); }) && /\s{2,}\||-{4,}/.test(raw),
      delimSpaced: !!lines[1] && /\|\s|\s\|/.test(lines[1]),
      delims: lines[1] ? splitRow(lines[1]) : [],
      lines,
      cells: lines.map((l) => splitRow(l)),
    };
  }
  function delimiter(align, width, old) {
    if (old && alignOf(old) === align && (!width || old.length === width)) return old;
    if (!width && old) width = old.length;
    const w = Math.max(3, width || 3);
    return align === "center" ? ":" + "-".repeat(w - 2) + ":" : align === "left" ? ":" + "-".repeat(w - 1) : align === "right" ? "-".repeat(w - 1) + ":" : "-".repeat(w);
  }
  /* rows: the text of every cell, header first; aligns: per column. -> the table's lines.
   * A line whose cells stand as they stood is the line that was there, as long
   * as no column of a padded table changed its width. */
  function write(rows, aligns, style) {
    const cols = aligns.length, len = (t) => [...t].length;
    const widthsOf = (rs) => aligns.map((_a, c) => Math.max(3, ...rs.map((r) => len(r[c] || ""))));
    const width = style.aligned ? widthsOf(rows) : [];
    const was = style.cells, wasCols = was.length ? was[0].length : 0;
    const steady = wasCols === cols && (!style.aligned || widthsOf(was.filter((_r, i) => i !== 1)).every((w, c) => w === width[c]));
    const used = new Set([1]);
    const kept = (r, cellsOf) => {
      if (!steady) return null;
      for (let i = r === 0 ? 0 : 2; i < (r === 0 ? 1 : was.length); i++) {
        if (used.has(i) || was[i].length !== cols || !was[i].every((t, c) => t === cellsOf[c])) continue;
        used.add(i);
        return style.lines[i];
      }
      return null;
    };
    const line = (cellsOf, delim) => {
      const spaced = delim ? style.delimSpaced : style.spaced;
      const padded = cellsOf.map((t, c) => {
        if (!style.aligned || delim) return t;
        const gap = Math.max(0, width[c] - len(t)), how = style.byAlign ? aligns[c] : null;
        const before = how === "right" ? gap : how === "center" ? Math.floor(gap / 2) : 0;
        return " ".repeat(before) + t + " ".repeat(gap - before);
      });
      const body = spaced ? padded.join(" | ") : padded.join("|");
      const out = (style.leading ? (spaced ? "| " : "|") : "") + body + (style.trailing ? (spaced ? " |" : "|") : "");
      return style.indent + (style.trailing ? out : out.trimEnd());
    };
    const fill = (r) => Array.from({ length: cols }, (_v, c) => r[c] || "");
    const out = rows.map((r, i) => kept(i, fill(r)) ?? line(fill(r)));
    const delims = steady && style.delims.length === cols && style.delims.every((d, c) => alignOf(d) === aligns[c])
      ? style.lines[1]
      : line(aligns.map((a, c) => delimiter(a, style.aligned ? width[c] + (style.spaced && !style.delimSpaced ? 2 : 0) : 0, style.delims[c])), true);
    out.splice(1, 0, delims);
    return out;
  }

  A.tables = { source, cells, splitRow, styleOf, alignOf, write };
})();
