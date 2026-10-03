/* mdview active mode — writing LaTeX fast, the way Obsidian LaTeX Suite does it
 * (https://github.com/artisticat1/obsidian-latex-suite, MIT): snippets with
 * tabstops, auto-fraction, matrix shortcuts, tabout, auto-enlarged brackets.
 * The snippets themselves are that plugin's (latex-snippets.js); this file is
 * the machinery, written for the formula editor (a textarea) instead of
 * CodeMirror.
 *
 * The keys, in the order they are tried (as in the plugin):
 *   a character   automatic snippets ("sr" → ^{2}); with a selection, visual snippets ("U" → \underbrace)
 *   /             auto-fraction: what stands before it becomes the numerator
 *   Tab           a snippet that waits for Tab ("par") · the next tabstop · in a matrix: out of a
 *                 bracket, else " & " · over the next closing bracket · at the end: out of the formula
 *   Shift+Tab     the tabstop before
 *   Enter         in a matrix: " \\" and a new line
 *   Shift+Enter   in a matrix: to the end of the next line (out of the matrix) */
"use strict";
(() => {
  const A = window.MdActive;
  const D = A.latexDefaults;

  const SETTINGS = {
    wordDelimiters: "., +-\n\t:;!?\\/{}[]()=~$'\"|`<>*^%#@&",
    autofractionSymbol: "\\frac",
    autofractionBreakingChars: "+-=\t",
    autofractionExcluded: ["^", "pu"], // (inside ^{…} and \pu{…})
    matrixEnvs: ["pmatrix", "cases", "align", "gather", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "array", "matrix"],
    matrixMacros: ["eqalign"],
    taboutClosing: new Set([")", "]", "\\rbrack", "\\}", "\\rbrace", "\\rangle", "\\rvert", "\\rVert", "\\rfloor", "\\rceil", "\\urcorner", "}"]),
    enlargeTriggers: ["sum", "int", "frac", "prod", "bigcup", "bigcap"],
    removeSnippetWhitespace: true,
  };
  // where a macro's argument is text, and where nothing is expanded at all (the plugin's lists)
  const TEXT_AREAS = { text: [0], textrm: [0], textup: [0], textit: [0], textbf: [0], textsf: [0], texttt: [0], textnormal: [0], clap: [0], textllap: [0], textrlap: [0], textclap: [0], hbox: [0], mbox: [0], fbox: [0], framebox: [0], colorbox: [1], fcolorbox: [2] };
  const SNIPPETLESS = { tag: [0], begin: [0], end: [0], mmlToken: [0, 1], unicode: [0], textcolor: [0], color: [0], colorbox: [0], fcolorbox: [0, 1], operatorname: [0], style: [0] };

  // ---------------------------------------------------------------- snippets, made ready
  const macroSpec = (m) => (typeof m === "string" ? { name: m, arguments: [0] } : m);
  function compile(raw, variables = D.variables) {
    const out = [];
    raw.forEach((r, i) => {
      try {
        const o = r.options || "";
        const isRe = r.trigger instanceof RegExp;
        const regex = isRe || o.includes("r");
        let trigger = r.trigger;
        if (regex) {
          let src = isRe ? r.trigger.source : r.trigger;
          for (const [k, v] of Object.entries(variables)) src = src.split(k.startsWith("${") ? k : "${" + k + "}").join(v);
          const flags = (isRe ? r.trigger.flags : "") + (r.flags || "");
          const Ctor = isRe && r.trigger.constructor !== RegExp ? r.trigger.constructor : RegExp;
          trigger = new Ctor(`(?:${src})$`, [...new Set(flags.replace(/[gy]/g, ""))].join(""));
        } else if (typeof trigger === "string") {
          for (const [k, v] of Object.entries(variables)) trigger = trigger.split(k.startsWith("${") ? k : "${" + k + "}").join(v);
        } else return;
        const visual = o.includes("v") || (typeof r.replacement === "string" && r.replacement.includes("${VISUAL}") && !regex && trigger.length <= 1);
        const anyMode = !/[tmMncCT]/.test(o);
        out.push({
          trigger, regex, visual, replacement: r.replacement, i,
          auto: o.includes("A") || visual, word: o.includes("w"), skipUndo: o.includes("U"),
          text: anyMode || o.includes("t"),
          inline: anyMode || /[mnT]/.test(o), block: anyMode || /[mMT]/.test(o), textEnv: o.includes("T"), anyMode,
          priority: r.priority || 0, length: regex ? (isRe ? r.trigger.source : r.trigger).length : trigger.length,
          excludedMacros: (r.excludedMacros || []).map(macroSpec), includedMacros: (r.includedMacros || []).map(macroSpec),
          excludedEnvironments: r.excludedEnvironments || [], description: r.description || "",
        });
      } catch (e) { console.warn("latex suite: a snippet could not be read", r, e); }
    });
    // by priority, then the longer trigger first (in the order given, where both are the same)
    return out.sort((a, b) => b.priority - a.priority || b.length - a.length || a.i - b.i);
  }

  // ---------------------------------------------------------------- where the caret is
  /* What the caret stands in, innermost first: { kind: "command", name, arg } for an argument of a
   * macro ("^" and "_" count as macros), { kind: "environment", name } for \begin{name}, { kind: "group" }
   * for braces of their own. */
  function stackAt(text, pos) {
    const st = [];
    let pending = null, closed = null, closedAt = -1, opt = false;
    for (let i = 0; i < pos; i++) {
      const ch = text[i];
      if (ch === "\\") {
        const m = /^[a-zA-Z]+\*?/.exec(text.slice(i + 1, i + 40));
        if (m) { pending = m[0]; i += m[0].length; if (i >= pos) break; }
        else { pending = null; i++; }
        continue;
      }
      if (ch === "{") {
        const prev = text[i - 1];
        if (pending) st.push({ kind: "command", name: pending, arg: 0, at: i });
        else if (closed && closedAt === i) st.push({ kind: "command", name: closed.name, arg: closed.arg + 1, at: i });
        else if (prev === "^" || prev === "_") st.push({ kind: "command", name: prev, arg: 0, at: i });
        else st.push({ kind: "group", at: i });
        pending = null; opt = false;
        continue;
      }
      if (ch === "}") {
        let k = st.length - 1;
        while (k >= 0 && st[k].kind === "environment") k--;
        if (k >= 0) {
          const f = st.splice(k, 1)[0];
          closed = null;
          if (f.kind === "command") {
            closed = f; closedAt = i + 1;
            const inner = text.slice(f.at + 1, i);
            if (f.name === "begin" && f.arg === 0) { st.push({ kind: "environment", name: inner, at: i + 1 }); closed = null; }
            else if (f.name === "end" && f.arg === 0) {
              let e = st.length - 1;
              while (e >= 0 && !(st[e].kind === "environment" && st[e].name === inner)) e--;
              if (e >= 0) st.length = e;
              closed = null;
            }
          }
        }
        pending = null;
        continue;
      }
      if (ch === "[" && pending) { opt = true; continue; }
      if (ch === "]" && opt) { opt = false; continue; }
      if (opt || ch === " " || ch === "\t") continue;
      pending = null;
    }
    return st.reverse();
  }
  const inArea = (f, area) => !!area[f.name] && area[f.name].includes(f.arg);
  const matches = (f, specs) => specs.some((s) => s.name === f.name && (!s.arguments || s.arguments.includes(f.arg)));
  function contextAt(text, pos, block) {
    const stack = stackAt(text, pos);
    let textEnv = false, snippetless = false;
    for (const f of stack) {
      if (f.kind !== "command") continue;
      if (inArea(f, SNIPPETLESS)) snippetless = true;
      else if (inArea(f, TEXT_AREAS)) textEnv = true;
      break;
    }
    return { block: !!block, inline: !block, textEnv, snippetless, stack };
  }
  function runsIn(s, ctx) {
    const cmd = ctx.stack.find((f) => f.kind === "command");
    if (s.includedMacros.length) return !!cmd && matches(cmd, s.includedMacros);
    if (ctx.snippetless) return false;
    if (!((s.inline && ctx.inline) || (s.block && ctx.block))) return false;
    if (!s.anyMode && s.textEnv !== ctx.textEnv) return false;
    for (const f of ctx.stack) {
      if (f.kind === "environment") { if (s.excludedEnvironments.includes(f.name)) return false; }
      else if (f.kind === "command" && matches(f, s.excludedMacros)) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- a replacement, laid out
  /* "$0", "${1:text}" → the text and its tabstops: { text, stops: [{ n, from, to }] } */
  function layout(raw) {
    let text = "";
    const stops = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "$") {
        const d = /^\d+/.exec(raw.slice(i + 1, i + 6));
        if (d) { stops.push({ n: +d[0], from: text.length, to: text.length }); i += d[0].length; continue; }
        const b = /^\{(\d+):/.exec(raw.slice(i + 1, i + 8));
        if (b) {
          let depth = 1, j = i + 1 + b[0].length;
          for (; j < raw.length && depth; j++) { if (raw[j] === "{") depth++; else if (raw[j] === "}") depth--; }
          if (!depth) {
            const inner = raw.slice(i + 1 + b[0].length, j - 1);
            stops.push({ n: +b[1], from: text.length, to: text.length + inner.length });
            text += inner;
            i = j - 1;
            continue;
          }
        }
      }
      text += raw[i];
    }
    return { text, stops };
  }

  /* One snippet against what stands before the caret (and the key being typed):
   * { from, raw } — replace from `from` to the caret with raw — or null. */
  function attempt(s, before, key, sel) {
    const line = before + key;
    let from, arg, captures = [];
    if (s.visual) {
      if (!sel || !key || s.trigger !== key) return null;
      from = before.length;
      arg = sel;
    } else {
      if (sel) return null;
      if (s.regex) {
        const m = s.trigger.exec(line);
        if (!m) return null;
        from = m.index; arg = m; captures = m.slice(1);
      } else {
        if (!line.endsWith(s.trigger)) return null;
        from = line.length - s.trigger.length; arg = s.trigger;
      }
    }
    let raw = s.replacement;
    if (typeof raw === "function") { raw = raw(arg, {}); if (typeof raw !== "string") return null; }
    else if (typeof raw !== "string") return null;
    else {
      if (s.regex) raw = raw.replace(/\[\[(\d+)\]\]/g, (_m, n) => captures[+n] ?? "");
      if (s.visual) raw = raw.split("${VISUAL}").join(sel);
    }
    return { from: Math.min(from, before.length), raw };
  }

  /* The snippets against a state: { text, from, to (the selection), block }.
   * -> { from, to, text, stops, enlarge } to put in, { pass: true } to let the key be typed and
   * look no further, or null. automatic: the ones that run as one types, or the ones that wait for Tab. */
  function run(list, state, key, automatic, settings = SETTINGS) {
    // (the snippets were written for a note, where the formula stands behind its dollars: "sin" at
    // the very start is found by what stands before it)
    const lead = state.block ? "$$\n" : "$";
    const before = lead + state.text.slice(0, state.from), sel = state.text.slice(state.from, state.to), after = state.text.slice(state.to);
    const ctx = contextAt(state.text, state.to, state.block);
    for (const s of list) {
      if (s.auto !== automatic || !runsIn(s, ctx)) continue;
      const r = attempt(s, before, key, sel);
      if (!r) continue;
      if (s.word) {
        const prev = r.from > 0 ? before[r.from - 1] : "", next = after[0] || "";
        if (!settings.wordDelimiters.includes(prev) || !settings.wordDelimiters.includes(next)) continue;
      }
      const out = layout(r.raw);
      if (!out.stops.length && out.text === before.slice(r.from) + key && !sel) return { pass: true };
      if (r.from < lead.length) { // it took the dollars along: they stay where they are
        const cut = lead.length - r.from;
        if (!out.text.startsWith(lead.slice(r.from))) continue;
        out.text = out.text.slice(cut);
        for (const t of out.stops) { t.from = Math.max(0, t.from - cut); t.to = Math.max(0, t.to - cut); }
        r.from = lead.length;
      }
      r.from -= lead.length;
      if (ctx.inline && settings.removeSnippetWhitespace) {
        out.text = out.text.trimEnd();
        for (const t of out.stops) { t.from = Math.min(t.from, out.text.length); t.to = Math.min(t.to, out.text.length); }
      }
      return { from: r.from, to: state.to, text: out.text, stops: out.stops, enlarge: settings.enlargeTriggers.some((w) => out.text.includes(w)), snippet: s };
    }
    return null;
  }

  // ---------------------------------------------------------------- auto-fraction
  const OPENER = { ")": "(", "]": "[", "}": "{" };
  function matchBack(str, i, open, close) { // the opening bracket of the closing one at i
    let depth = 0;
    for (let j = i; j >= 0; j--) {
      if (str[j] === close) depth++;
      else if (str[j] === open && --depth === 0) return j;
    }
    return null;
  }
  function matchForward(str, i, open, close) {
    let depth = 0;
    for (let j = i; j < str.length; j++) {
      if (str[j] === open) depth++;
      else if (str[j] === close && --depth === 0) return j;
    }
    return null;
  }
  const GREEK_SPACE = /(alpha|beta|gamma|Gamma|delta|Delta|epsilon|varepsilon|zeta|eta|theta|Theta|iota|kappa|lambda|Lambda|mu|nu|omicron|xi|Xi|pi|Pi|rho|sigma|Sigma|tau|upsilon|Upsilon|varphi|phi|Phi|chi|psi|Psi|omega|Omega) ([^ ])/g;
  function autofraction(state, settings = SETTINGS) {
    const ctx = contextAt(state.text, state.to, state.block);
    if (ctx.textEnv || ctx.snippetless) return null;
    if (ctx.stack.some((f) => f.kind === "command" && settings.autofractionExcluded.includes(f.name))) return null;
    let start = 0;
    if (state.from !== state.to) start = state.from;
    else {
      const cur = state.text.slice(0, state.to).replace(GREEK_SPACE, "$1#$2"); // (a space after a Greek letter does not end it)
      for (let i = cur.length - 1; i >= 0; i--) {
        const ch = cur[i];
        if (OPENER[ch]) {
          const j = matchBack(cur, i, OPENER[ch], ch);
          if (j == null) return null;
          i = j;
        }
        if ((" $([{\n" + settings.autofractionBreakingChars).includes(ch)) { start = i + 1; break; }
      }
    }
    if (start === state.to) return null;
    let num = state.text.slice(start, state.to);
    if (num[0] === "(" && num[num.length - 1] === ")" && matchForward(num, 0, "(", ")") === num.length - 1) num = num.slice(1, -1);
    const out = layout(settings.autofractionSymbol + "{" + (num === "" ? "$0" : num.replace(/\$/g, "\uE000")) + "}{$1}$2");
    out.text = out.text.replace(/\uE000/g, "$");
    return { from: start, to: state.to, text: out.text, stops: out.stops, enlarge: true };
  }

  // ---------------------------------------------------------------- tokens, tabout, brackets
  function tokenize(str) {
    const out = [], re = /\\[a-zA-Z]+|\\[^a-zA-Z]|[^\\\s]|\\$/g;
    for (let m; (m = re.exec(str)); ) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  }
  const LEFT = new Set(["\\left", "\\bigl", "\\Bigl", "\\biggl", "\\Biggl"]);
  const RIGHT = new Set(["\\right", "\\bigr", "\\Bigr", "\\biggr", "\\Biggr"]);
  const DELIMS = new Set(["(", ")", "[", "]", "\\lbrack", "\\rbrack", "\\{", "\\}", "\\lbrace", "\\rbrace", "<", ">", "\\langle", "\\rangle", "\\lt", "\\gt", "|", "\\vert", "\\lvert", "\\rvert", "\\|", "\\Vert", "\\lVert", "\\rVert", "\\lfloor", "\\rfloor", "\\lceil", "\\rceil", "\\ulcorner", "\\urcorner", "/", "\\\\", "\\backslash", "\\uparrow", "\\downarrow", "\\Uparrow", "\\Downarrow", "."]);
  const PAIRS = { "(": ")", "[": "]", "{": "}", "\\lbrack": "\\rbrack", "\\lbrace": "\\rbrace", "\\langle": "\\rangle", "\\lvert": "\\rvert", "\\lVert": "\\rVert", "\\lfloor": "\\rfloor", "\\lceil": "\\rceil", "\\ulcorner": "\\urcorner", "<": ">" };
  /* Tab with nothing else to do: { pos } behind the next closing bracket, { exit: true } at the
   * formula's end, or null. */
  function tabout(text, pos, settings = SETTINGS) {
    const tokens = tokenize(text);
    let i = tokens.findIndex((t) => t.end > pos);
    if (i < 0) i = tokens.length;
    for (; i < tokens.length; i++) {
      const t = tokens[i], prev = tokens[i - 1];
      const closing = prev && RIGHT.has(prev.text) && DELIMS.has(t.text) ? true : prev && LEFT.has(prev.text) && DELIMS.has(t.text) ? false : settings.taboutClosing.has(t.text);
      if (closing) return { pos: t.end };
      if (RIGHT.has(t.text) && !(tokens[i + 1] && DELIMS.has(tokens[i + 1].text))) return { pos: t.end }; // (a \right without its bracket: there)
    }
    return text.slice(pos).trim() === "" ? { exit: true } : null;
  }
  // behind the bracket that closes what the caret is in, within this text (the rest of a line)
  function closingIn(str, settings = SETTINGS) {
    const closers = new Set(Object.values(PAIRS).filter((c) => settings.taboutClosing.has(c)));
    const openers = new Set(Object.keys(PAIRS).filter((o) => closers.has(PAIRS[o])));
    let depth = 0;
    for (const t of tokenize(str)) {
      if (closers.has(t.text)) { if (!depth) return t.end; depth--; }
      else if (openers.has(t.text)) depth++;
    }
    return null;
  }
  /* Brackets around a sum, an integral, a fraction: \left … \right. -> the changes, last first:
   * [{ from, to, insert }] */
  const SIZED = new Set(["\\big", "\\Big", "\\bigg", "\\Bigg", "\\bigl", "\\Bigl", "\\biggl", "\\Biggl", "\\bigr", "\\Bigr", "\\biggr", "\\Biggr", "\\left", "\\right"]);
  const ENLARGE = { "(": ")", "[": "]", "\\{": "\\}", "\\langle": "\\rangle", "\\lvert": "\\rvert" };
  function enlarge(text, settings = SETTINGS) {
    const tokens = tokenize(text), open = [], edits = [];
    const closers = new Set(Object.values(ENLARGE));
    tokens.forEach((t, i) => {
      if (ENLARGE[t.text]) {
        const prev = tokens[i - 1];
        // (the [ of \sqrt[3] or \\[1em] is no bracket)
        const arg = t.text === "[" && prev && prev.end === t.start && /^\\([a-zA-Z]+|\\)$/.test(prev.text) && !SIZED.has(prev.text);
        if (!arg) open.push({ t, sized: !!prev && SIZED.has(prev.text) });
      } else if (closers.has(t.text)) {
        let k = open.length - 1;
        while (k >= 0 && ENLARGE[open[k].t.text] !== t.text) k--;
        if (k < 0) return;
        const o = open[k];
        open.length = k;
        if (o.sized) return;
        const inner = text.slice(o.t.end, t.start);
        if (!settings.enlargeTriggers.some((w) => inner.includes(w))) return;
        edits.push({ from: o.t.start, to: o.t.end, insert: "\\left" + o.t.text + (/^\s/.test(inner) ? "" : " ") });
        edits.push({ from: t.start, to: t.end, insert: (/\s$/.test(inner) ? "" : " ") + "\\right" + t.text });
      }
    });
    return edits.sort((a, b) => b.from - a.from);
  }

  // ---------------------------------------------------------------- matrices
  function inMatrix(ctx, settings = SETTINGS) {
    if (ctx.textEnv || ctx.snippetless) return false;
    const f = ctx.stack.find((x) => x.kind !== "group");
    return !!f && (f.kind === "environment" ? settings.matrixEnvs.includes(f.name) : settings.matrixMacros.includes(f.name));
  }
  const lineAt = (text, pos) => { const from = text.lastIndexOf("\n", pos - 1) + 1; let to = text.indexOf("\n", pos); if (to < 0) to = text.length; return { from, to, text: text.slice(from, to) }; };

  // ---------------------------------------------------------------- the user's own snippets
  /* A snippets file as the plugin reads it: "export default [ … ]", or just the array. */
  function parseUser(source) {
    const body = /export\s+default/.test(source) ? source.replace(/export\s+default/, "return ") : "return (" + source.replace(/;\s*$/, "") + "\n)";
    const list = new Function("require", body)(() => D.api); // eslint-disable-line no-new-func
    if (!Array.isArray(list)) throw new Error("a snippets file gives an array of snippets");
    return list;
  }
  let compiled = null;
  function snippets() {
    if (compiled) return compiled;
    let raw = D.snippets;
    const own = window.MdSnippets;
    if (typeof own === "function") {
      try { raw = own(() => D.api); if (!Array.isArray(raw)) throw new Error("the file gives no list of snippets"); } catch (e) { raw = D.snippets; console.warn("latex suite: the snippets file could not be read; using the built-in ones", e); if (window.MdView && window.MdView.toast) window.MdView.toast("snippets.js: " + (e.message || e)); }
    }
    return (compiled = compile(raw));
  }

  // ---------------------------------------------------------------- on a formula editor
  const prefs = () => ({ latexSnippets: true, latexFraction: true, latexMatrix: true, latexTabout: true, latexEnlarge: true, ...(window.MdPrefs || {}) });
  /* ed: the dialog's editor ({ input, insert, onKey, quiet }).
   * opts: { block: () => the formula stands on its own lines, exit: () => leave the formula } */
  function attach(ed, opts) {
    const input = ed.input;
    let stops = [], cur = -1; // groups of ranges: [{ ranges: [{ from, to }] }], and the one the caret is in
    let last = input.value, busy = false, viaIME = false;
    const state = () => ({ text: input.value, from: input.selectionStart, to: input.selectionEnd, block: !!opts.block() });
    const replace = (from, to, text) => { input.setSelectionRange(from, to); ed.insert(text); };
    const clear = () => { stops = []; cur = -1; paint(); };
    function paint() { ed.setStops ? ed.setStops(stops.flatMap((g, i) => (i === cur ? [] : g.ranges))) : 0; }

    // every change moves the tabstops with the text
    input.addEventListener("input", (e) => {
      const now = input.value, c = input.selectionStart, delta = now.length - last.length;
      let a, bOld, bNew;
      if (delta > 0 && last.slice(0, c - delta) === now.slice(0, c - delta) && last.slice(c - delta) === now.slice(c)) { a = bOld = c - delta; bNew = c; }
      else {
        a = 0;
        const max = Math.min(last.length, now.length);
        while (a < max && last[a] === now[a]) a++;
        let s = 0;
        while (s < max - a && last[last.length - 1 - s] === now[now.length - 1 - s]) s++;
        bOld = last.length - s; bNew = now.length - s;
      }
      const d = bNew - bOld;
      stops.forEach((g, gi) => {
        for (const r of g.ranges) {
          // (text typed at the end of the tabstop the caret is in belongs to it; any other change
          // at a tabstop's edge leaves it where it is)
          const grows = gi === cur && bOld === a && r.to === a;
          r.from = r.from <= a ? r.from : r.from >= bOld ? r.from + d : a;
          r.to = grows ? bNew : r.to <= a ? r.to : r.to >= bOld ? r.to + d : bNew;
          if (r.to < r.from) r.to = r.from;
        }
      });
      last = now;
      if (busy) return;
      mirror();
      left();
      paint();
      // text that came through an input method (a dead key, a composition): the snippets look at it now
      if (viaIME && !e.isComposing && /^insert(Text|CompositionText|FromComposition)$/.test(e.inputType || "")) { viaIME = false; typedChar(""); }
    });
    // the same text in every range of the tabstop the caret is in
    function mirror() {
      const g = stops[cur];
      if (!g || g.ranges.length < 2) return;
      const c = input.selectionStart, main = g.ranges.find((r) => c >= r.from && c <= r.to);
      if (!main) return;
      busy = true;
      const caret = { from: c, to: input.selectionEnd };
      g.ranges.push(caret); // (it moves with the text like a range)
      for (const r of g.ranges) {
        if (r === main || r === caret) continue;
        const text = input.value.slice(main.from, main.to);
        if (input.value.slice(r.from, r.to) !== text) replace(r.from, r.to, text);
      }
      g.ranges.pop();
      input.setSelectionRange(caret.from, caret.to);
      busy = false;
    }
    // the caret outside everything that is left of the snippet: its tabstops are gone
    function left() {
      if (!stops.length) return;
      const c = input.selectionStart, rs = stops.slice(Math.max(cur, 0)).flatMap((g) => g.ranges);
      if (!rs.length || c < Math.min(...rs.map((r) => r.from)) || c > Math.max(...rs.map((r) => r.to))) clear();
    }
    for (const type of ["keyup", "mouseup"]) input.addEventListener(type, () => { if (!busy) left(); });
    input.addEventListener("blur", clear);

    function go(i) {
      cur = i;
      const g = stops[i], r = g.ranges[0];
      input.setSelectionRange(r.from, r.to);
      input.dispatchEvent(new Event("select"));
      paint();
    }
    // put a result in: the text, its tabstops, larger brackets
    function apply(r) {
      busy = true;
      ed.quiet = true;
      replace(r.from, r.to, r.text);
      const groups = [];
      const list = r.stops.length ? r.stops : [{ n: 0, from: r.text.length, to: r.text.length }];
      for (const n of [...new Set(list.map((t) => t.n))].sort((x, y) => x - y)) {
        groups.push({ ranges: list.filter((t) => t.n === n).map((t) => ({ from: r.from + t.from, to: r.from + t.to })) });
      }
      // (a snippet inside a snippet: its tabstops first, then what was left of the one around it)
      stops = [...groups, ...stops.slice(cur + 1)];
      if (r.enlarge && prefs().latexEnlarge) for (const e of enlarge(input.value)) replace(e.from, e.to, e.insert);
      go(0);
      ed.quiet = false;
      busy = false;
      if (stops.length === 1 && stops[0].ranges.length === 1 && stops[0].ranges[0].from === stops[0].ranges[0].to) clear(); // (nothing to come back to)
      return true;
    }
    function typedChar(key) {
      const p = prefs(), st = state();
      if (p.latexSnippets) {
        const r = run(snippets(), st, key, true);
        if (r) return r.pass ? false : apply(r);
      }
      if (p.latexFraction && (key === "/" || (key === "" && st.from === st.to && st.text[st.to - 1] === "/"))) {
        const typed = key === "" ? 1 : 0; // (the slash is in the text already)
        const r = autofraction({ ...st, from: st.from - typed, to: st.to - typed });
        if (r) return apply({ ...r, to: r.to + typed });
      }
      return false;
    }
    function tab(back) {
      const p = prefs(), st = state();
      if (back) { if (stops.length && cur > 0) { go(cur - 1); return true; } return false; }
      if (p.latexSnippets) {
        const r = run(snippets(), st, "", false);
        if (r && !r.pass) return apply(r);
        if (stops.length && cur >= 0 && cur < stops.length - 1) { go(cur + 1); return true; }
        if (stops.length) clear();
      }
      if (st.from !== st.to) return false;
      const ctx = contextAt(st.text, st.to, st.block), matrix = p.latexMatrix && inMatrix(ctx);
      if (matrix && p.latexTabout) {
        const line = lineAt(st.text, st.to), end = closingIn(st.text.slice(st.to, line.to));
        if (end != null) { input.setSelectionRange(st.to + end, st.to + end); input.dispatchEvent(new Event("select")); return true; }
      }
      if (matrix) { ed.insert(" & "); return true; }
      if (p.latexTabout) {
        const t = tabout(st.text, st.to);
        if (t && t.pos != null) { input.setSelectionRange(t.pos, t.pos); input.dispatchEvent(new Event("select")); return true; }
        if (t && t.exit) { opts.exit(); return true; }
      }
      return false;
    }
    function enter(shift) {
      const p = prefs(), st = state();
      if (!p.latexMatrix || st.from !== st.to) return false;
      if (!inMatrix(contextAt(st.text, st.to, st.block))) return false;
      const line = lineAt(st.text, st.to);
      if (shift) { // to the end of the next line — behind the matrix, if it ends there
        if (!st.block) { opts.exit(); return true; }
        if (line.to >= st.text.length) return true;
        const next = lineAt(st.text, line.to + 1), m = /\\end{([^}]*)}/.exec(next.text);
        const to = m && SETTINGS.matrixEnvs.includes(m[1]) ? next.from + m.index + m[0].length : next.to;
        input.setSelectionRange(to, to);
        input.dispatchEvent(new Event("select"));
        return true;
      }
      const m = /(\\begin{[^\]]*}|\\\\|^)((?:\s|&)+)/.exec(line.text); // (the cells this line began with: the next begins the same)
      const cells = m ? m[2].trimStart() : "";
      if (st.block) ed.insert(" \\\\\n" + /^[ \t]*/.exec(line.text)[0] + cells);
      else ed.insert(" \\\\  " + cells);
      return true;
    }
    ed.onKey = (e) => {
      if (e.key === "Dead" || e.key === "Process" || e.key === "Unidentified") { viaIME = true; return false; }
      if (e.metaKey || (e.ctrlKey && !e.altKey)) return false; // (a shortcut; AltGr is Ctrl+Alt)
      let done = false;
      if (e.key.length === 1) { viaIME = false; done = typedChar(e.key); }
      else if (e.key === "Tab") done = tab(e.shiftKey);
      else if (e.key === "Enter") done = enter(e.shiftKey);
      if (done) e.preventDefault();
      return done;
    };
    return {
      // \boxed{ … } around the formula
      box() {
        const v = input.value, c = input.selectionStart, block = opts.block() && /\n/.test(v);
        busy = true;
        replace(0, v.length, block ? "\\boxed{\n" + v + "\n}" : "\\boxed{" + v + "}");
        busy = false;
        clear();
        const at = c + (block ? 8 : 7);
        input.setSelectionRange(at, at);
      },
    };
  }

  A.latexsuite = { attach, core: { compile, contextAt, stackAt, layout, run, autofraction, tabout, closingIn, enlarge, inMatrix, tokenize, parseUser, SETTINGS }, snippets, reset() { compiled = null; } };
})();
