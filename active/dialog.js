/* mdview active mode — the dialog an island is edited in, the code editor
 * inside it, and the small popover for inline things (a formula, a picture).
 *
 * The dialog grows out of the island and shrinks back into it (transform and
 * opacity only, henri-ui timing). Ctrl+Enter or a click beside it takes what
 * was entered, Esc drops it.
 *
 * The editor is the source editor's kind: a <textarea> with transparent
 * glyphs (native caret, undo, IME) under a highlighted copy of its text. It
 * highlights with highlight.js, the same as code in the document, so code
 * looks the same in the dialog as on the page.
 */
"use strict";
(() => {
  const A = window.MdActive;
  const { esc } = window.MdView.core;
  const T = window.MdStrings.t;
  const el = (tag, attrs = {}, html = "") => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    e.innerHTML = html;
    return e;
  };

  // ------------------------------------------------------------ code editor
  const latex = (src) => esc(src).replace(/(%[^\n]*)|(\\(?:[a-zA-Z]+|.))|([{}[\]])|(\b\d+(?:\.\d+)?\b)/g, (m, comment, cmd, brace, num) =>
    comment ? `<span class="hljs-comment">${comment}</span>` : cmd ? `<span class="hljs-keyword">${cmd}</span>`
      : brace ? `<span class="hljs-tag">${brace}</span>` : `<span class="hljs-number">${num}</span>`);
  function highlight(text, language) {
    if (language === "latex") return latex(text);
    try {
      if (language && hljs.getLanguage(language)) return hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch (e) { /* plain */ }
    return esc(text);
  }
  const PAIRS = { "{": "}", "(": ")", "[": "]" };

  /* -> { el, value, setLanguage, focus, setError, onInput } */
  // LaTeX commands to complete: [name, number of {} arguments]
  const LATEX = [
    ...["alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
      "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega"].map((n) => [n, 0]),
    ...[["frac", 2], ["dfrac", 2], ["tfrac", 2], ["sqrt", 1], ["binom", 2], ["text", 1], ["textbf", 1], ["textit", 1], ["mathrm", 1], ["mathbf", 1], ["mathit", 1], ["mathbb", 1], ["mathcal", 1], ["mathfrak", 1], ["mathsf", 1], ["mathtt", 1],
      ["operatorname", 1], ["hat", 1], ["widehat", 1], ["bar", 1], ["overline", 1], ["underline", 1], ["vec", 1], ["dot", 1], ["ddot", 1], ["tilde", 1], ["widetilde", 1], ["overbrace", 1], ["underbrace", 1],
      ["boxed", 1], ["tag", 1], ["begin", 1], ["end", 1], ["color", 1], ["overset", 2], ["underset", 2], ["stackrel", 2], ["cancel", 1], ["phantom", 1]],
    ...["sum", "prod", "coprod", "int", "iint", "iiint", "oint", "lim", "limsup", "liminf", "sup", "inf", "max", "min", "arg", "det", "dim", "exp", "log", "ln", "lg", "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "gcd", "deg",
      "infty", "partial", "nabla", "cdot", "cdots", "ldots", "vdots", "ddots", "times", "div", "pm", "mp", "ast", "star", "circ", "bullet", "oplus", "otimes", "odot",
      "leq", "le", "geq", "ge", "neq", "ne", "approx", "equiv", "sim", "simeq", "cong", "propto", "ll", "gg", "prec", "succ", "preceq", "succeq",
      "in", "notin", "ni", "subset", "subseteq", "supset", "supseteq", "cup", "cap", "setminus", "emptyset", "varnothing", "forall", "exists", "nexists", "neg", "lnot", "land", "lor", "wedge", "vee",
      "to", "gets", "mapsto", "rightarrow", "leftarrow", "leftrightarrow", "Rightarrow", "Leftarrow", "Leftrightarrow", "implies", "iff", "uparrow", "downarrow", "longrightarrow", "longmapsto", "hookrightarrow",
      "left", "right", "big", "Big", "bigg", "Bigg", "langle", "rangle", "lfloor", "rfloor", "lceil", "rceil", "lvert", "rvert", "lVert", "rVert", "mid", "parallel", "perp", "angle",
      "quad", "qquad", "displaystyle", "textstyle", "limits", "nolimits", "hbar", "ell", "Re", "Im", "aleph", "prime", "degree", "dagger", "checkmark", "therefore", "because"].map((n) => [n, 0]),
  ].sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]));
  function editor({ value = "", language = "", pairs = false, label = "" } = {}) {
    const wrap = el("div", { class: "ce" },
      `<div class="ce-gutter" aria-hidden="true"></div><div class="ce-main"><div class="ce-line" aria-hidden="true"></div>` +
      `<pre class="ce-back" aria-hidden="true"><code class="hljs"></code></pre><pre class="ce-marks" aria-hidden="true"></pre><pre class="ce-marks ce-hl" aria-hidden="true"></pre>` +
      `<textarea class="ce-in" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off"></textarea></div>`);
    const gutter = wrap.firstChild, main = wrap.lastChild;
    const [line, back, marks, hl, input] = main.children;
    input.setAttribute("aria-label", label);
    input.value = value;
    const api = { el: wrap, input, onInput: null };
    let lang = language, error = null;
    const lineHeight = () => parseFloat(getComputedStyle(input).lineHeight) || 21;
    function paint() {
      const text = input.value;
      back.firstChild.innerHTML = (lang === "latex" && (window.MdPrefs || {}).latexBrackets !== false ? rainbow(highlight(text, lang)) : highlight(text, lang)) + "\n";
      const n = text.split("\n").length;
      if (gutter.childElementCount !== n) gutter.innerHTML = Array.from({ length: n }, (_v, i) => `<div>${i + 1}</div>`).join("");
      marks.innerHTML = error && error.pos <= text.length
        ? esc(text.slice(0, error.pos)) + `<span class="ce-err">${esc(text.slice(error.pos, error.pos + (error.len || 1)) || " ")}</span>` : "";
      caretLine();
    }
    function caretLine() {
      const at = input.selectionDirection === "backward" ? input.selectionStart : input.selectionEnd;
      const row = input.value.slice(0, at).split("\n").length - 1;
      line.style.transform = `translateY(${row * lineHeight()}px)`;
      for (const [i, d] of [...gutter.children].entries()) d.classList.toggle("on", i === row);
      highlights();
    }
    // ---- a second layer: the bracket that belongs to the one at the caret, and what a search found
    let hits = [], hit = -1;
    const OPEN = "([{", CLOSE = ")]}";
    function partner(text, at) { // the bracket next to the caret and its partner: [a, b] or null
      for (const i of [at - 1, at]) {
        const ch = text[i];
        if (ch == null || text[i - 1] === "\\") continue;
        const o = OPEN.indexOf(ch), c = CLOSE.indexOf(ch);
        if (o < 0 && c < 0) continue;
        const dir = o >= 0 ? 1 : -1, mine = ch, other = o >= 0 ? CLOSE[o] : OPEN[c];
        let depth = 0;
        for (let j = i; j >= 0 && j < text.length; j += dir) {
          if (text[j - 1] === "\\") continue;
          if (text[j] === mine) depth++;
          else if (text[j] === other && --depth === 0) return [Math.min(i, j), Math.max(i, j)];
          if (Math.abs(j - i) > 20000) break;
        }
        return null;
      }
      return null;
    }
    // the brackets the caret stands in (when it is next to none)
    function around(text, at) {
      const depth = [0, 0, 0];
      for (let i = at - 1; i >= 0 && at - i < 20000; i--) {
        if (text[i - 1] === "\\") continue;
        const o = OPEN.indexOf(text[i]), c = CLOSE.indexOf(text[i]);
        if (c >= 0) depth[c]++;
        else if (o >= 0 && depth[o]-- === 0) {
          let d = 0;
          for (let j = at; j < text.length && j - at < 20000; j++) {
            if (text[j - 1] === "\\") continue;
            if (text[j] === OPEN[o]) d++;
            else if (text[j] === CLOSE[o] && d-- === 0) return [i, j];
          }
          return null;
        }
      }
      return null;
    }
    // matching brackets in the same colour (LaTeX): the highlighted HTML, its brackets wrapped
    function rainbow(html) {
      let out = "", depth = 0, prev = "";
      for (let i = 0; i < html.length; i++) {
        const ch = html[i];
        if (ch === "<") { const e = html.indexOf(">", i); out += html.slice(i, e + 1); i = e; continue; }
        if (ch === "&") { const e = html.indexOf(";", i); out += html.slice(i, e + 1); i = e; prev = "&"; continue; }
        if ("([{".includes(ch)) out += `<span class="ce-b${depth++ % 3}">${ch}</span>`;
        else if (")]}".includes(ch)) out += `<span class="ce-b${(depth = Math.max(0, depth - 1)) % 3}">${ch}</span>`;
        else out += ch;
        prev = ch;
      }
      return out;
    }
    let stopMarks = [];
    function highlights() {
      const text = input.value, ranges = [];
      if (input.selectionStart === input.selectionEnd && document.activeElement === input) {
        const pair = partner(text, input.selectionStart) || (lang === "latex" ? around(text, input.selectionStart) : null);
        if (pair) ranges.push([pair[0], pair[0] + 1, "ce-match"], [pair[1], pair[1] + 1, "ce-match"]);
      }
      for (const r of stopMarks) if (r.to <= text.length) ranges.push([r.from, r.to, r.from === r.to ? "ce-stop none" : "ce-stop"]);
      hits.forEach(([a, b], i) => ranges.push([a, b, i === hit ? "ce-hit now" : "ce-hit"]));
      ranges.sort((x, y) => x[0] - y[0]);
      let out = "", at = 0;
      for (const [a, b, cls] of ranges) {
        if (a < at || (a === at && a === b && at > 0 && out.endsWith("</span>") && !cls.startsWith("ce-stop"))) continue;
        out += esc(text.slice(at, a)) + `<span class="${cls}">${esc(text.slice(a, b))}</span>`;
        at = b;
      }
      hl.innerHTML = ranges.length ? out + esc(text.slice(at)) : "";
    }
    // ---- searching in it: Ctrl+F
    let find = null;
    function openFind() {
      if (!find) {
        find = el("div", { class: "ce-find" }, `<input class="lp-field" type="search" spellcheck="false" aria-label="${esc(T("dialog.find"))}" placeholder="${esc(T("dialog.find"))}"><span class="ce-count"></span>`);
        const field = find.firstChild, count = find.lastChild;
        const run = () => {
          const q = field.value.toLowerCase(), text = input.value.toLowerCase();
          hits = [];
          if (q) for (let i = text.indexOf(q); i >= 0 && hits.length < 5000; i = text.indexOf(q, i + Math.max(1, q.length))) hits.push([i, i + q.length]);
          hit = hits.length ? Math.max(0, hits.findIndex(([a]) => a >= input.selectionStart)) : -1;
          show();
        };
        const show = () => {
          count.textContent = q() ? T("dialog.found", hits.length ? hit + 1 : 0, hits.length) : "";
          highlights();
          if (hit >= 0) { // into view in the editor's scrolling box
            const row = input.value.slice(0, hits[hit][0]).split("\n").length - 1, box = wrap.getBoundingClientRect(), y = row * lineHeight();
            if (y < wrap.scrollTop || y > wrap.scrollTop + box.height - 3 * lineHeight()) wrap.scrollTop = Math.max(0, y - box.height / 3);
          }
        };
        const q = () => field.value;
        field.addEventListener("input", run);
        field.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter" && hits.length) { e.preventDefault(); hit = (hit + (e.shiftKey ? -1 : 1) + hits.length) % hits.length; show(); }
          else if (e.key === "Escape") { e.preventDefault(); closeFind(true); }
        });
        find.run = run;
      }
      if (!find.isConnected) wrap.before(find);
      const field = find.firstChild;
      const sel = input.value.slice(input.selectionStart, input.selectionEnd);
      if (sel && !sel.includes("\n")) field.value = sel;
      field.focus();
      field.select();
      find.run();
    }
    function closeFind(selectHit) {
      if (!find || !find.isConnected) return;
      const h = hits[hit];
      find.remove();
      hits = []; hit = -1;
      input.focus({ preventScroll: true });
      if (selectHit && h) input.setSelectionRange(h[0], h[1]);
      highlights();
    }
    // ---- LaTeX commands, completed while they are typed
    let comp = null, compAt = -1, compSel = 0, compList = [];
    function caretXY() {
      const at = input.selectionStart, text = input.value, ls = text.lastIndexOf("\n", at - 1) + 1;
      const row = text.slice(0, at).split("\n").length - 1, col = text.slice(ls, at).replace(/\t/g, "    ").length;
      const cs = getComputedStyle(input), ctx = (caretXY.c ||= document.createElement("canvas").getContext("2d"));
      ctx.font = cs.font;
      return { x: parseFloat(cs.paddingLeft) + col * ctx.measureText("M").width, y: parseFloat(cs.paddingTop) + (row + 1) * lineHeight() };
    }
    function completions() {
      if (lang !== "latex" || input.selectionStart !== input.selectionEnd) return closeComp();
      const before = input.value.slice(Math.max(0, input.selectionStart - 30), input.selectionStart);
      const m = /\\([a-zA-Z]{1,})$/.exec(before);
      if (!m) return closeComp();
      compList = LATEX.filter(([name]) => name.startsWith(m[1]) && name !== m[1]).slice(0, 8);
      if (!compList.length) return closeComp();
      compAt = input.selectionStart - m[1].length;
      compSel = 0;
      if (!comp) { comp = el("div", { class: "ce-comp", role: "listbox" }); comp.addEventListener("mousedown", (e) => { e.preventDefault(); const i = [...comp.children].indexOf(e.target.closest(".ce-opt")); if (i >= 0) { compSel = i; accept(); } }); }
      comp.innerHTML = compList.map(([name, args], i) => `<div class="ce-opt${i === compSel ? " on" : ""}" role="option">\\${esc(name)}${esc(args ? "{…}".repeat(args) : "")}</div>`).join("");
      // over the dialog, not inside the editor's scrolling box (which would cut it off)
      const { x, y } = caretXY(), box = input.getBoundingClientRect();
      if (!comp.isConnected) document.body.appendChild(comp);
      comp.style.left = Math.max(8, Math.min(box.left + x, innerWidth - comp.offsetWidth - 8)) + "px";
      const below = box.top + y + 2;
      comp.style.top = (below + comp.offsetHeight > innerHeight - 8 ? box.top + y - lineHeight() - comp.offsetHeight - 2 : below) + "px";
    }
    function closeComp() { if (comp && comp.isConnected) comp.remove(); compList = []; }
    function accept() {
      const [name, args] = compList[compSel];
      const typedLen = input.selectionStart - compAt;
      input.setSelectionRange(compAt, compAt + typedLen);
      insert(name + "{}".repeat(args || 0), compAt + name.length + (args ? 1 : 0));
      closeComp();
    }
    const insert = (text, selA, selB) => {
      if (!document.execCommand("insertText", false, text)) { input.setRangeText(text, input.selectionStart, input.selectionEnd, "end"); input.dispatchEvent(new Event("input")); }
      if (selA != null) input.setSelectionRange(selA, selB ?? selA);
    };
    input.addEventListener("input", () => { paint(); if (api.quiet) closeComp(); else completions(); if (find && find.isConnected) find.run(); if (api.onInput) api.onInput(input.value); });
    input.addEventListener("blur", () => setTimeout(closeComp, 100));
    for (const type of ["keyup", "click", "focus", "select"]) input.addEventListener(type, caretLine);
    input.addEventListener("keydown", (e) => {
      // undo and redo in the field itself (Ctrl or Super; the key alone did nothing here)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
        e.preventDefault(); e.stopPropagation();
        closeComp();
        document.execCommand(e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") { e.preventDefault(); e.stopPropagation(); openFind(); return; }
      if (compList.length && comp && comp.isConnected) { // the completion list has the arrows, Enter and Tab
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          compSel = (compSel + (e.key === "ArrowDown" ? 1 : -1) + compList.length) % compList.length;
          [...comp.children].forEach((c, i) => c.classList.toggle("on", i === compSel));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(); return; }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeComp(); return; }
      }
      if (e.key === "Escape" && find && find.isConnected) { e.preventDefault(); e.stopPropagation(); closeFind(false); return; }
      if (api.onKey && !e.isComposing && api.onKey(e)) { caretLine(); return; } // (LaTeX Suite: snippets, tabstops, tabout)
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = input.value, s = input.selectionStart, t = input.selectionEnd;
      if (e.key === "Tab") { // indents here; the dialog's buttons are reached with the mouse or Ctrl+Enter / Esc
        e.preventDefault();
        const unit = /^\t/m.test(v) ? "\t" : "    ";
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        if (s === t && !e.shiftKey) { insert(unit); return; }
        let le = v.indexOf("\n", t > s && v[t - 1] === "\n" ? t - 1 : t);
        if (le < 0) le = v.length;
        const lines = v.slice(ls, le).split("\n");
        const out = lines.map((l) => (e.shiftKey ? l.replace(/^(?:\t| {1,4})/, "") : l && unit + l)).join("\n");
        input.setSelectionRange(ls, le);
        insert(out, ls, ls + out.length);
      } else if (e.key === "Enter" && !e.shiftKey && s === t) {
        e.preventDefault();
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        const indent = /^[ \t]*/.exec(v.slice(ls, s))[0];
        const begin = pairs && /\\begin\{([^}]+)\}[ \t]*$/.exec(v.slice(ls, s));
        if (begin && !v.slice(s).includes(`\\end{${begin[1]}}`)) insert(`\n${indent}  \n${indent}\\end{${begin[1]}}`, s + indent.length + 3);
        else insert("\n" + indent);
      } else if (pairs && PAIRS[e.key] && s === t) {
        e.preventDefault();
        insert(e.key + PAIRS[e.key], s + 1);
      } else if (pairs && Object.values(PAIRS).includes(e.key) && s === t && v[s] === e.key) {
        e.preventDefault(); // type over the bracket that was closed for you
        input.setSelectionRange(s + 1, s + 1);
        caretLine();
      } else if (e.key === "Backspace" && pairs && s === t && PAIRS[v[s - 1]] && v[s] === PAIRS[v[s - 1]]) {
        e.preventDefault();
        input.setSelectionRange(s - 1, s + 1);
        insert("");
      }
    });
    Object.defineProperty(api, "value", { get: () => input.value, set: (t) => { input.value = t; paint(); } });
    api.setLanguage = (l) => { lang = l; paint(); };
    api.find = openFind;
    api.setError = (e) => { error = e; paint(); };
    api.setStops = (ranges) => { stopMarks = ranges.map((r) => ({ from: r.from, to: r.to })); highlights(); };
    api.insert = (text, selA, selB) => { input.focus({ preventScroll: true }); insert(text, selA, selB); };
    api.focus = (pos) => {
      input.focus({ preventScroll: true });
      const at = pos == null ? input.value.length : Math.min(pos, input.value.length);
      input.setSelectionRange(at, at);
      caretLine();
    };
    paint();
    return api;
  }

  // ------------------------------------------------------------ dialog
  const scrim = el("div", { id: "dlg-scrim" });
  const dlg = el("div", { id: "dlg", class: "surface", role: "dialog", "aria-modal": "true", "aria-labelledby": "dlg-title", tabindex: "-1" },
    `<header class="dlg-head"><span id="dlg-title"></span><div class="dlg-tools"></div></header><div class="dlg-body"></div>` +
    `<footer class="dlg-foot"><div class="dlg-info"></div><button class="btn" type="button" data-do="cancel"></button><button class="btn primary" type="button" data-do="done"></button></footer>`);
  // the question when the window is closed over a dialog with changes in it
  const asking = el("div", { class: "dlg-ask" },
    `<div class="dlg-ask-box surface" role="alertdialog" aria-labelledby="dlg-ask-title"><b id="dlg-ask-title"></b><span class="dlg-ask-text"></span>` +
    `<div class="dlg-ask-row"><button class="btn" type="button" data-ask="discard"></button><span></span><button class="btn" type="button" data-ask="cancel"></button><button class="btn primary" type="button" data-ask="apply"></button></div></div>`);
  dlg.appendChild(asking);
  let answer = null;
  function ask() {
    if (answer) return new Promise(() => {});
    asking.querySelector("b").textContent = T("ask.title");
    asking.querySelector(".dlg-ask-text").textContent = T("ask.text");
    for (const [k, key] of [["discard", "ask.discard"], ["cancel", "dialog.cancel"], ["apply", "ask.apply"]]) asking.querySelector(`[data-ask="${k}"]`).textContent = T(key);
    asking.dataset.open = "";
    asking.querySelector('[data-ask="apply"]').focus();
    return new Promise((resolve) => { answer = (how) => { answer = null; delete asking.dataset.open; resolve(how); }; });
  }
  asking.addEventListener("click", (e) => { const b = e.target.closest("[data-ask]"); if (b && answer) answer(b.dataset.ask); });
  asking.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); if (answer) answer("cancel"); }
    else if (e.key === "Tab") { // stays among the three buttons
      const bs = [...asking.querySelectorAll("button")], i = bs.indexOf(document.activeElement);
      e.preventDefault();
      bs[(i + (e.shiftKey ? -1 : 1) + bs.length) % bs.length].focus();
    }
  });
  // the corner to pull the dialog larger by; a double click gives it its own size again
  const grip = el("div", { class: "dlg-grip", "aria-hidden": "true" });
  dlg.appendChild(grip);
  const sized = () => { const p = window.MdPrefs || {}; return [Number(p.dialogWidth) || 0, Number(p.dialogHeight) || 0]; };
  function applySize() {
    const [w, h] = sized();
    dlg.style.width = w ? Math.min(w, innerWidth * 0.96) + "px" : "";
    dlg.style.height = h ? Math.min(h, innerHeight * 0.92) + "px" : "";
    dlg.style.maxHeight = h ? "92vh" : "";
    dlg.classList.toggle("sized", !!h);
  }
  grip.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = { width: dlg.offsetWidth, height: dlg.offsetHeight }, x0 = e.clientX, y0 = e.clientY; // (its size, not what a transform makes of it)
    dlg.classList.add("sizing");
    const move = (ev) => { // (centred: it grows to both sides, so twice the way of the pointer)
      dlg.style.width = Math.max(380, Math.min(innerWidth * 0.96, r.width + 2 * (ev.clientX - x0))) + "px";
      dlg.style.height = Math.max(220, Math.min(innerHeight * 0.92, r.height + 2 * (ev.clientY - y0))) + "px";
      dlg.style.maxHeight = "92vh";
      dlg.classList.add("sized");
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      dlg.classList.remove("sizing");
      const prefs = { dialogWidth: dlg.offsetWidth, dialogHeight: dlg.offsetHeight };
      window.MdPrefs = { ...(window.MdPrefs || {}), ...prefs };
      window.webkit?.messageHandlers?.mdview?.postMessage(JSON.stringify({ type: "prefs", prefs }));
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
  grip.addEventListener("dblclick", () => {
    window.MdPrefs = { ...(window.MdPrefs || {}), dialogWidth: 0, dialogHeight: 0 };
    window.webkit?.messageHandlers?.mdview?.postMessage(JSON.stringify({ type: "prefs", prefs: { dialogWidth: 0, dialogHeight: 0 } }));
    applySize();
  });
  // what a dialog held when it was left with Esc: offered again the next time the same block is opened
  let discarded = null;
  document.body.append(scrim, dlg);
  const title = dlg.querySelector("#dlg-title"), tools = dlg.querySelector(".dlg-tools"), body = dlg.querySelector(".dlg-body"), info = dlg.querySelector(".dlg-info");
  let open = null; // { anchor, done, cancel, … } while a dialog is up

  // where the dialog comes from and goes back to: the island's box, as a transform of the dialog's own
  function from(anchor) {
    const a = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : null;
    const d = dlg.getBoundingClientRect();
    if (!a || !a.width || a.height > innerHeight * 0.6 || a.bottom < 0 || a.top > innerHeight) return "translateY(-18px) scale(0.98)"; // a sheet from above
    const dx = a.left + a.width / 2 - (d.left + d.width / 2), dy = a.top + a.height / 2 - (d.top + d.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${Math.max(0.05, a.width / d.width)}, ${Math.max(0.05, a.height / d.height)})`;
  }
  /* opts: { title, anchor: () => element, build(body, tools, info) -> { focus(), result() }, done(result), cancel() }
   * result() gives what was entered, or undefined to say "as it was". */
  function show(opts) {
    if (open) return;
    title.textContent = opts.title;
    tools.textContent = body.textContent = info.textContent = "";
    dlg.querySelector('[data-do="cancel"]').textContent = T("dialog.cancel");
    dlg.querySelector('[data-do="done"]').textContent = T("dialog.done");
    dlg.dataset.kind = opts.kind || "";
    applySize();
    const parts = opts.build(body, tools, info);
    open = { opts, parts };
    if (opts.key != null && discarded && discarded.key === opts.key && parts.setText) {
      const back = el("button", { class: "btn", type: "button" }, esc(T("dialog.restore")));
      const text = discarded.text;
      back.onclick = () => { parts.setText(text); back.remove(); discarded = null; parts.focus(); };
      info.appendChild(back);
    }
    dlg.style.transition = "none";
    dlg.style.transform = "none";
    dlg.dataset.open = scrim.dataset.open = "";
    dlg.style.transform = from(opts.anchor());
    void dlg.offsetWidth;
    dlg.style.transition = "";
    dlg.style.transform = "none";
    parts.focus();
  }
  function close(how) {
    if (!open) return;
    document.querySelectorAll(".ce-comp").forEach((c) => c.remove());
    const { opts, parts } = open;
    const result = how === "done" ? parts.result() : undefined;
    if (how !== "done" && opts.key != null && parts.text && parts.result() !== undefined) discarded = { key: opts.key, text: parts.text() };
    else if (how === "done" && discarded && discarded.key === opts.key) discarded = null;
    open = null;
    if (how === "done" && result !== undefined) opts.done(result); else if (opts.cancel) opts.cancel(how);
    // back into the island as it is now
    delete scrim.dataset.open;
    delete dlg.dataset.open;
    dlg.style.transform = from(opts.anchor());
    if (A.view.pm) A.view.pm.focus();
  }
  dlg.addEventListener("click", (e) => {
    const b = e.target.closest("[data-do]");
    if (b && (b.dataset.do === "done" || b.dataset.do === "cancel")) close(b.dataset.do);
  });
  scrim.addEventListener("mousedown", (e) => { e.preventDefault(); close("done"); }); // a click beside it loses nothing
  // The wheel belongs to the dialog while it is open: what is under it does not scroll — not
  // from beside the dialog, and not when a list in it has reached its end.
  function holdWheel(e) {
    if (e.ctrlKey) return;
    const dy = e.deltaY, dx = e.deltaX;
    for (let el = e.target; el && el !== document.body; el = el.parentElement) {
      if (el.nodeType !== 1) continue;
      const cs = getComputedStyle(el);
      if (dy && /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return;
      if (dx && !dy && /auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1)) return;
      if (el === dlg || el === scrim) break;
    }
    e.preventDefault();
  }
  scrim.addEventListener("wheel", holdWheel, { passive: false });
  dlg.addEventListener("wheel", holdWheel, { passive: false });
  dlg.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    e.stopPropagation(); // the page's shortcuts are not for here
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); close("done"); }
    else if (e.key === "Escape") { e.preventDefault(); close("cancel"); }
    else if (e.key === "Tab" && !e.target.matches(".ce-in")) { // the focus stays in the dialog
      const all = [...dlg.querySelectorAll("input, textarea, button, select")].filter((n) => !n.disabled && n.offsetParent);
      const i = all.indexOf(document.activeElement);
      e.preventDefault();
      all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus();
    }
  });

  // ------------------------------------------------------------ popover with fields
  const pop = el("div", { id: "atompop", class: "ui-menu ui-popover surface", role: "dialog" });
  document.body.appendChild(pop);
  let popOpen = null;
  /* opts: { rect, label, fields: [{ key, label, value, placeholder, mono }], preview(values) -> html or null,
   *         apply(values), more(values) (Shift+Enter), cancel() } */
  function fields(opts) {
    closeFields();
    pop.setAttribute("aria-label", opts.label);
    pop.innerHTML = (opts.preview ? `<div class="ap-preview"></div><div class="ap-error"></div>` : "") + opts.fields.map((f) =>
      `<label class="lp-row"><span>${esc(f.label)}</span><input class="lp-field${f.mono ? " mono" : ""}" data-key="${f.key}" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(f.placeholder || "")}"></label>`).join("");
    const inputs = [...pop.querySelectorAll("input")];
    inputs.forEach((inp, i) => { inp.value = opts.fields[i].value || ""; });
    const values = () => Object.fromEntries(inputs.map((inp) => [inp.dataset.key, inp.value]));
    const preview = () => {
      if (!opts.preview) return;
      const r = opts.preview(values());
      if (r.html != null) { pop.querySelector(".ap-preview").innerHTML = r.html; pop.querySelector(".ap-preview").classList.toggle("stale", !!r.error); }
      pop.querySelector(".ap-error").textContent = r.error || "";
    };
    preview();
    popOpen = { opts, values };
    pop.style.left = pop.style.top = "0px";
    const w = pop.offsetWidth, h = pop.offsetHeight, r = opts.rect;
    const up = r.bottom + 6 + h > innerHeight - 12 && r.top - h - 6 > 12;
    pop.style.setProperty("--origin", up ? "bottom left" : "top left");
    pop.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + window.scrollX + "px";
    pop.style.top = (up ? r.top - h - 6 : r.bottom + 6) + window.scrollY + "px";
    pop.dataset.open = "";
    inputs[0].focus({ preventScroll: true });
    inputs[0].select();
    pop.oninput = preview;
    pop.onkeydown = (e) => {
      if (e.isComposing) return;
      e.stopPropagation();
      if (e.key === "Enter" && e.shiftKey && opts.more) { e.preventDefault(); const v = values(); closeFields(); opts.more(v); }
      else if (e.key === "Enter") { e.preventDefault(); applyFields(); }
      else if (e.key === "Escape") { e.preventDefault(); const o = popOpen.opts; closeFields(); if (o.cancel) o.cancel(); }
    };
  }
  function applyFields() {
    if (!popOpen) return;
    const { opts, values } = popOpen;
    const v = values();
    closeFields();
    opts.apply(v);
  }
  function closeFields() {
    if (!popOpen) return false;
    popOpen = null;
    delete pop.dataset.open;
    return true;
  }
  pop.addEventListener("focusout", (e) => { if (popOpen && !pop.contains(e.relatedTarget)) applyFields(); });

  /* Leaving the mode or the note with a dialog up: what was entered is taken, as with a click beside it. */
  function finish() {
    if (popOpen) applyFields();
    if (open) close("done");
  }
  A.dialog = { show, close, finish, ask, get changed() { return !!open && open.parts.result() !== undefined; }, editor, fields, closeFields, get open() { return !!open || !!popOpen; }, el };
})();
