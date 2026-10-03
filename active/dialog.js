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
  function editor({ value = "", language = "", pairs = false, label = "" } = {}) {
    const wrap = el("div", { class: "ce" },
      `<div class="ce-gutter" aria-hidden="true"></div><div class="ce-main"><div class="ce-line" aria-hidden="true"></div>` +
      `<pre class="ce-back" aria-hidden="true"><code class="hljs"></code></pre><pre class="ce-marks" aria-hidden="true"></pre>` +
      `<textarea class="ce-in" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off"></textarea></div>`);
    const gutter = wrap.firstChild, main = wrap.lastChild;
    const [line, back, marks, input] = main.children;
    input.setAttribute("aria-label", label);
    input.value = value;
    const api = { el: wrap, input, onInput: null };
    let lang = language, error = null;
    const lineHeight = () => parseFloat(getComputedStyle(input).lineHeight) || 21;
    function paint() {
      const text = input.value;
      back.firstChild.innerHTML = highlight(text, lang) + "\n";
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
    }
    const insert = (text, selA, selB) => {
      if (!document.execCommand("insertText", false, text)) { input.setRangeText(text, input.selectionStart, input.selectionEnd, "end"); input.dispatchEvent(new Event("input")); }
      if (selA != null) input.setSelectionRange(selA, selB ?? selA);
    };
    input.addEventListener("input", () => { paint(); if (api.onInput) api.onInput(input.value); });
    for (const type of ["keyup", "click", "focus", "select"]) input.addEventListener(type, caretLine);
    input.addEventListener("keydown", (e) => {
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
    api.setError = (e) => { error = e; paint(); };
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
    const r = dlg.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
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
      const b = dlg.getBoundingClientRect();
      const prefs = { dialogWidth: Math.round(b.width), dialogHeight: Math.round(b.height) };
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
