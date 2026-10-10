/* mdview — renderer, source editor, folder sidebar + UI inside the web view.
 * The shell (src-tauri) calls MdView.render(payload) and friends; the page talks back via
 * window.MdHost.post (JSON strings). */
"use strict";
(() => {
  const NONCE = document.currentScript.nonce;
  const DESKTOP = !!window.__TAURI_INTERNALS__; // the desktop application's window (not a browser, whose host is the web app's)
  const ASSETS = document.currentScript.src.replace(/\/[^/]*$/, "");
  const content = document.getElementById("content");
  const baseEl = document.querySelector("base");
  // Anything that leaves the file or the window hands over unsaved edits first.
  const LEAVING = new Set(["back", "forward", "open", "reload", "close", "print", "external", "note", "newnote", "quicknote", "folder", "rename", "move", "trash", "tab", "link", "wikilink"]); // (a link followed leaves the note too: what was typed a moment ago is in the file first)
  let leaving = false; // a save because the note, the mode or the window is being left (not the timer's)
  const post = (type, data = {}) => {
    if (LEAVING.has(type)) { leaving = true; window.MdBoard?.leave?.(); flushSave(); leaving = false; } // (an open whiteboard is the note's: what is drawn goes first)
    window.MdHost?.post(JSON.stringify({ type, ...data }));
  };
  const T = window.MdStrings.t;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const motionMs = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v.endsWith("ms") ? parseFloat(v) : v.endsWith("s") ? parseFloat(v) * 1000 : fallback;
  };

  // a shortcut as macOS writes it in a menu: "Ctrl+Shift+V" -> "⌃⇧V" (modifiers in Apple's order)
  const KEY_SIGN = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Del: "⌦", Enter: "↩", Esc: "⎋", Tab: "⇥" };
  function keys(k) {
    if (!k) return "";
    const parts = k.split("+"), last = parts.pop() || "+";
    return ["Ctrl", "Alt", "Shift"].filter((m) => parts.includes(m)).map((m) => KEY_SIGN[m]).join("") + (KEY_SIGN[last] || last);
  }

  // ------------------------------------------------------------ icons
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const SVG_ICON = {
    list: svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    pencil: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    source: svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'),
    book: svg('<path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2ZM12 6.5v13"/>'),
    up: svg('<path d="m18 15-6-6-6 6"/>'),
    down: svg('<path d="m6 9 6 6 6-6"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    chevron: svg('<path d="m9 18 6-6-6-6"/>'),
    sidebar: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>'),
    panel: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    palette: svg('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.2-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.800-1.800H17a4 4 0 0 0 4-4c0-4.400-4-7.900-9-7.900z"/><path d="M7.500 12h.01M9.500 8h.01M14.500 7.500h.01"/>'),
    title: svg('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
    info: svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/>'),
    alert: svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5V12M12 16h.01"/>'),
    flame: svg('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    help: svg('<circle cx="12" cy="12" r="9.5"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>'),
    warn: svg('<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>'),
    zap: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
    bug: svg('<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M19 7l-3 2M5 7l3 2M19 13h-3M5 13h3M19 19l-3-2M5 19l3-2M12 20v-9M9.5 3.5 12 6l2.5-2.5"/>'),
    quote: svg('<path d="M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.5-1.5 4-4 5M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.5-1.5 4-4 5"/>'),
    clip: svg('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
    todo: svg('<circle cx="12" cy="12" r="9.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    // menus
    note: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
    folderPlus: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 10.5v5M9.5 13h5"/>'),
    external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>'),
    apps: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
    reveal: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V11"/><path d="M3 7v10a2 2 0 0 0 2 2h6"/><circle cx="16.5" cy="16" r="3"/><path d="m21 20.5-2.3-2.3"/>'),
    rename: svg('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="M14.5 7.5l3 3"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
    pdf: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8.5 17.5c2-1.5 3.6-4.6 3.6-6.6 0-1.2-1.6-1.2-1.6 0 0 2.2 2.6 5 5 5 1.2 0 1.2-1.4 0-1.4-2 0-5 1.2-7 3Z"/>'),
    picture: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17.5 4.5-4 3 2.5 3-3 4 4"/>'),
    file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>'),
    trash: svg('<path d="M4 7h16M10 4h4M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6"/>'),
    updown: svg('<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>'),
    // the settings' groups
    sigma: svg('<path d="M18 6V5H6l6 7-6 7h12v-1"/>'),
    home: svg('<path d="m3.5 10.5 8.5-7 8.5 7"/><path d="M5.5 9v10.5h4.75V14h3.5v5.5h4.75V9"/>'),
    history: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    share: svg('<path d="M12 15V3.5M8 7l4-4 4 4"/><path d="M7.5 11H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18 11h-1.5"/>'),
    spark: svg('<path d="M12 3l1.9 5.6a2 2 0 0 0 1.3 1.3L21 12l-5.8 2.1a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.6a2 2 0 0 0-1.3-1.3L3 12l5.8-2.1a2 2 0 0 0 1.3-1.3Z"/>'),
  };
  // The app's own signs — toolbar, sidebar, menus, the tiles — are SF Symbols where the machine has
  // that font (mdview.py says so: body[data-sf]): set as text, they are drawn with the text's
  // hinting and stand sharp on a screen of ordinary resolution, where a 24-unit drawing scaled to
  // 16 px does not. Only code points are written here; without the font the drawings above stay.
  // (The glyph is CSS content, not text: a row's text stays its name.)
  // What stands in the document (callouts) and in the "/" menu keeps the drawings.
  const SF = {
    list: 0x1002f2, search: 0x1002ab, pencil: 0x10020a, source: 0x100246, book: 0x10025a, up: 0x100187, down: 0x100188,
    x: 0x100184, chevron: 0x10018a, sidebar: 0x1003da, panel: 0x1003db, plus: 0x10017c, title: 0x100151, folder: 0x100215,
    note: 0x10023f, folderPlus: 0x100219, external: 0x100114, apps: 0x1001f7, reveal: 0x1002ab, rename: 0x10016b,
    gear: 0x1008cb, pdf: 0x100245, picture: 0x1003c5, file: 0x100237, trash: 0x100211,
    info: 0x100174, sigma: 0x10016d, spark: 0x1001bf, updown: 0x10018f, home: 0x10039e, history: 0x10042b,
  };
  const ICON = !document.body.hasAttribute("data-sf") ? SVG_ICON
    : Object.fromEntries(Object.entries(SVG_ICON).map(([k, v]) => [k, SF[k] ? `<span class="sf" aria-hidden="true" data-g="${String.fromCodePoint(SF[k])}"></span>` : v]));
  // Code in languages the bundle has under another name, or not at all. SystemVerilog is what
  // highlight.js calls verilog (its grammar has SystemVerilog's words). A filelist — the .f file
  // a simulator or a synthesis tool is handed: one source or option a line — is its own.
  if (window.hljs) {
    hljs.registerAliases(["systemverilog", "sysverilog", "svh", "vh"], { languageName: "verilog" });
    hljs.registerLanguage("filelist", (h) => ({
      name: "Filelist",
      aliases: ["f", "flist", "vf", "vc"],
      contains: [
        h.COMMENT("//", "$"), h.COMMENT("#", "$"), h.C_BLOCK_COMMENT_MODE, h.QUOTE_STRING_MODE,
        { className: "variable", begin: /\$\{[^}\n]+\}|\$\([^)\n]+\)|\$[A-Za-z_]\w*/ }, // $VAR, ${VAR}, $(VAR)
        { className: "keyword", begin: /^[ \t]*\+[A-Za-z_][\w-]*\+?/, relevance: 10 },        // +incdir+, +define+, +libext+
        { className: "built_in", begin: /^[ \t]*-{1,2}[A-Za-z][\w-]*/ },                       // -f, -F, -v, -y, -sv, --top
        { className: "number", begin: /=[^\s+]+/ },                                            // what a define is set to
      ],
    }));
  }
  // an address that names a file beside the note (not a note, not a place in this one, not elsewhere)
  const fileHref = (href) => !!href && !/^[a-z][a-z0-9+.-]*:|^#|^\/\//i.test(href) && /\.[A-Za-z0-9]{1,8}(?:[?#].*)?$/.test(href) && !/\.(md|markdown|mdown)(?:[?#].*)?$/i.test(href);
  const fileSize = (title) => (/^(small|large)$/i.test(String(title || "").trim()) ? String(title).trim().toLowerCase() : "");
  const fileExt = (href) => (/\.([A-Za-z0-9]{1,8})(?:[?#].*)?$/.exec(String(href || "")) || [, ""])[1].toUpperCase();
  const PDF_COLORS = { yellow: "#ffd000", red: "#ea5252", green: "#5ec269", blue: "#4a9cf0", purple: "#bb61e5" }; // (as in pdfview.js)
  const DECO_COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "magenta"]; // (the theme's --c-…)
  const CALLOUT_ALIAS = {
    summary: "abstract", tldr: "abstract", hint: "tip", check: "success", done: "success",
    help: "question", faq: "question", attention: "warning", caution: "danger",
    fail: "failure", missing: "failure", error: "danger", cite: "quote",
  };
  const CALLOUT_ICON = {
    note: SVG_ICON.pencil, info: SVG_ICON.info, todo: SVG_ICON.todo, abstract: SVG_ICON.clip, tip: SVG_ICON.flame,
    success: SVG_ICON.check, question: SVG_ICON.help, warning: SVG_ICON.warn, failure: SVG_ICON.x,
    danger: SVG_ICON.zap, bug: SVG_ICON.bug, example: SVG_ICON.list, quote: SVG_ICON.quote, important: SVG_ICON.alert,
  };

  /* The formulas' fonts are fetched at once, before the first note is drawn. Left to the page they
   * arrive one by one after it is on screen, and each arrival lays a note with many formulas out
   * anew — seven or eight pauses of 100 to 350 ms in the first second and a half. */
  if (document.fonts && document.fonts.load) {
    for (const face of ["1em KaTeX_Main", "bold 1em KaTeX_Main", "italic 1em KaTeX_Main", "italic 1em KaTeX_Math", "italic bold 1em KaTeX_Math",
      "1em KaTeX_Size1", "1em KaTeX_Size2", "1em KaTeX_Size3", "1em KaTeX_Size4", "1em KaTeX_AMS", "1em KaTeX_Caligraphic", "1em KaTeX_Script"]) document.fonts.load(face).catch(() => {});
  }

  // ------------------------------------------------------------ helpers
  const slugify = (s) => String(s).trim().toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
  const inlineText = (children = []) => children.map((c) => {
    if (c.type === "text" || c.type === "code_inline" || c.type === "math_inline") return c.content;
    if (c.type === "wikilink") return c.meta.alias || c.meta.target;
    if (c.type === "tag") return "#" + c.content;
    if (c.type === "emoji") return c.content;
    return "";
  }).join("");

  // ------------------------------------------------------------ markdown-it
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
  md.renderer.rules.wikilink = (t, i, _o, env) => {
    const { target, alias } = t[i].meta;
    const label = esc(alias || wikiLabel(target));
    if (target.startsWith("#")) return `<a class="wikilink" href="#${esc(target.slice(1))}">${label}</a>`;
    const ok = env.links && env.links[target];
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
      if (env.links && !(target in env.links)) resolveSoon(target);
      return `<span class="embed-missing" data-wiki="${esc(target)}">${esc(wikiLabel(target))}</span>`;
    }
    // how large: |300 or |300x200 (as Obsidian), |full for the column's whole width; nothing: its own size
    const size = alias && /^(\d+)(?:x(\d+))?$/.exec(alias), full = !!alias && /^full$/i.test(alias);
    const dims = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ""}` : "";
    const url = esc(info.url);
    switch (info.kind) {
      case "image": return `<img class="embed${full ? " full" : ""}" src="${url}" alt="${esc(size || full ? wikiLabel(target) : alias || wikiLabel(target))}"${dims}>`;
      case "audio": return `<audio controls src="${url}"></audio>`;
      case "video": return `<video controls src="${url}"${dims}></video>`;
      case "pdf": { // the page, or the part of it the link points to (pdfview.js draws it)
        pdfEmbedsSoon();
        const frag = target.includes("#") ? target.slice(target.indexOf("#") + 1) : "";
        return `<span class="pdf-embed${full ? " full" : ""}" data-pdf="${esc(info.path)}" data-frag="${esc(frag)}" data-wiki="${esc(target)}"${size ? ` data-width="${size[1]}"` : ""}${full ? " data-full" : ""} title="${esc(wikiLabel(target))}"></span>`;
      }
      case "text": // a file of text, as code (the host read it: it is one)
        if (info.text == null) break;
        return fileCode(target, alias, info);
      case "md": {
        if ((env.depth || 0) >= 2 || info.text == null) break;
        const sub = target.includes("#") ? target.slice(target.indexOf("#") + 1) : "";
        const body = sectionOf(stripFrontmatter(info.text).body, sub);
        const inner = md.render(stripComments(body), { links: env.links, depth: (env.depth || 0) + 1 });
        return `<div class="transclusion"><a class="transclusion-head wikilink" href="#" data-wiki="${esc(target)}">${esc(alias || wikiLabel(target))}</a>${inner}</div>`;
      }
    }
    return `<a class="wikilink file" href="#" data-wiki="${esc(target)}">${esc(alias || wikiLabel(target))}</a>`;
  };

  // A Markdown picture says how large it is at the end of its description, as in Obsidian:
  // ![a tree|300](tree.png), ![a tree|full](tree.png). (imageSize: the same, for the active mode's node.)
  const imageSize = (alt) => { const m = /^(.*)\|(\d+|full)$/i.exec(alt || ""); return m ? { alt: m[1], size: m[2].toLowerCase() } : { alt: alt || "", size: "" }; };
  const plainImage = md.renderer.rules.image;
  md.renderer.rules.image = (toks, idx, opts, env, self) => {
    const t = toks[idx], last = t.children && t.children[t.children.length - 1];
    const m = last && last.type === "text" ? /\|(\d+|full)$/i.exec(last.content) : null;
    if (m) {
      last.content = last.content.slice(0, m.index);
      if (m[1].toLowerCase() === "full") t.attrJoin("class", "full"); else t.attrSet("width", m[1]);
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
    const { target, alias, look: words } = t[i].meta, look = pageLook(words), ok = target.startsWith("#") || (env.links && env.links[target]);
    if (!LINK_STYLES.includes(look.style)) look.style = "card"; // (what is in another note is not at hand here: no sheet, no widget)
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
   * room is left beside it, and stands in its middle (viewer.css: p.pic-block). The same for a
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
   * as it was: a table as wide as the column.) tableLook: that line, read → { wide, head };
   * tableMark: the line for a look, or "" where none is needed; tableStyle: a head colour as CSS. */
  const TABLE_MARK = /^<!--\s*(wide|table(?:\s+[^>]*?)?)\s*-->\s*$/;
  const headColor = (v) => { v = String(v || "").trim().toLowerCase(); return DECO_COLORS.includes(v) || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(v) ? v : ""; };
  function tableLook(line) {
    const m = TABLE_MARK.exec(String(line || "").trim());
    if (!m) return null;
    const words = m[1].split(/\s+/).slice(1), head = words.map((w) => /^head=(.+)$/i.exec(w)).find(Boolean);
    return { wide: !words.some((w) => /^narrow$/i.test(w)), head: head ? headColor(head[1]) : "" };
  }
  const tableMark = (look) => (look.wide !== false && !look.head ? "" : `<!-- table${look.wide === false ? " narrow" : ""}${look.head ? " head=" + look.head : ""} -->`);
  function tableStyle(head) {
    head = headColor(head);
    if (!head) return "";
    if (!head.startsWith("#")) return `--th: color-mix(in srgb, var(--c-${head}) 24%, var(--bg));`;
    // (a colour of one's own: its text in black or white, whichever is read on it)
    const h = head.length === 4 ? [...head.slice(1)].map((c) => c + c).join("") : head.slice(1), [r, g, b] = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16));
    return `--th: ${head}; --th-ink: ${0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1d1d1f" : "#fff"};`;
  }
  md.renderer.rules.table_open = (t, i, o, _e, self) => { const look = t[i].meta || {}, style = tableStyle(look.head); return `<div class="table-wrap${look.wide === false ? "" : " wide"}"${style ? ` style="${style}"` : ""}>` + self.renderToken(t, i, o); };
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
        col.attrSet("style", `--w: ${widths[k]}`); // (its share of the row: viewer.css makes the flex of it)
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

  // ------------------------------------------------------------ preprocessing
  const FM_RE = /^---[ \t]*\n(?:([\s\S]*?)\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/;
  function stripFrontmatter(text) {
    const m = FM_RE.exec(text);
    if (!m) return { body: text, props: null, offset: 0 };
    let props;
    try {
      props = m[1] ? jsyaml.load(m[1]) : {};
    } catch (e) {
      return { body: text, props: null, offset: 0 };
    }
    if (props !== null && typeof props !== "object") return { body: text, props: null, offset: 0 };
    return { body: text.slice(m[0].length), props: props || {}, offset: (m[0].match(/\n/g) || []).length };
  }
  /* %% comments %% are blank to the parser (their line breaks stay: the lines keep their numbers).
   * Not what stands in code: there "%%" is the code's — a cell magic, a format string — and two
   * of them in two code blocks would swallow everything between them. */
  const stripComments = (text) => {
    const next = /%%|^ {0,3}(?:(`{3,})[^`\n]*|(~{3,})[^\n]*)$|(`+)/gm;
    let out = "", at = 0, m;
    while ((m = next.exec(text))) {
      let end;
      if (m[0] === "%%") {
        const close = text.indexOf("%%", m.index + 2);
        if (close < 0) break; // (never closed: text)
        end = close + 2;
        out += text.slice(at, m.index) + text.slice(m.index, end).replace(/[^\n]/g, "");
      } else {
        const run = m[1] || m[2] || m[3];
        if (m[3]) { // code in the line: to the same run of backticks, within its paragraph
          const stop = text.indexOf("\n\n", m.index), close = new RegExp("(?<!`)" + run + "(?!`)", "g");
          close.lastIndex = m.index + run.length;
          const c = close.exec(text);
          end = c && (stop < 0 || c.index < stop) ? c.index + run.length : m.index + run.length;
        } else { // a fence: to the line that closes it, or the end
          const close = new RegExp("^ {0,3}" + run[0] + "{" + run.length + ",}[ \\t]*$", "gm");
          close.lastIndex = next.lastIndex;
          const c = close.exec(text);
          end = c ? c.index + c[0].length : text.length;
        }
        out += text.slice(at, end);
      }
      at = end;
      next.lastIndex = end;
    }
    return out + text.slice(at);
  };

  /* ------------------------------------------------------------ pages in a note
   * A note can hold pages of its own. In the file — one Markdown file, as ever — a page is what
   * stands between two comment lines:
   *
   *     <!-- page: Meeting notes -->
   *     …
   *     <!-- /page -->
   *
   * (any other program shows that text where it stands). Here the page is a line with its name on
   * the page it lies on; opened, it is shown alone, and edited as a note of its own — the text
   * around it in the file is not touched by that. Pages can lie in pages.
   *
   * So what is shown and edited is a view of the file: a page's own text, each page in it one
   * line, <!-- page: Name #p3 --> (the id says which). Saved, the view is put back into the file.
   * A note without pages is its own view: nothing here changes anything for it.
   *
   * The tree: { id, title, open, close (the comment lines as written), lead, trail (the empty
   * lines after the first and before the second), items: [a line | a page] }; the note itself is
   * the root (id null). Lines keep their own ends (a "\r" before the "\n" stays on the line). */
  /* How a page's line looks on the page it lies on — a word after "page": a plain row (nothing),
   * or a card (a cell of a list) — and, after that, one of the theme's colours:
   *   <!-- page card: Name -->   <!-- page card blue: Name -->   <!-- page green: Name -->
   * Three more show what is on the page: sheet (a small sheet of paper beside its name and how
   * its text begins), preview (the sheet large, the name under it) and widget (a tile with its
   * tasks, the pages in it, or its text). A link to another note is a row or a card. */
  const PAGE_STYLES = ["row", "card", "sheet", "preview", "widget"], LINK_STYLES = ["row", "card"];
  const PAGE_OPEN = /^ {0,3}<!--\s*page(?:\s+([a-z]+(?:\s+[a-z]+)?))?\s*:\s*(.*?)\s*-->\s*$/, PAGE_CLOSE = /^ {0,3}<!--\s*\/page\s*-->\s*$/, PAGE_ROW = /^ {0,3}<!--\s*page(?:\s+([a-z]+(?:\s+[a-z]+)?))?\s*:\s*(.*?)\s*#([a-z]\d+)\s*-->\s*$/;
  const pageLook = (words) => { const [a, b] = String(words || "").split(/\s+/), style = PAGE_STYLES.includes(a) ? a : "row", color = [a, b].find((x) => DECO_COLORS.includes(x)) || ""; return { style, color }; };
  const pageWords = (look) => [look.style === "row" ? "" : look.style, look.color].filter(Boolean).join(" ");
  const pageMark = (look, title, id = "") => `<!-- page${pageWords(look) ? " " + pageWords(look) : ""}: ${title}${id ? " #" + id : ""} -->`;
  const pageRow = (page, eol = "") => pageMark(pageLook(page.look), page.title, page.id) + eol;
  let pageFresh = 0; // (pages made here, until the file is read anew: x1, x2 …)
  function parsePages(raw) {
    const root = { id: null, title: "", items: [], byId: new Map() };
    const lines = raw.split("\n"), stack = [root];
    let fence = null, n = 0;
    for (const line of lines) {
      const text = line.replace(/\r$/, ""), top = stack[stack.length - 1];
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(text);
      if (f && !fence) fence = f[1]; else if (f && fence && f[1][0] === fence[0] && f[1].length >= fence.length && !text.slice(f[0].length).trim()) fence = null;
      const open = !fence && !PAGE_ROW.test(text) ? PAGE_OPEN.exec(text) : null;
      if (open) { stack.push({ id: "p" + ++n, title: open[2], look: open[1] || "", open: line, close: null, lead: [], trail: [], items: [], lines: [line] }); continue; }
      if (!fence && PAGE_CLOSE.test(text) && stack.length > 1) {
        const page = stack.pop();
        page.close = line;
        while (page.items.length && typeof page.items[0] === "string" && !page.items[0].trim()) page.lead.push(page.items.shift());
        while (page.items.length && typeof page.items[page.items.length - 1] === "string" && !page.items[page.items.length - 1].trim()) page.trail.unshift(page.items.pop());
        delete page.lines;
        stack[stack.length - 1].items.push(page);
        continue;
      }
      top.items.push(line);
    }
    // a page that is never closed is no page: its lines are the text they are
    while (stack.length > 1) { const open = stack.pop(), flat = (x) => (typeof x === "string" ? [x] : [x.open, ...x.lead, ...x.items.flatMap(flat), ...x.trail, x.close]); stack[stack.length - 1].items.push(open.open, ...open.items.flatMap(flat)); }
    const index = (page) => { for (const x of page.items) if (typeof x !== "string") { root.byId.set(x.id, x); x.parent = page; index(x); } };
    index(root);
    return root;
  }
  const pageLines = (page) => (page.id == null ? [] : [page.open]).concat(page.id == null ? [] : page.lead, page.items.flatMap((x) => (typeof x === "string" ? [x] : pageLines(x))), page.id == null ? [] : page.trail, page.id == null ? [] : [page.close]);
  const pagesText = (root) => pageLines(root).join("\n");
  const eolOf = (page) => { let p = page; while (p && p.id != null) { if (p.open) return /\r$/.test(p.open) ? "\r" : ""; p = p.parent; } const l = (page.items || []).find((x) => typeof x === "string"); return l && /\r$/.test(l) ? "\r" : ""; };
  // the view of a page: its own text, the pages in it a line each
  function pageView(page) {
    const eol = eolOf(page), lines = page.items.map((x) => (typeof x === "string" ? x : pageRow(x, eol)));
    return page.id == null ? lines.join("\n") : lines.length ? lines.join("\n") + "\n" : "";
  }
  // … and the view, as it was edited, put back: the page's lines are these now
  function pagePut(root, page, view) {
    const lines = view.split("\n"), eol = eolOf(page), seen = new Set();
    if (page.id != null && lines[lines.length - 1] === "") lines.pop();
    const clone = (x) => { const c = { ...x, id: "x" + ++pageFresh, items: x.items.map((y) => (typeof y === "string" ? y : clone(y))) }; return c; };
    page.items = lines.map((line) => {
      const m = PAGE_ROW.exec(line.replace(/\r$/, ""));
      if (!m) return line;
      let sub = root.byId.get(m[3]);
      const words = pageWords(pageLook(m[1]));
      if (!sub) sub = { id: m[3], title: m[2], look: words, open: null, close: `<!-- /page -->${eol}`, lead: [eol], trail: [eol], items: [] }; // (a page made here: nothing in it yet)
      else if (seen.has(sub.id)) sub = clone(sub); // (its line once more — copied, duplicated: a page of its own with the same in it)
      seen.add(sub.id);
      // (another name, another look: its first line says so — else that line stays as it was written)
      if (sub.title !== m[2] || pageWords(pageLook(sub.look)) !== words || !sub.open) { sub.title = m[2]; sub.look = words; sub.open = pageMark(pageLook(words), m[2]) + (/\r$/.test(sub.close || "") ? "\r" : eol); }
      return sub;
    });
    root.byId = new Map();
    const index = (pg) => { for (const x of pg.items) if (typeof x !== "string") { root.byId.set(x.id, x); x.parent = pg; index(x); } };
    index(root);
    return pagesText(root);
  }
  // the line of the file a line of the view is (0-based both)
  function pageFileLine(root, page, viewLine) {
    let at = 0, found = -1;
    const walk = (pg) => {
      if (pg.id != null) at += 1 + pg.lead.length;
      pg.items.forEach((x, i) => {
        if (pg === page && i === viewLine) found = at;
        if (typeof x === "string") at++; else walk(x);
      });
      if (pg.id != null) at += pg.trail.length + 1;
    };
    walk(root);
    return found;
  }

  /* Which page of the note is shown: its ids from the note's own text down (a file read anew
   * numbers its pages anew: the place among the pages is remembered too). The tree is that of
   * the note's text as it is (kept while that text is the same). */
  let pageTree = { raw: null, path: null, root: null }, pageAt = { path: null, ids: [], idx: [] }, pagesShown = null;
  function pageNow(p) {
    if (pageTree.raw !== p.raw || pageTree.path !== p.path) pageTree = { raw: p.raw, path: p.path, root: parsePages(p.raw || "") };
    const root = pageTree.root;
    if (pageAt.path !== p.path) pageAt = { path: p.path, ids: [], idx: [] };
    let page = root;
    const ids = [], idx = [];
    for (let i = 0; i < pageAt.ids.length; i++) {
      const subs = page.items.filter((x) => typeof x !== "string");
      const sub = subs.find((x) => x.id === pageAt.ids[i]) || subs[pageAt.idx[i]];
      if (!sub) break;
      ids.push(sub.id); idx.push(subs.indexOf(sub));
      page = sub;
    }
    pageAt = { path: p.path, ids, idx };
    return { root, page };
  }
  // what the reading view and the active mode show of a note: the note itself, or — a note with pages — the view of the page it is at
  function viewOf(p) {
    if (!p || p.kind === "pdf" || p.error || typeof p.raw !== "string") return p;
    const { root, page } = pageNow(p);
    if (!root.byId.size) return p;
    if (p._view && p._view.of === p.raw && p._view.vp.page === page) return p._view.vp;
    const vp = Object.create(p);
    vp.raw = pageView(page);
    vp.text = vp.raw.replace(/\r\n?/g, "\n");
    vp.pageOf = p; vp.page = page; vp.root = root;
    p._view = { of: p.raw, vp };
    return vp;
  }
  // a view that was edited, put back into its note: the note's text is the file as it is to be
  function viewPut(vp) {
    const p = vp.pageOf;
    if (!p) { // the note is its own view — until a page is made in it: then its text is the file, and what was edited a view of it
      if (!vp.raw.split("\n").some((l) => PAGE_ROW.test(l.replace(/\r$/, "")))) return vp;
      const root = parsePages("");
      vp.raw = pagePut(root, root, vp.raw);
      vp.text = vp.raw.replace(/\r\n?/g, "\n");
      pageTree = { raw: vp.raw, path: vp.path, root };
      return vp;
    }
    p.raw = pagePut(vp.root, vp.page, vp.raw);
    p.text = p.raw.replace(/\r\n?/g, "\n");
    pageTree = { raw: p.raw, path: p.path, root: vp.root };
    p._view = { of: p.raw, vp };
    return p;
  }
  // to another page of the note: down into one that lies on this page, or up along the way here
  /* Where one has been among the pages of the note on screen, in order: back and forward go along it (the buttons before
   * the way over a page, Alt+← and Alt+→). Going to a page from anywhere else cuts off what lay ahead. */
  let pageWalk = { path: null, list: [[]], at: 0 };
  const walkOf = () => { if (current && pageWalk.path !== current.path) pageWalk = { path: current.path, list: [pageAt.path === current.path ? pageAt.ids : []], at: 0 }; return pageWalk; };
  const pageCan = (by) => { if (!current || current.kind === "pdf" || mode === "edit") return false; const w = walkOf(); return w.at + by >= 0 && w.at + by < w.list.length; };
  function pageStep(by) {
    if (!pageCan(by)) return false;
    const w = walkOf(), v = viewOf(current), root = v && v.root;
    w.at += by;
    // (a page that is gone meanwhile: as far along its way as there still is one)
    let ids = w.list[w.at];
    if (root) { const k = ids.findIndex((id) => !root.byId.has(id)); if (k >= 0) ids = w.list[w.at] = ids.slice(0, k); }
    pageGo(ids, null, true);
    return true;
  }
  /* Where one stood on each page of the note (path + the way to the page → how far down), kept as a page is left: come
   * back to — up from a page in it, or along the way one went — it is where it was. Left for a page in it, that is at the
   * page's line; so "back" lands on the line of the page one comes from. A page gone into anew begins at its top. */
  const pageStood = new Map();
  const stoodKey = (path, ids) => path + "\n" + ids.join("/");
  function pageGo(ids, then = null, walked = false) {
    if (!current || current.kind === "pdf" || mode === "edit") return;
    const from = pageAt.path === current.path ? pageAt.ids : [];
    { // (… and, going into a page, where that page's line stood on screen: it is put back there exactly)
      const into = ids.length > from.length ? String(ids[from.length]) : null, row = into && [...document.querySelectorAll("#content .page-row[data-page], #active .page-row[data-page]")].find((r) => r.offsetParent && r.dataset.page === into);
      pageStood.set(stoodKey(current.path, from), { y: scrollY, id: row ? into : null, top: row ? row.getBoundingClientRect().top : 0 });
    }
    if (pageStood.size > 300) pageStood.delete(pageStood.keys().next().value);
    if (!walked) { const w = walkOf(); if (w.list[w.at].join("/") !== ids.join("/")) { w.list.length = w.at + 1; w.list.push(ids.slice()); if (w.list.length > 60) w.list.shift(); w.at = w.list.length - 1; } }
    if (mode === "active") { leaving = true; flushSave(); leaving = false; } // (what is typed is the file's first)
    pageAt = { path: current.path, ids, idx: ids.map((_id, i) => (i < pageAt.idx.length ? pageAt.idx[i] : -1)) };
    current.arriving = false;
    if (mode === "active") { drawn = null; showActive(current, null); } else draw(current, null);
    // up out of a page, or back along the way: where one stood there — and, where that is not known, at the line of the
    // page one comes from; into a page: its top
    const up = ids.length < from.length && ids.every((id, i) => id === from[i]), stood = pageStood.get(stoodKey(current.path, ids));
    if ((up || walked) && stood) window.scrollTo({ top: stood.y, behavior: "instant" });
    else window.scrollTo(0, 0);
    if (up) {
      // (the line of the page one was in: in sight in any case — the page above may have changed meanwhile — and marked for a moment)
      const row = [...document.querySelectorAll("#content .page-row[data-page], #active .page-row[data-page]")].find((r) => r.offsetParent && r.dataset.page === String(from[ids.length]));
      if (row) {
        // (what stands above it may be taller or shorter now — the bar with the way forward is there: the line itself is put
        // where it was)
        if (stood && stood.id === row.dataset.page) window.scrollBy({ top: row.getBoundingClientRect().top - stood.top, behavior: "instant" });
        const r = row.getBoundingClientRect(), top = (document.documentElement.style.getPropertyValue("--top") ? parseFloat(document.documentElement.style.getPropertyValue("--top")) : 0) + 12;
        if (r.top < top || r.bottom > innerHeight - 12) row.scrollIntoView({ block: "center", behavior: "instant" });
        row.classList.add("came-from");
        setTimeout(() => row.classList.remove("came-from"), 900);
      }
    }
    if (then) then();
  }
  /* Blocks put into a page (dragged onto its line): their Markdown stands at the page's end. A
   * page among them goes along as the page it is. (What is typed is the file's first, and with it
   * the blocks are gone from where they stood.) */
  function pageAppend(id, markdown) {
    if (mode !== "active" || !current || !window.MdActive || !MdActive.view.payload) return false;
    const before = MdActive.view.payload.root || pageTree.root;
    const lines = String(markdown || "").replace(/\n+$/, "").split("\n").map((l) => { const m = PAGE_ROW.exec(l); return (m && before && before.byId.get(m[3])) || l; });
    MdActive.view.touch();
    leaving = true; flushSave(); leaving = false;
    const p = current, root = pageTree.path === p.path ? pageTree.root : null, page = root && root.byId.get(id);
    if (!page) return false;
    const eol = eolOf(page);
    if (page.items.length) page.items.push(eol);
    for (const l of lines) page.items.push(typeof l === "string" ? l + eol : l);
    root.byId = new Map();
    const index = (pg) => { for (const x of pg.items) if (typeof x !== "string") { root.byId.set(x.id, x); x.parent = pg; index(x); } };
    index(root);
    p.raw = pagesText(root);
    p.text = p.raw.replace(/\r\n?/g, "\n");
    pageTree = { raw: p.raw, path: p.path, root };
    if (p._view) p._view.of = p.raw;
    trailPush(p.path, p.text);
    post("save", { text: p.raw, path: p.path, exact: true, seq: ++saveSeq });
    return true;
  }
  const pageOpen = (id) => { const v = viewOf(current); if (v && v.root && v.root.byId.has(id)) pageGo([...pageAt.ids, id]); else if (mode === "active" && current) pageGo([...pageAt.ids, id], () => document.querySelector("#pagebar .pb-title")?.select()); };
  /* Over a page that is open: the way to it — the note, the pages down to the one it lies on — and
   * its name, which is typed there (in the active mode). */
  const pagebar = document.createElement("nav");
  pagebar.id = "pagebar";
  pagebar.setAttribute("aria-label", "Pages");
  function pageBar(v, host) {
    // (on the note itself there is a bar only while there is a way forward again)
    if (!v || !v.pageOf || (v.page.id == null && !pageCan(1))) { pagebar.remove(); return; }
    const nav = `<span class="pb-nav"><button class="pb-step" type="button" data-step="-1" title="${esc(T("page.back"))}" aria-label="${esc(T("page.back"))}"${pageCan(-1) ? "" : " disabled"}>${ICON.chevron}</button><button class="pb-step" type="button" data-step="1" title="${esc(T("page.forward"))}" aria-label="${esc(T("page.forward"))}"${pageCan(1) ? "" : " disabled"}>${ICON.chevron}</button></span>`;
    if (v.page.id == null) {
      pagebar.innerHTML = `<div class="pb-way">${nav}</div>`;
      pagebar.dataset.bare = "";
      if (pagebar.parentNode !== host || host.firstChild !== pagebar) host.prepend(pagebar);
      return;
    }
    delete pagebar.dataset.bare;
    const way = [];
    for (let pg = v.page.parent; pg; pg = pg.parent) way.unshift(pg);
    const name = (pg) => (pg.id == null ? (v.name || "").replace(/\.(md|markdown)$/i, "") || "Note" : pg.title || "Untitled");
    // (the name being typed stays as typed: the bar is drawn anew whenever the note is — a save, a picture that changed —
    // and what was in the field would be gone, with the hand still on it)
    const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches(".pb-title") && pagebar.contains(document.activeElement) && pagebar.dataset.page === String(v.page.id) ? { value: document.activeElement.value, a: document.activeElement.selectionStart, b: document.activeElement.selectionEnd } : null;
    pagebar.dataset.page = String(v.page.id);
    pagebar.innerHTML = `<div class="pb-way">${nav}` + way.map((pg, i) => `<button class="pb-crumb" type="button" data-depth="${i}">${esc(name(pg))}</button><span class="pb-sep" aria-hidden="true">${ICON.chevron}</span>`).join("") + `<span class="pb-here"></span></div>` +
      `<input class="pb-title" type="text" aria-label="${esc(T("Page name"))}" spellcheck="false" autocomplete="off">`;
    const title = pagebar.querySelector(".pb-title");
    title.value = typing ? typing.value : v.page.title;
    title.placeholder = T("page.untitled");
    // (the way ends at the page one is on: its name, as it is typed below)
    const here = pagebar.querySelector(".pb-here"), named = () => { here.textContent = title.value.trim() || T("page.untitled"); };
    named();
    title.addEventListener("input", named);
    title.readOnly = !!v.readonly || mode === "edit"; // (typed here in the reading view as well: written at once, as a ticked task is)
    if (pagebar.parentNode !== host || host.firstChild !== pagebar) host.prepend(pagebar);
    if (typing) { title.focus({ preventScroll: true }); try { title.setSelectionRange(typing.a, typing.b); } catch (e) { /* (as it stands) */ } }
  }
  pagebar.addEventListener("click", (e) => { const s = e.target.closest(".pb-step"); if (s) { pageStep(Number(s.dataset.step)); return; } const c = e.target.closest(".pb-crumb"); if (c) pageGo(pageAt.ids.slice(0, Number(c.dataset.depth))); });
  pagebar.addEventListener("keydown", (e) => {
    if (!e.target.matches(".pb-title")) return;
    e.stopPropagation();
    if (e.key === "Enter" || e.key === "Escape" || e.key === "ArrowDown") { e.preventDefault(); e.target.blur(); if (mode === "active") window.MdActive.view.focus(); }
  });
  // a page's name, as it can stand in its line: one line, nothing that ends the comment or reads as its number
  const pageName = (name) => String(name || "").replace(/[\r\n]+/g, " ").replace(/--+>/g, "→").replace(/\s#[a-z]\d+\s*$/, "").trim();
  // (the name is the page's as it is typed, a moment after the last letter — not only when the field is left: left by a
  // click on something that draws the page anew, the change never came)
  let nameTimer = 0;
  pagebar.addEventListener("input", (e) => { if (!e.target.matches(".pb-title")) return; clearTimeout(nameTimer); nameTimer = setTimeout(() => { if (e.target.isConnected) renamePage(e.target, false); }, 350); });
  pagebar.addEventListener("change", (e) => { if (e.target.matches(".pb-title")) { clearTimeout(nameTimer); renamePage(e.target, true); } });
  function renamePage(field, done) {
    const to = pageName(field.value);
    if (done) field.value = to; // (while it is typed the field is left as it is: a space at its end is on its way to a word)
    if (mode === "active" && window.MdActive) {
      const vp = MdActive.view.payload;
      if (!vp || !vp.pageOf || vp.page.id == null || vp.readonly || to === vp.page.title) return;
      vp.page.title = to;
      vp.page.open = pageMark(pageLook(vp.page.look), to) + (/\r$/.test(vp.page.close || "") ? "\r" : "");
      MdActive.view.touch(); // (the name is in the file with the next save)
      activeChanged();
      return;
    }
    // the reading view: the page's first line says the new name, and the file is written at once
    const vp = mode === "read" ? viewOf(current) : null;
    if (!vp || !vp.pageOf || vp.page.id == null || vp.readonly || to === vp.page.title) return;
    vp.page.title = to;
    vp.page.open = pageMark(pageLook(vp.page.look), to) + (/\r$/.test(vp.page.close || "") ? "\r" : "");
    const p = vp.pageOf;
    p.raw = pagesText(vp.root);
    p.text = p.raw.replace(/\r\n?/g, "\n");
    pageTree = { raw: p.raw, path: p.path, root: vp.root };
    p._view = null;
    post("save", { text: p.raw, path: p.path, exact: true, seq: ++saveSeq });
    for (const el of tabEls()) { const t = tabs.find((x) => String(x.id) === el.dataset.id); if (t) paintTab(el, t); }
  }

  /* A property that is true or false, switched: its line in the properties at the head of the
   * text (a note, or the properties alone) says the other — everything else stays as written.
   * -> the text, or null where there is no such line (a value written another way: left alone). */
  function toggleProp(text, key, on) {
    const m = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/.exec(text || "");
    if (!m) return null;
    const k = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const line = new RegExp(`^((?:${k}|"${k}"|'${k}')[ \\t]*:[ \\t]*)(?:true|false)([ \\t]*(?:#.*)?)$`, "im");
    if (!line.test(m[2])) return null;
    return m[1] + m[2].replace(line, (_all, head, tail) => head + (on ? "true" : "false") + tail) + m[3] + text.slice(m[0].length);
  }
  /* What a page says about itself on its line (the looks sheet, preview and widget): how its own
   * text begins, its tasks, the pages in it, the words in all of it — and its shape, a letter a
   * line: h a heading, t text, i a picture, f a formula or code, c a task. */
  function pageFacts(page) {
    const text = [], subs = [], tasks = [], shape = [];
    const plain = (s) => s.replace(/<!--.*?-->/g, "").replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~$]|==/g, "").replace(/\s+/g, " ").trim();
    const wordsOf = (pg) => pg.items.reduce((n, x) => n + (typeof x === "string" ? (plain(x).match(/[\p{L}\p{N}]+/gu) || []).length : wordsOf(x)), 0);
    let fence = null, math = false;
    for (const x of page.items) {
      if (typeof x !== "string") { subs.push(x.title || "Untitled"); shape.push("t"); continue; }
      const line = x.replace(/\r$/, ""), f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f && !fence) { fence = f[1]; shape.push("f"); continue; }
      if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
      if (/^\s*\$\$/.test(line)) { if (!math) shape.push("f"); if (!/^\s*\$\$.+\$\$\s*$/.test(line)) math = !math; continue; }
      if (math || !line.trim() || /^ {0,3}([-*_])( *\1){2,} *$/.test(line)) continue;
      const task = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (task) { tasks.push({ text: plain(task[2]), done: task[1] !== " " }); shape.push("c"); continue; }
      if (/^\s*!\[/.test(line)) { shape.push("i"); continue; }
      if (/^ {0,3}#{1,6}\s/.test(line)) { shape.push("h"); continue; }
      if (/^\s*\|/.test(line)) { shape.push("t"); continue; }
      const t = plain(line.replace(/^\s*(?:>\s*)*(?:\[![^\]]*\][+-]?)?\s*(?:(?:[-*+]|\d+[.)])\s+)?/, ""));
      if (!t) continue;
      text.push(t);
      for (let i = Math.min(3, Math.ceil(t.length / 90)); i > 0; i--) shape.push("t");
    }
    const all = text.join(" "), excerpt = all.length > 240 ? all.slice(0, 240).replace(/\s+\S*$/, "") + "…" : all;
    return { excerpt, words: wordsOf(page), subs, tasks, done: tasks.filter((t) => t.done).length, shape: shape.slice(0, 9).join("") };
  }
  // … and the line drawn in one of those looks (page: null where the page is not at hand — its name alone)
  function pageRowInner(look, name, page) {
    const f = page ? pageFacts(page) : { excerpt: "", words: 0, subs: [], tasks: [], done: 0, shape: "" };
    const said = [f.tasks.length ? T("page.tasksDone", f.done, f.tasks.length) : "", f.subs.length ? T(f.subs.length === 1 ? "page.subOne" : "page.subs", f.subs.length) : "", f.words || !page ? T(f.words === 1 ? "page.wordOne" : "page.words", f.words.toLocaleString()) : T("page.empty")].filter(Boolean);
    const lines = [...f.shape].map((l) => `<i class="${l}"></i>`).join("");
    const sheets = (head) => `<span class="page-sheets" aria-hidden="true">${f.subs.length > 1 ? '<span class="page-sheet back2"></span>' : ""}${f.subs.length ? '<span class="page-sheet back1"></span>' : ""}<span class="page-sheet">${head}${lines}</span></span>`;
    if (look.style === "sheet") return `${sheets('<i class="h"></i>')}<span class="page-row-text"><span class="page-row-name">${name}</span>${f.excerpt ? `<span class="page-row-ex">${esc(f.excerpt)}</span>` : ""}<span class="page-row-meta">${said.map((s, i) => (i ? esc(s) : `<b>${esc(s)}</b>`)).join(" · ")}</span></span>`;
    if (look.style === "preview") return `${sheets(`<b>${name}</b>`)}<span class="page-row-name">${name}</span><span class="page-row-meta">${esc(said[0])}</span>`;
    // a widget: what is still to do first, then the pages in it, then how its text begins
    const open = f.tasks.length - f.done, count = f.tasks.length ? open : f.subs.length;
    const rows = f.tasks.length ? [...f.tasks].sort((a, b) => a.done - b.done).slice(0, 4).map((t) => `<span class="page-row-li${t.done ? " done" : ""}"><span class="page-row-box"></span><span>${esc(t.text)}</span></span>`) : f.subs.slice(0, 4).map((s) => `<span class="page-row-li">${ICON.note}<span>${esc(s)}</span></span>`);
    const room = 5 - rows.length - (rows.length ? 1 : 0);
    return `<span class="page-row-head"><span class="page-row-icon">${ICON.note}</span><span class="page-row-name">${name}</span>${count ? `<span class="page-row-count">${count}</span>` : ""}</span>${rows.join("")}`
      + (f.tasks.length ? `<span class="page-row-more">${esc(said[0])}</span>` : room > 0 && f.excerpt ? `<span class="page-row-ex" style="--n: ${room}">${esc(f.excerpt)}</span>` : !rows.length ? `<span class="page-row-more">${esc(said[said.length - 1])}</span>` : "");
  }
  // a page's line on the page it lies on: its name, to be opened (reading view and active mode alike)
  const htmlBlockRule = md.renderer.rules.html_block;
  md.renderer.rules.html_block = (t, i, o, env, self) => {
    const m = PAGE_ROW.exec(t[i].content.trim());
    if (!m) return safeHtml(t[i].content);
    const page = pagesShown && pagesShown.byId.get(m[3]), look = pageLook(m[1]), name = esc((page ? page.title : m[2]) || "Untitled");
    const head = `<div class="page-row" data-style="${look.style}"${look.color ? ` data-color="${look.color}" style="--pc: var(--c-${look.color})"` : ""} data-page="${esc(m[3])}" role="link" tabindex="0">`;
    if (look.style !== "row" && look.style !== "card") return head + pageRowInner(look, name, page) + (look.style === "sheet" ? "</div>\n" : "</div>"); // (tiles stand side by side: nothing between them, not even a space)
    return `${head}<span class="page-row-icon">${ICON.note}</span><span class="page-row-name">${name}</span><span class="page-row-go">${ICON.chevron}</span></div>\n`;
  };
  function renderProps(props, env) {
    const keys = Object.keys(props);
    if (!keys.length) return "";
    const chip = (k, v) => /^tags?$/i.test(k)
      ? `<span class="tag">#${esc(String(v).replace(/^#/, ""))}</span>`
      : `<span class="chip">${md.renderInline(String(v), env)}</span>`;
    const value = (k, v) => {
      if (v == null || v === "") return '<span class="prop-empty">Empty</span>';
      if (Array.isArray(v)) return v.map((x) => chip(k, Array.isArray(x) ? `[[${x.flat().join("")}]]` : x)).join("");
      if (typeof v === "boolean") return `<input type="checkbox" class="task" data-prop="${esc(k)}"${v ? " checked" : ""}>`; // (a click writes it: toggleProp)
      if (v instanceof Date) {
        const dateOnly = v.getUTCHours() === 0 && v.getUTCMinutes() === 0;
        return esc(dateOnly
          ? v.toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })
          : v.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }));
      }
      if (typeof v === "object") return `<code>${esc(JSON.stringify(v))}</code>`;
      if (/^(tags?|aliases)$/i.test(k)) return String(v).split(/[,\s]+/).filter(Boolean).map((x) => chip(k, x)).join("");
      return md.renderInline(String(v), env);
    };
    const rows = keys.map((k) => `<tr><th>${esc(k)}</th><td>${value(k, props[k])}</td></tr>`).join("");
    return `<details class="props" open><summary><span class="callout-fold">${ICON.chevron}</span>${esc(T("Properties"))}</summary><table>${rows}</table></details>`;
  }

  // ------------------------------------------------------------ rendering
  let current = null, outline = [], generation = 0;
  let mode = "read"; // "read" | "edit" | "active"
  let drawn = null;  // what #content shows: { p, text }

  /* Another note asked for by hand (the sidebar, a tile): the window answers at once — the row is
   * marked, the note on screen makes way, a wheel turns in its place after a moment — and the note
   * is drawn two frames later, when that has been shown. Drawing a long note holds the page for
   * some tenths of a second; without this the click seemed not to have been taken. */
  const loader = document.createElement("div");
  loader.id = "loading";
  loader.setAttribute("aria-hidden", "true");
  document.body.appendChild(loader);
  let goingAt = 0, goingTimer = 0, pendingRender = null, renderFrame = 0;
  let modeBeforePdf = null; // the mode a note was in when a PDF took its place, or nothing did (an empty tab, All Notes)
  /* Where each note was left: opened again — after a PDF, another note, in a new window — it stands
   * at that place. Kept as the note is scrolled (the page's own storage, by the file's path). */
  const places = new Map();
  let placeTimer = 0;
  const placeKey = (path) => "mdview-place:" + path;
  function placeOf(p) {
    if (!p || !p.path || p.kind === "pdf") return 0;
    if (places.has(p.path)) return places.get(p.path);
    try { return Math.max(0, Number(localStorage.getItem(placeKey(p.path))) || 0); } catch (e) { return 0; }
  }
  function keepPlace() {
    if (!current || !current.path || current.kind === "pdf" || current.error || goingAt || document.body.hasAttribute("data-overview")) return;
    const y = Math.round(scrollY);
    places.set(current.path, y);
    try { if (y > 0) localStorage.setItem(placeKey(current.path), String(y)); else localStorage.removeItem(placeKey(current.path)); } catch (e) { /* no storage: this window remembers */ }
  }
  addEventListener("scroll", () => { clearTimeout(placeTimer); placeTimer = setTimeout(keepPlace, 250); }, { passive: true });
  function going(path) {
    if (!current || path === current.path) return;
    goingAt = performance.now();
    document.body.dataset.going = "";
    for (const row of document.querySelectorAll("#sidebar .sb-row[data-real]")) row.classList.toggle("active", row.dataset.real === path || row.closest(".sb-item")?.dataset.key === path);
    clearTimeout(goingTimer);
    goingTimer = setTimeout(arrived, 5000); // (whatever happens, the page does not stay empty)
  }
  function arrived() {
    clearTimeout(goingTimer);
    goingAt = 0;
    delete document.body.dataset.going;
  }
  function render(p) {
    if (!goingAt) { renderNow(p); return; }
    pendingRender = p; // (the newest, if another comes before it is drawn)
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      const q = pendingRender;
      pendingRender = null;
      try { renderNow(q); } finally { requestAnimationFrame(arrived); }
    }); });
  }
  function renderNow(p) {
    const prev = current;
    p.arriving = !prev || prev.path !== p.path; // (only a note come to is put where it was left — not one drawn again)
    clearTimeout(placeTimer); // (a place still to be kept is the note's that is leaving — it was kept as it was scrolled)
    if (p.kind === "pdf") { // shown in the reading view's place; nothing of it is edited here
      if (mode !== "read") modeBeforePdf = mode; // (the note after the PDF is in this mode again)
      if (mode === "edit") { flushSave(); leaveEditNow(); }
      if (mode === "active") leaveActiveNow();
      p.text = p.raw = "";
      current = p;
      document.title = p.name;
      if (!prev || prev.path !== p.path) markActiveNote(true);
      draw(p, null);
      return;
    }
    // (another note than the one before: the count of saves is the application's again — a save that
    // came too late for the note it was for is not counted there, and would keep every later state
    // of this note from being shown)
    if (p.seq != null && (!prev || prev.path !== p.path)) saveSeq = Math.min(saveSeq, p.seq);
    // read from disk before the last save from here was written: older than what is on screen
    if (prev && prev.path === p.path && p.seq != null && p.seq < saveSeq && !p.error) return;
    p.raw = p.text; // as on disk; the active mode keeps line endings as they are
    p.text = p.text.replace(/\r\n?/g, "\n");
    current = p;
    if (!p.error) trailPush(p.path, p.text);
    // the mode the app was last used in (once, for the window's first note)
    // back from a PDF, or from a tab with no note in it: the mode the note before it was in (neither
    // has modes; it only looked like a change to reading)
    if (!prev || prev.kind === "pdf") {
      const back = modeBeforePdf;
      modeBeforePdf = null;
      if (back && !p.error && !(back === "edit" && p.readonly)) setTimeout(() => { if (current === p && mode === "read") setMode(back); }, 0);
    }
    if (p.startMode && p.startMode !== "read" && !p.error && !(p.startMode === "edit" && p.readonly)) setTimeout(() => { if (current === p && mode === "read") setMode(p.startMode); }, 0);
    document.title = p.name || "Markdown Notes";
    if (p.base && baseEl.href !== p.base) baseEl.href = p.base; // relative links and images
    if (!prev || prev.path !== p.path) markActiveNote(true);
    if (mode === "edit") {
      if (prev && prev.path === p.path) { adoptDisk(p); return; }
      leaveEditNow();
    }
    if (mode === "active") {
      if (!p.error) {
        if (prev && prev.path === p.path && !MdActive.view.shows(viewOf(p))) { MdActive.dialog.closeFields(); if (MdActive.menu.isOpen) MdActive.menu.close(true); } // a popover's place is gone, and a menu's entries name places of the text that was; a dialog finds its block again (islands.js)
        if (prev && prev.path === p.path && MdActive.view.dirty) { // edits here that are not saved yet win, as in the source editor
          if (p.text !== prev.text) toast(T("active.keptEdits"));
          const shown = MdActive.view.payload, text = MdActive.view.serialize();
          if (shown && shown.pageOf) { p.raw = pagePut(shown.root, shown.page, text); pageTree = { raw: p.raw, path: p.path, root: shown.root }; } else p.raw = text;
          p.text = p.raw.replace(/\r\n?/g, "\n");
        }
        showActive(p, p.keepScroll ? captureAnchor() : null);
        return;
      }
      leaveActiveNow();
    }
    draw(p, p.keepScroll ? captureAnchor() : null);
  }

  // A folder window with nothing to show (no notes yet).
  function clear() {
    if (mode !== "read") modeBeforePdf = mode; // (the note that comes next is in this mode again)
    if (mode === "edit") { flushSave(); leaveEditNow(); }
    if (mode === "active") leaveActiveNow();
    if (window.MdPdf) MdPdf.leave();
    content.classList.remove("pdf");
    current = null;
    drawn = null;
    outline = [];
    document.title = folder ? folder.name : "Markdown Notes";
    content.innerHTML = emptyState();
    window.scrollTo(0, 0);
    reveal();
    markActiveNote(false);
  }

  // quiet: fill the (hidden) reading view without touching scroll or find
  function draw(p, anchor, quiet = false) {
    const gen = ++generation;
    drawn = { p, text: p.text };
    // (a PDF that makes way is let go as it stands — it keeps its place — before the column is the note's again)
    if (window.MdPdf && !(p.kind === "pdf" && !p.error)) MdPdf.leave();
    content.classList.toggle("pdf", p.kind === "pdf" && !p.error);
    if (p.kind === "pdf" && !p.error) {
      outline = [];
      reveal();
      loadPdf().then(() => { if (current === p) MdPdf.show(content, p); }, () => toast(T("The PDF viewer could not be loaded")));
      return;
    }
    if (p.error) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">${ICON.alert}</div><p>${esc(p.error)}</p></div>`;
      outline = [];
      reveal();
      return;
    }
    const v = viewOf(p); // (a note with pages: the page it is at)
    pagesShown = v.root || null;
    const fm = stripFrontmatter(v.text);
    md.set({ breaks: !!p.vault });
    const env = { lineOffset: fm.offset, links: p.links || {}, outline: [], depth: 0 };
    let html = md.render(stripComments(fm.body), env);
    if (fm.props) html = renderProps(fm.props, { links: env.links, depth: 1 }) + html;
    if (!html.trim()) html = `<div class="empty-state"><p>This file is empty.</p></div>`;
    content.innerHTML = html;
    pageBar(v, content);
    outline = env.outline;
    reveal();
    if (quiet) { renderMermaid(gen, null); return; }
    if (outlineOpen()) buildOutline();
    if (anchor) restoreAnchor(anchor);
    else if (p.fragment) scrollToFragment(p.fragment, false);
    else if (p.toEnd) scrollToEnd();
    else { window.scrollTo(0, p.arriving ? placeOf(p) : 0); p.arriving = false; } // (a note come to: where it was left; the top the first time)
    p.toEnd = false;
    if (findOpen()) runFind(findInput.value, true);
    renderMermaid(gen, anchor);
  }

  let painted = false;
  function reveal() {
    // (the window shows the web view from here on — once a frame with this content has gone out,
    // not before: until then the view holds nothing of the page's)
    if (!painted) { painted = true; requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => post("painted"), 30))); }
    if (!content.classList.contains("ready")) requestAnimationFrame(() => content.classList.add("ready"));
    // (the active mode's scripts are fetched in a quiet moment after the first note is on screen:
    // the first change into that mode then only has to build the note)
    if (!preloadTimer && !activeLoad) preloadTimer = setTimeout(() => { if (!activeLoad && current && current.kind !== "pdf") loadActive().catch(() => {}); }, 1500);
  }

  // the rendered document on screen: the reading view, or the active mode's
  const shownRoot = () => (document.body.dataset.view === "active" ? MdActive.view.dom : content);
  // deep: between the active mode and the source editor (reading <-> source stays as it always was)
  function captureAnchor(root = shownRoot(), deep = false) {
    const edited = root !== content && MdActive.view.anchor(); // after edits the active mode counts lines itself
    if (edited) return edited;
    // the innermost block that reaches over the window's top edge (an item, not the list it is in),
    // and how far into it the edge is: `into` of its `lines` source lines
    let hit = null;
    for (const el of root.querySelectorAll("[data-line]")) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0) continue;
      if (!deep) return { line: Number(el.dataset.line), top: r.top, y: window.scrollY };
      if (r.top > 0) {
        if (!hit) return { line: Number(el.dataset.line), top: r.top, y: window.scrollY };
        hit.lines = Math.max(1, Number(el.dataset.line) - hit.line);
        break;
      }
      hit = { line: Number(el.dataset.line), top: r.top, y: window.scrollY, into: r.height ? -r.top / r.height : 0, lines: 1 };
    }
    return hit || { line: null, y: window.scrollY };
  }
  function restoreAnchor(a, root = shownRoot()) {
    if (a.line == null) { window.scrollTo(0, a.y); return; }
    if (root !== content && MdActive.view.restore(a)) return;
    let best = null, next = null;
    for (const el of root.querySelectorAll("[data-line]")) {
      if (Number(el.dataset.line) <= a.line) best = el;
      else { next = el; break; }
    }
    if (!best) { window.scrollTo(0, a.y); return; }
    const r = best.getBoundingClientRect(), line = Number(best.dataset.line);
    // from the source editor: a line inside a block — as far into the block as that line is into its lines
    if (a.source && (a.line > line || a.top < 0)) {
      const lines = Math.max(1, (next ? Number(next.dataset.line) : line + 1) - line);
      const into = Math.min(1, (a.line - line + Math.max(0, -a.top) / (a.height || 1)) / lines);
      window.scrollBy({ top: r.top + into * r.height - Math.max(0, a.top), behavior: "instant" });
      return;
    }
    window.scrollBy({ top: r.top - a.top, behavior: "instant" });
  }

  function findTarget(frag) {
    if (!frag) return null;
    let f = frag;
    try { f = decodeURIComponent(frag); } catch (e) { /* keep raw */ }
    const root = shownRoot();
    if (f.startsWith("^")) {
      const id = f.slice(1);
      return [...root.querySelectorAll("[data-line]")].find((el) => el.textContent.trim().endsWith("^" + id)) || null;
    }
    const byId = elementById(f) || elementById(slugify(f));
    if (byId) return byId;
    const want = slugify(f.split("#").pop());
    return [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((h) => slugify(h.textContent) === want) || null;
  }
  // The reading view stays in the page while the active mode shows the same ids.
  function elementById(id) {
    const root = shownRoot();
    return root === content ? document.getElementById(id) : root.querySelector(`[id="${id.replace(/["\\]/g, "\\$&")}"]`);
  }
  function scrollToFragment(frag, smooth = true) {
    const ln = /^\^line=(\d+)$/.exec(frag || ""); // a source line (from a highlight in a PDF to the note's link)
    let el = null;
    if (ln) { for (const x of shownRoot().querySelectorAll("[data-line]")) { if (Number(x.dataset.line) <= Number(ln[1])) el = x; else break; } }
    else el = findTarget(frag);
    if (!el) { if (smooth) toast(T("Section not found")); return; }
    el.scrollIntoView({ behavior: smooth && !reducedMotion() ? "smooth" : "instant", block: "start" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  }
  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  // An image was just added at the end: go there, again once it has its height.
  function scrollToEnd() {
    const go = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reducedMotion() ? "instant" : "smooth" });
    go();
    const img = [...shownRoot().querySelectorAll("img")].pop();
    if (img && !img.complete) img.addEventListener("load", go, { once: true });
  }

  // --- mermaid (loaded on demand, ~2.7 MB)
  let mermaidLoad = null, mermaidKey = "", mermaidSeq = 0;
  const mermaidCache = new Map();
  function loadMermaid() {
    return mermaidLoad || (mermaidLoad = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.nonce = NONCE;
      s.src = ASSETS + "/vendor/mermaid.min.js";
      s.onload = resolve;
      s.onerror = () => { mermaidLoad = null; reject(new Error("mermaid.min.js missing")); };
      document.head.appendChild(s);
    }));
  }
  const hexToRgb = (h) => {
    const m = /^#?([0-9a-f]{6})/i.exec(h.trim());
    const n = m ? parseInt(m[1], 16) : 0;
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t) => {
    const x = hexToRgb(a), y = hexToRgb(b);
    return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
  };
  function configureMermaid() {
    const cs = getComputedStyle(document.documentElement);
    const c = (n) => cs.getPropertyValue("--c-" + n).trim();
    const bg = c("background"), fg = c("foreground"), acc = c("accent");
    const dark = document.body.dataset.mode === "dark";
    const key = [bg, fg, acc, dark].join();
    if (key === mermaidKey) return;
    mermaidKey = key;
    mermaidCache.clear();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "Inter, sans-serif",
      themeVariables: {
        darkMode: dark, background: bg, fontFamily: "Inter, sans-serif", fontSize: "14px",
        primaryColor: mix(bg, acc, 0.13), primaryTextColor: fg, primaryBorderColor: mix(bg, acc, 0.55),
        secondaryColor: mix(bg, fg, 0.07), secondaryTextColor: fg, secondaryBorderColor: mix(bg, fg, 0.3),
        tertiaryColor: mix(bg, fg, 0.035), tertiaryTextColor: fg, tertiaryBorderColor: mix(bg, fg, 0.2),
        lineColor: mix(bg, fg, 0.5), textColor: fg, titleColor: fg,
        mainBkg: mix(bg, acc, 0.12), nodeBorder: mix(bg, acc, 0.55), nodeTextColor: fg,
        clusterBkg: mix(bg, fg, 0.035), clusterBorder: mix(bg, fg, 0.18),
        edgeLabelBackground: bg, noteBkgColor: mix(bg, c("yellow") || acc, 0.16), noteTextColor: fg,
        noteBorderColor: mix(bg, c("yellow") || acc, 0.45),
        actorBkg: mix(bg, acc, 0.12), actorBorder: mix(bg, acc, 0.55), actorTextColor: fg,
        signalColor: fg, signalTextColor: fg, labelBoxBkgColor: mix(bg, fg, 0.05),
      },
    });
  }
  async function renderMermaid(gen, anchor, root = content) {
    const blocks = [...root.querySelectorAll("pre.mermaid")];
    if (!blocks.length) return;
    try {
      await loadMermaid();
    } catch (e) {
      blocks.forEach((b) => b.parentElement.classList.add("failed"));
      return;
    }
    if (gen !== generation) return;
    configureMermaid();
    for (const pre of blocks) {
      const host = pre.parentElement, src = pre.textContent;
      let out = mermaidCache.get(src);
      const fresh = !out;
      if (!out) {
        const id = "mmd" + ++mermaidSeq;
        try {
          out = (await mermaid.render(id, src)).svg;
          mermaidCache.set(src, out);
        } catch (e) {
          document.getElementById("d" + id)?.remove();
          document.getElementById(id)?.remove();
          out = `<div class="mermaid-error"><strong>Mermaid error</strong><pre>${esc(e.message || e)}</pre></div>`;
        }
        if (gen !== generation) return;
      }
      host.innerHTML = out;
      host.classList.add(fresh ? "rendered" : "cached");
    }
    if (anchor) restoreAnchor(anchor, root);
  }

  // one diagram as SVG (dialogs preview with it); rejects with the parser's message
  async function mermaidSvg(src) {
    await loadMermaid();
    configureMermaid();
    let out = mermaidCache.get(src);
    if (!out) {
      const id = "mmd" + ++mermaidSeq;
      try {
        out = (await mermaid.render(id, src)).svg;
        mermaidCache.set(src, out);
      } catch (e) {
        document.getElementById("d" + id)?.remove();
        document.getElementById(id)?.remove();
        throw e;
      }
    }
    return out;
  }
  // text on the accent (a menu's chosen entry, a primary button): white or black, whichever reads better on it
  function setOnAccent() {
    const m = /^#?([0-9a-f]{6})/i.exec(getComputedStyle(document.documentElement).getPropertyValue("--c-accent").trim());
    if (!m) return;
    const [r, g, b] = [0, 2, 4].map((i) => { const c = parseInt(m[1].slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    document.documentElement.style.setProperty("--on-accent", 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.05 ? "#fff" : "#000");
  }
  setOnAccent();
  function setTheme(css, mode) {
    document.getElementById("theme").textContent = css;
    document.body.dataset.mode = mode;
    setOnAccent();
    if (current && mode === "read" && content.querySelector(".mermaid-block")) draw(current, captureAnchor());
  }

  // ------------------------------------------------------------ chrome: toolbar, find, outline, toast
  const toolbar = document.createElement("nav");
  toolbar.id = "toolbar";
  toolbar.innerHTML =
    `<button class="tb" data-act="sidebar" title="${esc(T("Sidebar (Ctrl+Alt+S)"))}" aria-label="${esc(T("Sidebar"))}">${ICON.sidebar}</button>` +
    // (a note opened by itself has no sidebar: this opens its folder beside it — the desktop only; viewer.css shows it while no folder is open)
    ((window.MdHost || {}).reading || !DESKTOP ? "" : `<button class="tb" data-act="notefolder" title="${esc(T("start.here"))}" aria-label="${esc(T("start.here"))}">${ICON.folder}</button>`) +
    `<button class="tb" data-act="overview" title="${esc(T("All notes (Ctrl+Alt+G)"))}" aria-label="${esc(T("All notes"))}" aria-pressed="false">${ICON.apps}</button>` +
    `<button class="tb" data-act="outline" title="${esc(T("Outline (Ctrl+Shift+O)"))}" aria-label="${esc(T("Outline"))}">${ICON.list}</button>` +
    `<button class="tb" data-act="find" title="${esc(T("Find (Ctrl+F)"))}" aria-label="${esc(T("Find"))}">${ICON.search}</button>` +
    `<button class="tb" data-act="share" title="${esc(T("Share…"))}" aria-label="${esc(T("Share"))}">${ICON.share}</button>` +
    `<div class="seg" role="radiogroup" aria-label="${esc(T("mode.label"))}" style="--i:2"><span class="seg-thumb"></span>` +
    [["edit", ICON.source], ["active", ICON.pencil], ["read", ICON.book]].map(([m, icon]) =>
      `<button class="seg-btn" role="radio" data-act="mode" data-mode="${m}" aria-checked="${m === "read"}"` +
      ` title="${esc(T("mode.tip." + m, T("mode." + m)))}" aria-label="${esc(T("mode." + m))}">${icon}</button>`).join("") +
    `</div>` +
    `<button class="tb" data-act="panel" title="${esc(T("Insert and Format (Ctrl+Alt+P)"))}" aria-label="${esc(T("Insert and Format"))}" aria-pressed="false">${ICON.panel}</button>`;
  document.body.appendChild(toolbar);

  const outlinePop = document.createElement("div");
  outlinePop.id = "outline";
  outlinePop.className = "ui-menu ui-popover surface";
  outlinePop.style.setProperty("--origin", "top right");
  outlinePop.tabIndex = -1;
  outlinePop.setAttribute("role", "menu");
  document.body.appendChild(outlinePop);

  const findBar = document.createElement("div");
  findBar.id = "findbar";
  findBar.className = "ui-menu surface";
  findBar.style.setProperty("--origin", "top right");
  findBar.innerHTML =
    `<span class="find-icon">${ICON.search}</span>` +
    `<input id="find-input" type="search" placeholder="${esc(T("Find"))}" spellcheck="false" autocomplete="off">` +
    `<span id="find-count" aria-live="polite"></span>` +
    `<button class="tb" data-act="prev" title="${esc(T("Previous match (Shift+Enter)"))}" aria-label="${esc(T("Previous match"))}">${ICON.up}</button>` +
    `<button class="tb" data-act="next" title="${esc(T("Next match (Enter)"))}" aria-label="${esc(T("Next match"))}">${ICON.down}</button>` +
    `<button class="tb" data-act="closefind" title="${esc(T("Close (Esc)"))}" aria-label="${esc(T("Close find"))}">${ICON.x}</button>`;
  document.body.appendChild(findBar);
  const findInput = findBar.querySelector("#find-input");
  const findCount = findBar.querySelector("#find-count");

  const toastEl = document.createElement("div");
  toastEl.id = "toast";
  toastEl.setAttribute("role", "status");
  document.body.appendChild(toastEl);
  let toastTimer = 0;
  /* A short message. With something to take back ({ label, type }: a button that sends that to
   * the application — Undo after a move to the trash), it stands longer, and Ctrl+Z does the
   * same while it stands (outside a text that is being typed in). */
  let toastAct = null;
  function toast(msg, action = null) {
    toastEl.textContent = msg;
    toastAct = action && action.type ? action : null;
    toastEl.toggleAttribute("data-action", !!toastAct);
    if (toastAct) {
      const b = toastEl.appendChild(document.createElement("button"));
      b.type = "button";
      b.textContent = toastAct.label === "Undo" ? T("toast.undo") : toastAct.label;
    }
    toastEl.dataset.open = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { delete toastEl.dataset.open; toastAct = null; }, toastAct ? 6000 : 1600);
  }
  const toastDo = () => { const a = toastAct; if (!a) return false; toastAct = null; clearTimeout(toastTimer); delete toastEl.dataset.open; post(a.type); return true; };
  toastEl.addEventListener("click", (e) => { if (e.target.closest("button")) toastDo(); });
  addEventListener("keydown", (e) => {
    if (!toastAct || e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return; // (there it is the text's own undo)
    e.preventDefault(); e.stopPropagation();
    toastDo();
  }, true);

  const outlineOpen = () => outlinePop.hasAttribute("data-open");
  const findOpen = () => findBar.hasAttribute("data-open");

  // toolbar hides while reading downwards, returns on scroll up or near the top
  let lastY = 0;
  const showToolbar = (show) => toolbar.classList.toggle("hidden", !show && !document.body.hasAttribute("data-tabs")); // (beside the tabs it stays)
  addEventListener("scroll", () => {
    const y = window.scrollY;
    if (y < 48 || y < lastY - 6) showToolbar(true);
    else if (y > lastY + 6 && !outlineOpen() && !findOpen()) showToolbar(false);
    lastY = y;
  }, { passive: true });
  addEventListener("mousemove", (e) => { if (e.clientY < 72) showToolbar(true); }, { passive: true });

  // --- outline popover
  let hl = -1;
  function buildOutline() {
    if (!outline.length) {
      outlinePop.innerHTML = '<div class="menu-empty">No headings</div>';
      return;
    }
    const minLevel = Math.min(...outline.map((o) => o.level));
    outlinePop.innerHTML = outline.map((o, i) =>
      `<button class="menu-item" role="menuitem" data-i="${i}" style="--indent:${o.level - minLevel}">${esc(o.text)}</button>`).join("");
  }
  const headingEl = (o) => (mode === "edit" ? edBack.children[o.line] : elementById(o.slug));
  function currentSection() {
    let idx = -1;
    outline.forEach((o, i) => {
      const el = headingEl(o);
      if (el && el.getBoundingClientRect().top < 120) idx = i;
    });
    return idx;
  }
  function setHl(i) {
    const items = outlinePop.querySelectorAll(".menu-item");
    items.forEach((el, k) => el.classList.toggle("hl", k === i));
    hl = i;
    if (items[i]) items[i].scrollIntoView({ block: "nearest" });
  }
  function openOutline() {
    closeFind(false);
    if (mode === "edit") outline = outlineOf(edInput.value);
    else if (mode === "active" && MdActive.view.edited) outline = outlineOf(MdActive.view.serialize(false));
    buildOutline();
    const cur = currentSection();
    outlinePop.querySelectorAll(".menu-item").forEach((el, k) => el.classList.toggle("current", k === cur));
    showToolbar(true);
    outlinePop.dataset.open = "";
    toolbar.querySelector('[data-act="outline"]').classList.add("active");
    setHl(Math.max(cur, 0));
    outlinePop.focus({ preventScroll: true });
  }
  function closeOutline() {
    if (!outlineOpen()) return false;
    delete outlinePop.dataset.open;
    toolbar.querySelector('[data-act="outline"]').classList.remove("active");
    hl = -1;
    outlinePop.querySelectorAll(".hl").forEach((el) => el.classList.remove("hl"));
    return true;
  }
  function activateOutline(i) {
    const item = outlinePop.querySelectorAll(".menu-item")[i];
    if (!item) return;
    const flash = motionMs("--flash-duration", 70);
    item.classList.remove("hl");
    setTimeout(() => item.classList.add("hl"), flash);
    setTimeout(() => {
      closeOutline();
      if (mode === "edit") goToLine(outline[i].line);
      else scrollToFragment(outline[i].slug, true);
    }, flash * 2);
  }
  outlinePop.addEventListener("mousemove", (e) => {
    const item = e.target.closest(".menu-item");
    if (item && Number(item.dataset.i) !== hl) setHl(Number(item.dataset.i));
  });
  outlinePop.addEventListener("mouseleave", () => setHl(-1));
  outlinePop.addEventListener("click", (e) => {
    const item = e.target.closest(".menu-item");
    if (item) activateOutline(Number(item.dataset.i));
  });
  outlinePop.addEventListener("keydown", (e) => {
    const n = outline.length;
    if (!n) return;
    const moves = { ArrowDown: hl + 1, ArrowUp: hl - 1, Home: 0, End: n - 1 };
    if (e.key in moves) { e.preventDefault(); setHl(Math.min(n - 1, Math.max(0, moves[e.key]))); }
    else if (e.key === "Enter" && hl >= 0) { e.preventDefault(); activateOutline(hl); }
  });

  // --- find (CSS Custom Highlight API, DOM untouched)
  let hits = [], hitIdx = -1;
  const canHighlight = typeof Highlight !== "undefined" && CSS.highlights;
  function runFind(q, keepPos = false) {
    const prevRange = hits[hitIdx];
    hits = [];
    hitIdx = -1;
    if (canHighlight) { CSS.highlights.delete("find"); CSS.highlights.delete("find-current"); }
    findBar.classList.remove("no-hits");
    if (!q) { findCount.textContent = ""; return; }
    const needle = q.toLocaleLowerCase();
    if (mode === "edit") {
      const hay = edInput.value.toLocaleLowerCase();
      for (let i = hay.indexOf(needle); i !== -1 && hits.length < 5000; i = hay.indexOf(needle, i + needle.length)) {
        const r = rangeOf(i, i + q.length);
        r.at = i;
        hits.push(r);
      }
    } else {
      const walker = document.createTreeWalker(shownRoot(), NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement.closest(".katex-mathml, style, script") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let n = walker.nextNode(); n && hits.length < 5000; n = walker.nextNode()) {
        const hay = n.data.toLocaleLowerCase();
        for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
          const r = new Range();
          r.setStart(n, i);
          r.setEnd(n, Math.min(n.data.length, i + q.length));
          hits.push(r);
        }
      }
    }
    if (!hits.length) {
      findCount.textContent = T("No matches");
      findBar.classList.add("no-hits");
      return;
    }
    if (canHighlight) CSS.highlights.set("find", new Highlight(...hits));
    const refTop = keepPos && prevRange ? prevRange.getBoundingClientRect().top - 1 : 0;
    const start = hits.findIndex((r) => r.getBoundingClientRect().top >= refTop);
    focusHit(start < 0 ? 0 : start, !keepPos);
  }
  function focusHit(i, scroll = true) {
    if (!hits.length) return;
    hitIdx = (i + hits.length) % hits.length;
    const r = hits[hitIdx];
    if (canHighlight) CSS.highlights.set("find-current", new Highlight(r));
    findCount.textContent = T("{0} of {1}", hitIdx + 1, hits.length);
    if (!scroll) return;
    const rect = r.getBoundingClientRect();
    if (rect.top < 80 || rect.bottom > innerHeight - 40) {
      window.scrollBy({ top: rect.top - innerHeight / 3, behavior: reducedMotion() ? "instant" : "smooth" });
    }
  }
  function openFind() {
    closeOutline();
    showToolbar(true);
    findBar.dataset.open = "";
    const sel = mode === "edit" ? edInput.value.slice(edInput.selectionStart, edInput.selectionEnd) : String(getSelection());
    if (sel && !sel.includes("\n") && sel.length < 80) findInput.value = sel;
    findInput.focus();
    findInput.select();
    runFind(findInput.value);
  }
  function closeFind(refocus = true) {
    if (!findOpen()) return false;
    delete findBar.dataset.open;
    if (canHighlight) { CSS.highlights.delete("find"); CSS.highlights.delete("find-current"); }
    const r = hits[hitIdx];
    hits = [];
    if (refocus) {
      findInput.blur();
      if (mode === "edit") {
        edInput.focus({ preventScroll: true });
        if (r) edInput.setSelectionRange(r.at, r.at + String(r).length);
      } else if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    }
    return true;
  }
  let findTimer = 0;
  findInput.addEventListener("input", () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => runFind(findInput.value), hits.length > 500 ? 120 : 30);
  });
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); focusHit(hitIdx + (e.shiftKey ? -1 : 1)); }
  });

  // ------------------------------------------------------------ editor
  // A plain <textarea> holds the text (native caret, undo, IME); its glyphs are
  // transparent. #ed-back on top shows the same text, one <div class="ln"> per
  // source line, with Markdown syntax coloured. Same font and width in both, so
  // they wrap alike; the backdrop gives the height and the page scrolls.
  const AUTOSAVE_MS = 800;
  const editor = document.createElement("section");
  editor.id = "editor";
  editor.innerHTML =
    '<div id="ed-wrap"><textarea id="ed-input" spellcheck="false" autocomplete="off" autocapitalize="off"' +
    ' aria-label="Markdown source" placeholder="Start writing…"></textarea><div id="ed-back" aria-hidden="true"></div></div>';
  content.after(editor);
  const edWrap = editor.firstChild;
  const edInput = edWrap.firstChild;
  const edBack = edWrap.lastChild;
  const modeSeg = toolbar.querySelector(".seg");
  // A host where a note is only read (a shared one, in the browser: MdHost.reading) has no modes
  // to switch between, and nothing to insert or format.
  const READING = !!(window.MdHost && window.MdHost.reading);
  if (READING) { modeSeg.hidden = true; for (const act of ["panel", "share"]) toolbar.querySelector(`[data-act="${act}"]`).hidden = true; }
  const MODES = ["edit", "active", "read"]; // as in the toolbar
  function showMode() {
    modeSeg.style.setProperty("--i", MODES.indexOf(mode));
    for (const b of modeSeg.querySelectorAll(".seg-btn")) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
  }

  /* A change of mode asked for by hand. In a long note it lays the whole note out anew, and the
   * page stands still for that long (0.2 s and more): so the switch answers first — its thumb is on
   * its way, the chosen mode's sign turns into a wheel (it turns on the compositor, also while the
   * page is busy) — and the change itself begins two frames later. A short note changes at once. */
  const HEAVY = 6000; // characters of Markdown from which the change is felt
  let switching = 0;
  function switchMode(next) {
    if (next === mode || !current || switching) return;
    if (current.kind === "pdf" || !current.text || current.text.length < HEAVY || (next === "active" && current.error) || (next === "edit" && current.readonly)) { setMode(next); return; }
    const btn = modeSeg.querySelector(`.seg-btn[data-mode="${next}"]`);
    modeSeg.style.setProperty("--i", MODES.indexOf(next));
    for (const b of modeSeg.querySelectorAll(".seg-btn")) b.setAttribute("aria-checked", String(b === btn));
    btn.classList.add("busy");
    const done = () => { cancelAnimationFrame(switching); switching = 0; requestAnimationFrame(() => requestAnimationFrame(() => { btn.classList.remove("busy"); showMode(); })); };
    switching = requestAnimationFrame(() => { switching = requestAnimationFrame(() => {
      try { setMode(next); } finally {
        // (the active mode's first use fetches its scripts: the wheel turns until the mode is there)
        if (mode === next) done();
        else { const t0 = performance.now(), wait = () => { if (mode === next || performance.now() - t0 > 6000) done(); else switching = requestAnimationFrame(wait); }; wait(); }
      }
    }); });
  }

  let edPath = null;     // file the editor holds; null = nothing loaded
  let edFresh = false;   // text was just loaded: put the caret where the reader was
  let edReveal = false;  // caret was placed by the caller (new note): scroll to it
  let edKeys = [];       // per line: class + html currently in #ed-back
  let lineStarts = [0];  // offset of every line in the textarea value
  let savedText = null;  // what is on disk as far as we know
  let saveTimer = 0, swapTimer = 0;

  // --- syntax colours (line based; text content always equals the source)
  const span = (cls, html) => `<span class="m-${cls}">${html}</span>`;
  const EMPH = { "**": "b", "__": "b", "~~": "s", "==": "mark" };
  const INLINE = new RegExp([
    /\\./,                                              // escape
    /(`+)(?:(?!\1).)+?\1/,                              // 1: code span
    /!?\[\[[^\[\]]+?\]\]/,                              // wikilink, embed
    /!?\[[^\]]*\]\([^)]*\)/,                            // link, image
    /(\*\*|__|~~|==)(?=\S)(.+?)(?<=\S)\2/,              // 2, 3: bold, strike, highlight
    /\*(?=\S)(.+?)(?<=\S)\*/,                           // 4: italic
    /(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/, // 5: italic
    /\$(?=[^\s$])[^$]*?(?<=\S)\$(?!\d)/,                // math
    /%%.*?%%/,                                          // comment
    /<\/?[a-zA-Z][^>]*>/,                               // html tag
    /(?<![\p{L}\p{N}/#&])#[\p{L}\p{N}_\-/]+/,           // tag
    /https?:\/\/[^\s<>)\]]+/,                           // bare url
  ].map((r) => r.source).join("|"), "gu");
  function hlInline(s) {
    let out = "", last = 0;
    for (const m of s.matchAll(INLINE)) {
      const t = m[0];
      out += esc(s.slice(last, m.index));
      last = m.index + t.length;
      if (t[0] === "\\") out += span("dim", "\\") + esc(t.slice(1));
      else if (m[1]) out += span("code", esc(t));
      else if (m[2]) { const d = span("dim", esc(m[2])); out += span(EMPH[m[2]], d + hlInline(m[3]) + d); }
      else if (m[4] != null) out += span("i", span("dim", "*") + hlInline(m[4]) + span("dim", "*"));
      else if (m[5] != null) out += span("i", span("dim", "_") + hlInline(m[5]) + span("dim", "_"));
      else if (t.startsWith("%%")) out += span("comment", esc(t));
      else if (t[0] === "$") out += span("math", esc(t));
      else if (t[0] === "<") out += span("html", esc(t));
      else if (t[0] === "#") out += /^#[\d/_-]+$/.test(t) ? esc(t) : span("tag", esc(t));
      else if (t[0] === "h") out += span("url", esc(t));
      else if (t.endsWith("]]")) out += span("link", esc(t));
      else { const i = t.indexOf("]("); out += span("link", esc(t.slice(0, i + 1))) + span("dim", esc(t.slice(i + 1))); }
    }
    return out + esc(s.slice(last));
  }
  // -> [html, line class, next state]. States: "start" (line 0), "" (text),
  // "fm" (frontmatter), "math" ($$ block), or the fence that opened a code block.
  function hlLineRaw(line, st) {
    let m;
    if (st === "start" && /^---[ \t]*$/.test(line)) return [span("dim", esc(line)), "meta", "fm"];
    if (st === "fm") {
      if (/^(---|\.\.\.)[ \t]*$/.test(line)) return [span("dim", esc(line)), "meta", ""];
      m = /^(\s*(?:- )?[^\s:#][^:]*?)(:)(\s.*|)$/.exec(line);
      return [m ? span("key", esc(m[1])) + span("dim", ":") + esc(m[3]) : esc(line), "meta", "fm"];
    }
    if (st[0] === "`" || st[0] === "~") {
      m = /^\s*(`{3,}|~{3,})[ \t]*$/.exec(line);
      return m && m[1][0] === st[0] && m[1].length >= st.length
        ? [span("dim", esc(line)), "code code-end", ""]
        : [esc(line), "code", st];
    }
    if (st === "math") return [span("math", esc(line)), "", line.trim().endsWith("$$") ? "" : "math"];
    if ((m = /^(\s*)(`{3,}(?=[^`]*$)|~{3,})(.*)$/.exec(line))) {
      return [span("dim", esc(m[1] + m[2])) + span("lang", esc(m[3])), "code code-start", m[2]];
    }
    if (/^ {0,3}\$\$/.test(line)) {
      const rest = line.trim().slice(2);
      return [span("math", esc(line)), "", rest.length >= 2 && rest.endsWith("$$") ? "" : "math"];
    }
    if ((m = /^( {0,3}#{1,6})([ \t].*|)$/.exec(line))) return [span("h", span("dim", m[1]) + hlInline(m[2])), "", ""];
    if (/^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(line)) return [span("dim", esc(line)), "", ""];
    let out = "", rest = line, cls = "";
    if ((m = /^\s*(?:>[ \t]?)+/.exec(rest))) {
      out += span("quote", esc(m[0]));
      rest = rest.slice(m[0].length);
      cls = "quote";
      if ((m = /^\[![\w-]+\][+-]?/.exec(rest))) { out += span("callout", esc(m[0])); rest = rest.slice(m[0].length); }
    }
    if ((m = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[.\](?=\s|$))?/.exec(rest))) {
      out += m[1] + span("list", esc(m[2])) + m[3] + (m[4] ? span("task", esc(m[4])) : "");
      rest = rest.slice(m[0].length);
    }
    return [out + hlInline(rest), cls, ""];
  }
  const hlCache = new Map();
  function hlLine(line, st) {
    const key = st + "\n" + line;
    let r = hlCache.get(key);
    if (!r) {
      if (hlCache.size > 20000) hlCache.clear();
      hlCache.set(key, r = hlLineRaw(line, st));
    }
    return r;
  }

  // Repaint the backdrop; only the lines that changed are touched.
  function paint(text) {
    const lines = text.split("\n"), n = lines.length;
    const keys = new Array(n), html = new Array(n), cls = new Array(n);
    lineStarts = new Array(n);
    let st = "start", off = 0;
    for (let i = 0; i < n; i++) {
      lineStarts[i] = off;
      off += lines[i].length + 1;
      const r = hlLine(lines[i], st);
      html[i] = r[0];
      cls[i] = r[1];
      keys[i] = r[1] + "\n" + r[0];
      st = r[2];
    }
    const old = edKeys, max = Math.min(old.length, n);
    let a = 0, b = 0;
    while (a < max && old[a] === keys[a]) a++;
    while (b < max - a && old[old.length - 1 - b] === keys[n - 1 - b]) b++;
    if (!a && !b) edBack.textContent = "";
    else for (let i = old.length - b - 1; i >= a; i--) edBack.children[i].remove();
    const frag = document.createDocumentFragment();
    for (let i = a; i < n - b; i++) {
      const d = document.createElement("div");
      d.className = cls[i] ? "ln " + cls[i] : "ln";
      d.innerHTML = html[i] || "<br>";
      frag.appendChild(d);
    }
    edBack.insertBefore(frag, edBack.children[a] || null);
    edKeys = keys;
  }
  function setEditorText(text) {
    edInput.value = text;
    paint(text);
  }

  // --- geometry: textarea offsets -> backdrop DOM
  function lineOf(offset) {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  function locate(offset) {
    const li = lineOf(offset), el = edBack.children[li];
    let rem = offset - lineStarts[li], last = null;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (rem <= n.data.length) return [n, rem];
      rem -= n.data.length;
      last = n;
    }
    return last ? [last, last.data.length] : [el, 0];
  }
  function rangeOf(start, end) {
    const r = new Range();
    r.setStart(...locate(start));
    r.setEnd(...locate(end));
    return r;
  }
  function revealCaret() {
    if (mode !== "edit") return;
    const pos = edInput.selectionDirection === "backward" ? edInput.selectionStart : edInput.selectionEnd;
    const r = rangeOf(pos, pos).getClientRects()[0] || edBack.children[lineOf(pos)].getBoundingClientRect();
    const top = 64 + topRoom(), bottom = innerHeight - 48;
    if (r.top < top) window.scrollBy({ top: r.top - top, behavior: "instant" });
    else if (r.bottom > bottom) window.scrollBy({ top: r.bottom - bottom, behavior: "instant" });
  }
  function captureEditAnchor() {
    const els = edBack.children;
    if (!els.length || window.scrollY < 4) return { line: null, y: 0 };
    let lo = 0, hi = els.length - 1; // first line that reaches below the top edge
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (els[mid].getBoundingClientRect().bottom > 0) hi = mid; else lo = mid + 1;
    }
    const r = els[lo].getBoundingClientRect();
    return { line: lo, top: r.top, height: r.height, y: window.scrollY };
  }
  function goToLine(line) {
    const el = edBack.children[line];
    if (!el) return;
    edInput.focus({ preventScroll: true });
    edInput.setSelectionRange(lineStarts[line], lineStarts[line]);
    el.scrollIntoView({ behavior: reducedMotion() ? "instant" : "smooth", block: "start" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  }
  function outlineOf(text) {
    const fm = stripFrontmatter(text);
    const env = { lineOffset: fm.offset, links: {}, outline: [], depth: 0 };
    md.parse(stripComments(fm.body), env);
    return env.outline;
  }

  // --- saving: automatic, shortly after the last keystroke
  const dirty = () => edPath != null && edInput.value !== savedText;
  let saveSeq = 0; // counts the saves sent; the application says which one it had when it read the file (render)
  // Some time after a save: does the file say what the editor holds? (An error is logged, nothing else.)
  let verifyTimer = 0;
  function verifySoon() {
    clearTimeout(verifyTimer);
    verifyTimer = setTimeout(() => {
      if (mode !== "active" || MdActive.view.dirty) return;
      const lost = MdActive.view.verify();
      if (lost) { console.error("mdview: " + lost); post("log", { text: lost }); }
    }, 3000);
  }
  /* The note's text as the source editor has it now. The file as it is to be (raw) follows, its
   * line ends kept — the views of a note with pages are made from it, and the active mode showed
   * the note as it had been before the source was edited, until it was read anew. */
  function sourceIs(p, text) {
    p.text = text;
    p.raw = /\r\n/.test(p.raw || "") ? text.replace(/\n/g, "\r\n") : text;
    p._view = null;
  }
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (mode === "active" && leaving) window.MdActive?.dialog?.finish(); // a dialog still open: its content counts
    if (window.MdActive?.view?.dirty) { // edits made in the active mode: the file as it is to be, byte for byte
      const shown = MdActive.view.payload;
      shown.raw = MdActive.view.take();
      shown.text = shown.raw.replace(/\r\n?/g, "\n");
      const p = viewPut(shown); // (a page of a note: put back into the note's text)
      p.error = null;
      trailPush(p.path, p.text);
      post("save", { text: p.raw, path: p.path, exact: true, seq: ++saveSeq });
      verifySoon();
      return;
    }
    if (!dirty()) return;
    savedText = edInput.value;
    if (current && current.path === edPath) { sourceIs(current, savedText); current.error = null; trailPush(edPath, savedText); }
    post("save", { text: savedText, path: edPath, seq: ++saveSeq });
  }
  function flush(thenClose) {
    // the window is closing over a dialog with changes in it: they are not the document's yet — ask
    if (thenClose && mode === "active" && window.MdActive?.dialog?.changed) {
      post("closehold");
      MdActive.dialog.ask().then((how) => {
        if (how === "cancel") return;
        MdActive.dialog.close(how === "apply" ? "done" : "cancel");
        flushSave();
        post("close");
      });
      return;
    }
    window.MdBoard?.leave?.();
    flushSave();
    if (thenClose) post("close");
  }

  /* One history for a note across the modes: the texts it was saved as, in
   * order. The source editor gets the steps made elsewhere replayed into its
   * own undo history; the active mode steps back along them once its own
   * history is used up (trailStep). */
  const TRAIL_MAX = 60, REPLAY_MAX = 20;
  const LARGE_LINES = 20000; // from here on the active mode says that it may be slow
  let trail = { path: null, texts: [], at: -1 };
  let trailFloor = 0, trailRedo = [], trailStepping = false, edReplay = null, edCaret = null, activeBuilt = -1;
  function trailPush(path, text) {
    if (trail.path !== path) { trail = { path, texts: [text], at: 0 }; trailFloor = 0; trailRedo = []; return; }
    if (text === trail.texts[trail.at]) return;
    trail.texts.length = trail.at + 1;
    trail.texts.push(text);
    if (trail.texts.length > TRAIL_MAX) { trail.texts.shift(); trailFloor = Math.max(0, trailFloor - 1); }
    trail.at = trail.texts.length - 1;
  }
  function trailShow(text) {
    const a = captureAnchor();
    current.text = text;
    current.raw = /\r\n/.test(current.raw || "") ? text.replace(/\n/g, "\r\n") : text;
    trailStepping = true;
    showActive(current, a);
    MdActive.view.touch();
    activeChanged();
    trailStepping = false;
    MdActive.view.focus();
  }
  function trailStep(dir) {
    if (mode !== "active" || !current || trail.path !== current.path) return false;
    if (MdActive.view.dirty) flushSave(); // (the step before this one, not saved yet)
    if (dir < 0) {
      if (trailFloor < 1) return false;
      trailRedo.push(current.text);
      trail.at = trailFloor - 1;
      trailShow(trail.texts[trail.at]);
    } else {
      if (!trailRedo.length) return false;
      const text = trailRedo.pop();
      trailPush(current.path, text);
      trailShow(text);
    }
    trailFloor = trail.at;
    return true;
  }
  // a text into the source editor as one step of its own undo history
  function edStep(text) {
    const v = edInput.value;
    if (v === text) return;
    let a = 0;
    const max = Math.min(v.length, text.length);
    while (a < max && v.charCodeAt(a) === text.charCodeAt(a)) a++;
    let b = 0;
    while (b < max - a && v.charCodeAt(v.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
    edReplace(a, v.length - b, text.slice(a, text.length - b));
  }
  function saveFailed(msg) {
    // still dirty: the next edit or mode switch tries again — the mode's own text: after a save from
    // the active mode failed, the source editor's (older) text is not what is written next
    if (mode === "active") MdActive.view.failed(); else savedText = null;
    toast(T("Couldn't save: {0}", msg));
  }
  // The file changed on disk while it is open in the editor.
  function adoptDisk(p) {
    if (p.text === edInput.value) { savedText = p.text; return; }
    if (dirty()) {
      sourceIs(p, edInput.value);
      toast(T("File changed on disk — keeping your edits"));
      return;
    }
    const pos = edInput.selectionStart;
    setEditorText(p.text);
    savedText = p.text;
    edInput.setSelectionRange(pos, pos);
    if (findOpen()) runFind(findInput.value, true);
  }
  addEventListener("blur", flushSave);

  // --- switching between reading and editing: the views crossfade one after
  // the other (they share the page scroll) and stay on the same source line.
  function setMode(next, caret) {
    if (next === mode || !current) return;
    if (READING && next !== "read") return; // (a host that only shows a note: there is nothing but reading it)
    if (current.kind === "pdf") { toast(T("A PDF is read here, not edited")); return; }
    if (next === "active") {
      if (current.error) return;
      if (!window.MdActive?.view) { // first use: ProseMirror and active/*.js
        const from = mode;
        loadActive().then(() => { if (mode === from) setMode(next); }, () => toast(T("active.loadFailed")));
        return;
      }
    }
    if (next === "edit" && current.readonly) { toast(T("Can't edit: {0}", current.readonly)); return; }
    edCaret = mode === "active" && next === "edit" && MdActive.view.pm?.hasFocus() ? MdActive.view.caretOffset() : null;
    if (mode === "active") { leaving = true; flushSave(); leaving = false; } // current.text is what the active mode holds
    if (next === "active" && !current.toldLarge && current.text.length > 400000 && current.text.split("\n").length > LARGE_LINES) {
      current.toldLarge = true;
      toast(T("active.large"));
    }
    if (next === "edit") {
      if (edPath !== current.path || (!dirty() && edInput.value !== current.text)) {
        // What was done in the active mode since the source editor last had the note goes into
        // its undo history step by step (once it is on screen: swapView).
        const from = trail.path !== current.path || trail.texts[trail.at] !== current.text ? -1
          : edPath === current.path ? trail.texts.lastIndexOf(edInput.value, trail.at) : Math.max(0, trail.at - REPLAY_MAX);
        if (from >= 0 && from < trail.at && trail.at - from <= REPLAY_MAX) {
          if (edPath !== current.path) setEditorText(trail.texts[from]);
          edReplay = trail.texts.slice(from + 1, trail.at + 1);
        } else {
          setEditorText(current.text);
          edReplay = null;
        }
        savedText = current.text;
        edPath = current.path;
        edFresh = true;
      }
      if (caret === "end") { edInput.setSelectionRange(edInput.value.length, edInput.value.length); edFresh = false; edReveal = true; }
    } else {
      flushSave();
    }
    const prev = mode;
    mode = next;
    post("mode", { edit: mode !== "read", name: mode });
    showMode();
    closeOutline();
    // Reading <-> active: the same document in the same place, nothing to fade.
    if (prev !== "edit" && next !== "edit") { clearTimeout(swapTimer); swapView(); return; }
    document.body.classList.add("swapping", "swapped");
    clearTimeout(swapTimer);
    swapTimer = setTimeout(swapView, motionMs("--dur-fast", 160) * 0.7);
  }
  function swapView() {
    swapTimer = 0;
    const body = document.body, from = body.dataset.view || "read";
    if (from !== mode) {
      if (mode === "edit") {
        const a = window.scrollY < 4 ? { line: null } : captureAnchor(undefined, from === "active");
        body.dataset.view = "edit";
        if (edReplay) { for (const text of edReplay) edStep(text); edReplay = null; savedText = edInput.value; }
        // (a block cut by the window's top edge: the source line that far into the block's lines)
        const deep = a.line != null && a.into > 0 ? a.into * a.lines : 0;
        const at = a.line == null ? 0 : Math.min(a.line + Math.floor(deep), edBack.children.length - 1);
        const el = a.line == null ? null : edBack.children[at];
        if (el) { const r = el.getBoundingClientRect(); window.scrollBy({ top: deep ? r.top + (deep - Math.floor(deep)) * r.height : r.top - a.top, behavior: "instant" }); }
        else window.scrollTo(0, 0);
        if (edCaret != null) { // the caret where it was in the active mode
          edInput.setSelectionRange(edCaret, edCaret);
          edFresh = false;
        } else if (edFresh) {
          const pos = el ? lineStarts[Math.min(at, lineStarts.length - 1)] : 0;
          edInput.setSelectionRange(pos, pos);
          edFresh = false;
        }
        edCaret = null;
      } else {
        const a = from === "edit" ? captureEditAnchor() : { line: null, y: window.scrollY };
        if (from === "edit" && mode === "active") a.source = true;
        const caret = from === "edit" && mode === "active" ? edInput.selectionStart : null;
        if (from === "edit") {
          edInput.blur();
          sourceIs(current, edInput.value);
          trailPush(current.path, current.text);
        }
        if (mode === "active" && from === "read") MdActive.view.arriving(); // while the reading view can still be measured
        body.dataset.view = mode;
        if (mode === "active") { showActive(current, a); if (caret != null) MdActive.view.caretAt(caret); }
        else if (from === "edit" || !drawn || drawn.p !== current || drawn.text !== current.text) draw(current, a);
        if (mode === "read" && window.MdActive?.view) MdActive.view.leave();
        // links were resolved for the text as it was before editing
        if (from === "edit" && current.text.includes("[[")) post("reload");
      }
      if (findOpen()) runFind(findInput.value);
    }
    void body.offsetWidth;
    body.classList.remove("swapping");
    if (mode === "edit" && !findOpen()) edInput.focus({ preventScroll: true });
    if (mode === "active" && !findOpen()) { MdActive.view.caretHere(); MdActive.view.focus(); }
    if (mode === "edit" && edReveal) revealCaret();
    edReveal = false;
  }

  // --- active mode: the rendered document, editable in place (active/*.js).
  // Loaded on first use, so reading and editing start as fast as without it.
  // --- whiteboards: a board stands in the note as a picture (*.board.svg) and is opened over the
  // window (board.js, board/*.js), loaded on first use
  let boardLoad = null;
  const BOARD_SRC = /\.board\.svg(?:[?#]|$)/i;
  const isBoardImg = (img) => !!img && img.tagName === "IMG" && (img.dataset.board != null || BOARD_SRC.test(img.getAttribute("src") || ""));
  function loadBoard() {
    const script = (src) => new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.nonce = NONCE; s.async = false; s.src = `${ASSETS}/${src}`; s.onload = resolve; s.onerror = () => reject(new Error(src + " missing"));
      document.head.appendChild(s);
    });
    return boardLoad || (boardLoad = (async () => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = `${ASSETS}/board.css`;
      const styled = new Promise((resolve) => { l.onload = l.onerror = resolve; });
      document.head.appendChild(l);
      await Promise.all([styled, ...["board/format.js", "board/render.js", "board/shape.js", "board/items.js", "board/layer.js", "board/view.js", "board/pointer.js", "board/ink.js", "board/select.js", "board.js"].map(script)]);
    })().catch((e) => { boardLoad = null; throw e; }));
  }
  function openBoard(img) {
    if (!isBoardImg(img)) return false;
    loadBoard().then(() => window.MdBoard.open(img)).catch(() => toast("Couldn't open the whiteboard"));
    return true;
  }
  /* A new board in the note (the / menu, the panel; context.js): the host makes its file where
   * the note's pictures go and says how it is written; then it stands at the caret and is opened. */
  let boardWanted = null;
  function newBoard(put) {
    if (!current || boardWanted) return;
    const path = current.path;
    loadBoard().then(() => {
      boardWanted = { id: "n" + Date.now(), path, put };
      post("board-new", { path, text: window.MdBoard.emptyText(), id: boardWanted.id });
      setTimeout(() => { boardWanted = null; }, 8000); // (no answer: asked again the next time)
    }).catch(() => toast("Couldn't make the whiteboard"));
  }
  function boardMade(r) {
    const w = boardWanted;
    boardWanted = null;
    if (!w || !r || r.id !== w.id || !current || current.path !== w.path) return;
    if (r.error || !r.markup) { toast("Couldn't make the whiteboard"); return; }
    w.put(r.markup);
    // its picture, once it is drawn (in a vault the host is asked first where the name leads): the board opens
    const name = String(r.file || "").split("/").pop();
    let tries = 0;
    const look = () => {
      const img = name && [...shownRoot().querySelectorAll("img")].find((i) => isBoardImg(i) && decodeURIComponent((i.getAttribute("src") || "").split(/[?#]/)[0]).endsWith(name));
      if (img) openBoard(img); else if (++tries < 40) setTimeout(look, 50);
    };
    setTimeout(look, 0);
  }

  // --- PDFs: the viewer and embeds (pdfview.js, pdf.js), loaded on first use
  let pdfLoad = null;
  function loadPdf() {
    const script = (src) => new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.nonce = NONCE; s.async = false; s.src = `${ASSETS}/${src}`; s.onload = resolve; s.onerror = () => reject(new Error(src + " missing"));
      document.head.appendChild(s);
    });
    return pdfLoad || (pdfLoad = (async () => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = `${ASSETS}/pdfview.css`;
      document.head.appendChild(l);
      // All of them are asked for at once and run in this order (a script put in by a script runs
      // in the order it was put in when it is not `async`). One after the other, each waiting for
      // the one before, the first change into this mode took half a second longer.
      await Promise.all(["vendor/pdfjs/pdf.worker.min.js", "vendor/pdfjs/pdf.min.js", "pdfview.js"].map(script));
    })().catch((e) => { pdfLoad = null; throw e; }));
  }
  /* An embed typed or pasted after the note was read has no place yet (the application resolves
   * links when it reads the note). It is asked for, and what shows the embed is drawn anew. */
  const asked = new Set();
  function resolveSoon(target) {
    if (asked.has(target) || !current) return;
    asked.add(target);
    setTimeout(() => post("resolve", { target }), 0);
  }
  function linkResolved(target, info) {
    asked.delete(target); // (answered: what misses it later — after an undo, a paste — asks again)
    if (!current || !current.links) return;
    current.links[target] = info;
    if (!info) return;
    const html = md.renderInline(`![[${target}]]`, { links: current.links, depth: 0 });
    for (const span of document.querySelectorAll(".embed-missing[data-wiki]")) {
      if (span.dataset.wiki === target) span.outerHTML = html;
    }
    // the active mode keeps the HTML of what it shows: there too
    const pm = window.MdActive && MdActive.view && MdActive.view.pm;
    if (pm) {
      let tr = null;
      pm.state.doc.descendants((node, pos) => {
        if (typeof node.attrs.html !== "string" || !node.attrs.html.includes("embed-missing")) return;
        if (node.type.name === "iatom" && node.attrs.raw === `![[${target}]]`) {
          tr = (tr || pm.state.tr).setNodeMarkup(pos, null, { ...node.attrs, html });
        } else if (node.type.name === "island" && String(node.attrs.raw || "").includes(`![[${target}`)) {
          // a block that is the embed (a picture alone in its paragraph, a PDF's page, a file as code): drawn anew, whole —
          // it stayed "⤷ name" for good: a picture shown as a file and undone, or cut and pasted, was not there
          const again = MdActive.islands.blocksOf(node.attrs.raw, MdActive.view.store).find((n) => n.type.name === "island");
          if (again && again.attrs.html !== node.attrs.html) tr = (tr || pm.state.tr).setNodeMarkup(pos, null, { ...node.attrs, html: again.attrs.html });
        }
      });
      if (tr) pm.dispatch(tr.setMeta("addToHistory", false).setMeta("allowLoss", true));
    }
    pdfEmbedsSoon();
  }
  let pdfEmbedTimer = 0, pdfWatch = null;
  function pdfEmbedsSoon() { // an embedded PDF was written into the page: draw it once it stands there
    clearTimeout(pdfEmbedTimer);
    pdfEmbedTimer = setTimeout(() => loadPdf().then(() => MdPdf.hydrate(document), () => {}), 30);
    // (the active mode builds its elements anew from kept HTML, without coming through the
    // renderer: from the first embed on, new ones are looked for whenever the page changes)
    if (!pdfWatch) {
      pdfWatch = new MutationObserver(() => {
        if (!document.querySelector(".pdf-embed:not([data-done])")) return;
        clearTimeout(pdfEmbedTimer);
        pdfEmbedTimer = setTimeout(() => loadPdf().then(() => MdPdf.hydrate(document), () => {}), 30);
      });
      pdfWatch.observe(document.body, { childList: true, subtree: true });
    }
  }
  /* A picture, large: a double click on it lets it grow from its place to the size of the window
   * (a drawing as large as fits, a photo no larger than it is). A click, Esc or scrolling puts it back.
   * A drawing that stands in the page itself — a Mermaid diagram, a fence of SVG — does the same: a
   * copy of it flies (zoomFigure). */
  const zoomBox = document.createElement("div");
  zoomBox.id = "zoom";
  zoomBox.setAttribute("role", "dialog");
  zoomBox.setAttribute("aria-label", "Picture");
  zoomBox.innerHTML = '<img alt="">';
  document.body.appendChild(zoomBox);
  let zoomFrom = null, zoomBig = zoomBox.firstChild; // (what flies: the box's own picture, or the copy of a drawing)
  const zoomOpen = () => zoomBox.hasAttribute("data-open");
  function zoomPlace(img) { // where the large picture lies, and the transform that puts it over the small one
    const big = zoomBig, r = img.getBoundingClientRect(), drawn = img.localName !== "img";
    const nw = img.naturalWidth || r.width, nh = img.naturalHeight || r.height;
    const vector = drawn || /\.svg([?#]|$)/i.test(img.currentSrc || img.src) || /^data:image\/svg|^blob:/.test(img.src);
    const scale = Math.min((innerWidth * 0.94) / nw, (innerHeight * 0.92) / nh, vector ? Infinity : Math.max(1, r.width / nw));
    const w = nw * scale, h = nh * scale, left = (innerWidth - w) / 2, top = (innerHeight - h) / 2;
    big.style.width = w + "px"; big.style.height = h + "px"; big.style.left = left + "px"; big.style.top = top + "px";
    return `translate(${r.left - left}px, ${r.top - top}px) scale(${r.width / w}, ${r.height / h})`;
  }
  /* Code that is put away (a fence with "hide"), shown: a window over the page with the code, its
   * language, Copy and a way out — Esc, a click beside it, the cross. */
  const codeBox = document.createElement("div");
  codeBox.id = "codeview";
  codeBox.innerHTML = `<div class="codeview-box surface" role="dialog" aria-modal="true" aria-labelledby="codeview-title" tabindex="-1">` +
    `<header class="codeview-head"><b id="codeview-title"></b><span class="code-lang"></span><span class="codeview-space"></span>` +
    `<button class="btn code-copy" type="button">${esc(T("Copy"))}</button><button class="tb" type="button" data-codeview-close aria-label="${esc(T("Close"))}" title="${esc(T("Close (Esc)"))}">${ICON.x}</button></header>` +
    `<div class="code-block"><pre><code></code></pre></div></div>`;
  document.body.appendChild(codeBox);
  let codeFrom = null;
  const codeOpen = () => codeBox.hasAttribute("data-open");
  function openCode(block) {
    const code = block && block.querySelector("pre code");
    if (!code || codeOpen()) return false;
    codeFrom = document.activeElement;
    const title = block.querySelector(".code-card-title"), lang = block.querySelector(".code-lang");
    codeBox.querySelector("#codeview-title").textContent = title && !title.classList.contains("code-card-peek") ? title.textContent : "Code";
    codeBox.querySelector(".code-lang").textContent = lang ? lang.textContent : "";
    const shown = codeBox.querySelector("pre code");
    shown.className = code.className;
    shown.innerHTML = code.innerHTML;
    codeBox.dataset.open = "";
    codeBox.querySelector("pre").scrollTop = 0;
    codeBox.firstChild.focus({ preventScroll: true });
    return true;
  }
  function closeCode() {
    if (!codeOpen()) return false;
    delete codeBox.dataset.open;
    if (codeFrom && codeFrom.isConnected) codeFrom.focus({ preventScroll: true });
    codeFrom = null;
    return true;
  }
  document.addEventListener("keydown", (e) => {
    if (!codeOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeCode(); }
    else if (e.key === "Tab") { // the focus stays in the window
      const all = [...codeBox.querySelectorAll("button")], i = all.indexOf(document.activeElement);
      e.preventDefault(); e.stopPropagation();
      all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length].focus();
    } else if (!codeBox.contains(e.target) && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); } // (nothing is typed into the note behind it)
  }, true);
  /* Something that takes a moment and must not be done twice — a pasted or dropped file on its
   * way into a repository: the window says so at once, and takes nothing typed, pasted or
   * clicked until it is over. The application says when (MdView.busy: a text, then null). */
  const busyBox = document.createElement("div");
  busyBox.id = "busy";
  busyBox.setAttribute("role", "status");
  busyBox.innerHTML = `<div class="busy-card surface"><span class="busy-ring" aria-hidden="true"></span><span class="busy-text"></span></div>`;
  document.body.appendChild(busyBox);
  let busyTimer = 0;
  const isBusy = () => busyBox.hasAttribute("data-open");
  function busy(text) {
    clearTimeout(busyTimer);
    if (!text) { delete busyBox.dataset.open; return; }
    busyBox.querySelector(".busy-text").textContent = text;
    busyBox.dataset.open = "";
    busyTimer = setTimeout(() => { delete busyBox.dataset.open; }, 90000); // (whatever became of it: the window is not held for good)
  }
  for (const type of ["keydown", "keypress", "paste", "drop", "beforeinput"]) document.addEventListener(type, (e) => { if (isBusy()) { e.preventDefault(); e.stopPropagation(); } }, true);
  function zoomImage(img) {
    if (!img || !img.complete || !img.naturalWidth || zoomOpen()) return false;
    zoomBig = zoomBox.firstChild;
    zoomBig.src = img.currentSrc || img.src;
    return zoomFly(img);
  }
  // a drawing in the page (an <svg>): its copy, on a ground of the page's colour (a diagram is drawn for it)
  function zoomFigure(svg) {
    const r = svg && svg.getBoundingClientRect();
    if (!svg || !r.width || !r.height || zoomOpen()) return false;
    zoomBox.querySelector(".zoom-fig")?.remove();
    zoomBig = svg.cloneNode(true);
    zoomBig.removeAttribute("style"); zoomBig.removeAttribute("width"); zoomBig.removeAttribute("height");
    if (!zoomBig.hasAttribute("viewBox")) zoomBig.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    zoomBig.setAttribute("class", ((svg.getAttribute("class") || "") + " zoom-fig").trim());
    zoomBox.appendChild(zoomBig);
    return zoomFly(svg);
  }
  const zoomFigureAt = (target) => { // the drawing a click fell on: a diagram's or a fence's own <svg>
    const block = target && target.closest && target.closest(".mermaid-block, .svg-block");
    return block ? block.querySelector(":scope > svg") : null;
  };
  function zoomFly(img) {
    const big = zoomBig;
    zoomFrom = img;
    big.style.transition = "none";
    big.style.transform = zoomPlace(img);
    zoomBox.dataset.open = "";
    void big.offsetWidth;
    big.style.transition = "";
    big.style.transform = "none";
    img.style.visibility = "hidden"; // (it is the one that flies)
    return true;
  }
  function zoomClose() {
    if (!zoomOpen()) return false;
    const big = zoomBig, img = zoomFrom;
    delete zoomBox.dataset.open;
    if (img && img.isConnected) big.style.transform = zoomPlace(img);
    setTimeout(() => { if (img) img.style.visibility = ""; if (zoomOpen() && zoomBig === big) return; if (big.localName === "img") big.removeAttribute("src"); else big.remove(); }, motionMs("--dur-slow", 270) * 0.7);
    zoomFrom = null;
    return true;
  }
  zoomBox.addEventListener("click", zoomClose);
  window.addEventListener("wheel", () => zoomClose(), { passive: true });
  window.addEventListener("resize", () => zoomClose());
  document.addEventListener("keydown", (e) => { if (zoomOpen() && (e.key === "Escape" || e.key === " " || e.key === "Enter")) { e.preventDefault(); e.stopPropagation(); zoomClose(); } }, true);
  // (reading view; in the active mode the editor says when a picture was double clicked)
  content.addEventListener("dblclick", (e) => {
    const img = e.target.closest?.("img"), fig = img ? null : zoomFigureAt(e.target);
    if (fig) { e.preventDefault(); getSelection()?.removeAllRanges(); zoomFigure(fig); return; }
    if (!img || img.closest(".pdfv, a") || isBoardImg(img)) return; // (an embedded PDF page is a picture like any other here; a whiteboard is opened, by the click before)
    e.preventDefault();
    getSelection()?.removeAllRanges();
    zoomImage(img);
  });
  // the settings, from any mode (their dialog is the active mode's: loaded when first asked for)
  // — by Ctrl+, and by the gear at the window's lower left corner (the foot of the sidebar)
  const gear = document.createElement("button");
  gear.id = "settings-btn";
  gear.className = "tb";
  gear.type = "button";
  gear.dataset.tip = "Settings (Ctrl+,)";
  gear.setAttribute("aria-label", "Settings");
  gear.innerHTML = ICON.gear;
  gear.addEventListener("mousedown", (e) => e.preventDefault());
  gear.addEventListener("click", () => openSettings());
  if (READING) gear.style.display = "none"; // (a note that is only read: there is nothing of the reader's to set)
  document.body.appendChild(gear);
  // the history of the note shown (active/history.js): its versions, what each changed, one put back
  function openHistory() {
    loadActive().then(() => { MdActive.history.open(); }, () => toast(T("active.loadFailed")));
  }
  // a note shared under a link (active/share.js): for anyone, or with a password
  function openShare(path) {
    loadActive().then(() => { MdActive.share.open(path); }, () => toast(T("active.loadFailed")));
  }
  // a linked project whose two sides changed the same place: the window to say how it is to be (active/conflict.js)
  function openConflicts() {
    loadActive().then(() => { MdActive.conflict.open(); }, () => toast(T("active.loadFailed")));
  }
  function openSettings() {
    if (window.MdHost && window.MdHost.reading) return; // (a note that is only read: no settings, by the gear or by Ctrl+,)
    loadActive().then(() => { if (!MdActive.dialog.open) MdActive.prefs.open(); }, () => toast(T("active.loadFailed")));
  }
  let activeLoad = null, preloadTimer = 0;
  function loadActive() {
    const script = (src) => new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.nonce = NONCE;
      s.async = false;
      s.src = `${ASSETS}/${src}`;
      s.onload = resolve;
      s.onerror = () => reject(new Error(src + " missing"));
      document.head.appendChild(s);
    });
    const style = (href) => new Promise((resolve, reject) => {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = `${ASSETS}/${href}`;
      l.onload = resolve;
      l.onerror = () => reject(new Error(href + " missing"));
      document.head.appendChild(l);
    });
    return activeLoad || (activeLoad = (async () => {
      const css = style("active.css");
      await Promise.all(["vendor/prosemirror.min.js", "active/store.js", "active/schema.js", "active/tables.js", "active/markdown.js", "active/document.js", "active/link.js", "active/dialog.js", "active/latex-snippets.js", "active/latexsuite.js", "active/islands.js", "active/menu.js", "active/edit.js", "active/tableui.js", "active/notes.js", "active/clip.js", "active/context.js", "active/bar.js", "active/prefs.js", "vendor/diff.min.js", "active/history.js", "active/conflict.js", "active/share.js", "active/slash.js", "active/wikilink.js", "active/syntax.js", "active/graphic.js", "active/mathtext.js", "active/ghost.js", "active/columns.js", "active/blocks.js", "active/panel.js", "active/view.js"].map(script)); // (asked for at once, run in this order — see the PDF viewer's scripts)
      await css;
      MdActive.view.onChange = activeChanged; MdActive.view.onHistory = trailStep;
    })().catch((e) => { activeLoad = null; throw e; }));
  }
  function showActive(p, anchor) {
    const gen = ++generation;
    const v = viewOf(p); // (a note with pages: the page it is at)
    pagesShown = v.root || null;
    const fresh = MdActive.view.payload !== v && !(MdActive.view.payload && MdActive.view.payload.path === p.path && MdActive.view.edited);
    const store = MdActive.view.show(v);
    pageBar(v, MdActive.view.dom.parentNode);
    // a document built anew starts its own undo history here; older steps are the trail's
    if (MdActive.view.built !== activeBuilt) { activeBuilt = MdActive.view.built; trailPush(p.path, p.text); trailFloor = trail.at; }
    outline = store.env.outline;
    if (outlineOpen()) buildOutline();
    if (anchor) restoreAnchor(anchor, MdActive.view.dom);
    else if (p.fragment) scrollToFragment(p.fragment, false);
    else if (p.toEnd) scrollToEnd();
    else { window.scrollTo(0, p.arriving ? placeOf(p) : 0); p.arriving = false; } // (a note come to: where it was left; the top the first time)
    p.toEnd = false;
    if (findOpen()) runFind(findInput.value, true);
    renderMermaid(gen, anchor, MdActive.view.dom);
    if (fresh && window.scrollY > 4) MdActive.view.caretToView(); // type where you are, not at the top
  }
  // after every edit in the active mode: save soon, keep the find marks right
  function activeChanged() {
    if (!trailStepping) trailRedo = [];
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, AUTOSAVE_MS);
    if (findOpen()) {
      clearTimeout(findTimer);
      findTimer = setTimeout(() => runFind(findInput.value, true), 120);
    }
  }
  // The active mode can't show this (an error page): back to reading, at once.
  function leaveActiveNow() {
    MdActive.view.leave();
    post("mode", { edit: false });
    clearTimeout(swapTimer);
    swapTimer = 0;
    mode = "read";
    document.body.dataset.view = "read";
    document.body.classList.remove("swapping");
    showMode();
  }
  // Another file took over the window: back to reading, without the fade.
  function leaveEditNow() {
    clearTimeout(swapTimer);
    clearTimeout(saveTimer);
    swapTimer = saveTimer = 0;
    mode = "read";
    edPath = null;
    document.body.dataset.view = "read";
    document.body.classList.remove("swapping");
    showMode();
    post("mode", { edit: false });
  }
  function printDoc() {
    if (mode === "edit") { // print the rendered page, not the source
      flushSave();
      draw({ ...current, text: edInput.value }, null, true);
    } else if (mode === "active" && (!drawn || drawn.p !== current || drawn.text !== current.text)) {
      draw(current, null, true); // what prints is the reading view
    }
    post("print");
  }

  // --- typing helpers. Edits go through execCommand so native undo keeps working.
  function edReplace(start, end, text, selA, selB) {
    edInput.focus({ preventScroll: true });
    edInput.setSelectionRange(start, end);
    const ok = text ? document.execCommand("insertText", false, text) : start === end || document.execCommand("delete");
    if (!ok) {
      edInput.setRangeText(text, start, end, "end");
      edInput.dispatchEvent(new Event("input"));
    }
    if (selA != null) edInput.setSelectionRange(selA, selB ?? selA);
    revealCaret();
  }
  const LIST_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
  function edIndent(outdent) {
    const v = edInput.value, s = edInput.selectionStart, e = edInput.selectionEnd;
    const unit = /^\t/m.test(v) ? "\t" : "    ";
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", e > s && v[e - 1] === "\n" ? e - 1 : e);
    if (le < 0) le = v.length;
    const block = v.slice(ls, le);
    if (s === e && !outdent && !LIST_LINE.test(block)) { edReplace(s, e, unit); return; }
    const lines = block.split("\n");
    const out = lines.map((l) => (outdent ? l.replace(/^(?:\t| {1,4})/, "") : l && unit + l));
    const text = out.join("\n");
    if (text === block) return;
    if (s === e) edReplace(ls, le, text, Math.max(ls, s + out[0].length - lines[0].length));
    else edReplace(ls, le, text, ls, ls + text.length);
  }
  // Enter continues lists, tasks and quotes; on an empty item it ends them.
  function edNewline() {
    const v = edInput.value, s = edInput.selectionStart;
    if (s !== edInput.selectionEnd) return false;
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", s);
    if (le < 0) le = v.length;
    const line = v.slice(ls, le);
    const m = /^([ \t]*(?:>[ \t]?)*[ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[.\][ \t]+)?)?/.exec(line);
    if (!m[0] || s - ls < m[0].length) return false;
    if (line.length === m[0].length) {
      if (!m[2] && !m[1].includes(">")) return false;
      edReplace(ls, le, "");
      return true;
    }
    let next = m[1];
    if (m[2]) {
      const n = /^(\d+)([.)])/.exec(m[2]);
      next += (n ? Number(n[1]) + 1 + n[2] + m[2].slice(n[0].length) : m[2]).replace(/\[.\]/, "[ ]");
    }
    edReplace(s, s, "\n" + next);
    return true;
  }
  function edSurround(mark) {
    const v = edInput.value, s = edInput.selectionStart, e = edInput.selectionEnd, n = mark.length;
    if (s >= n && v.slice(s - n, s) === mark && v.slice(e, e + n) === mark) {
      edReplace(s - n, e + n, v.slice(s, e), s - n, e - n);
    } else {
      edReplace(s, e, mark + v.slice(s, e) + mark, s + n, e + n);
    }
  }
  function edLink() {
    const v = edInput.value, s = edInput.selectionStart, e = edInput.selectionEnd, sel = v.slice(s, e);
    if (/^https?:\/\/\S+$/.test(sel)) edReplace(s, e, `[](${sel})`, s + 1);
    else edReplace(s, e, `[${sel}](url)`, e + 3, e + 6);
  }
  const EDIT_KEYS = { b: () => edSurround("**"), i: () => edSurround("*"), k: edLink };

  edInput.addEventListener("input", () => {
    paint(edInput.value);
    revealCaret();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, AUTOSAVE_MS);
    if (findOpen()) {
      clearTimeout(findTimer);
      findTimer = setTimeout(() => runFind(findInput.value, true), 120);
    }
  });
  edInput.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey, plain = !mod && !e.altKey;
    if (e.key === "Tab" && plain) { e.preventDefault(); edIndent(e.shiftKey); }
    else if (e.key === "Enter" && plain && !e.shiftKey) { if (edNewline()) e.preventDefault(); }
    else if ((e.key === "PageDown" || e.key === "PageUp") && plain) {
      // like macOS: paging scrolls, the caret stays (the textarea is as tall as the text)
      e.preventDefault();
      window.scrollBy({ top: (e.key === "PageDown" ? 1 : -1) * (innerHeight - 80), behavior: reducedMotion() ? "instant" : "smooth" });
    }
    else if (mod && !e.shiftKey && !e.altKey && EDIT_KEYS[e.key.toLowerCase()]) { e.preventDefault(); EDIT_KEYS[e.key.toLowerCase()](); }
    else if (/^(Arrow|Home|End)/.test(e.key)) requestAnimationFrame(revealCaret);
  });
  // Pasting an image: the page can't get at the image data, so the shell saves it
  // as a file and answers with the Markdown to insert (insertImage).
  edInput.addEventListener("paste", (e) => {
    if (!e.clipboardData || e.clipboardData.getData("text/plain")) return;
    e.preventDefault();
    // (a host that takes files gets what the event carries; another is asked to look at the clipboard)
    const files = window.MdHost && window.MdHost.drop ? [...(e.clipboardData.files || [])] : [];
    if (files.length) window.MdHost.drop(files, edPath, { pasted: true }); else post("pasteimage", { path: edPath });
  });
  // reading: a picture pasted goes to the end of the note (where the host takes files: from the event itself)
  document.addEventListener("paste", (e) => {
    if (!(window.MdHost && window.MdHost.drop) || mode !== "read" || !current || current.error || current.readonly || current.kind === "pdf") return;
    if (e.target.closest?.("input, textarea, [contenteditable]") || !e.clipboardData || e.clipboardData.getData("text/plain").trim()) return;
    const files = [...(e.clipboardData.files || [])];
    if (!files.length) return;
    e.preventDefault();
    window.MdHost.drop(files, current.path, { pasted: true, append: true });
  });
  function insertImage(r) {
    if (mode === "active" && current && current.path === r.path) { window.MdActive?.clip.insertMarkdown(MdActive.view.pm, r.markup); return; }
    if (mode !== "edit" || edPath !== r.path) return;
    edReplace(edInput.selectionStart, edInput.selectionEnd, r.markup);
  }
  // the textarea never scrolls on its own; the page does
  edInput.addEventListener("scroll", () => { edInput.scrollTop = 0; edInput.scrollLeft = 0; });
  editor.addEventListener("mousedown", (e) => {
    if (e.target !== editor && e.target !== edWrap) return;
    e.preventDefault(); // margin around the text: focus, below it: caret to the end
    edInput.focus({ preventScroll: true });
    if (e.clientY > edBack.getBoundingClientRect().bottom) edInput.setSelectionRange(edInput.value.length, edInput.value.length);
  });

  // ------------------------------------------------------------ sidebar (folder windows)
  // The shell sends the folder's notes as a tree (setFolder) and again whenever
  // something in the folder changes. The DOM is reconciled by path, so rows
  // keep their state and only new or removed ones animate.
  const sidebar = document.createElement("aside");
  sidebar.id = "sidebar";
  sidebar.innerHTML =
    `<header class="sb-head">` +
    `<button class="sb-folder" data-act="folder" title="${esc(T("Open another folder (Ctrl+Alt+O)"))}">${ICON.folder}<span class="sb-folder-name"></span></button>` +
    `<button class="tb" data-act="titles" aria-pressed="false">${ICON.title}</button>` +
    `<button class="tb" data-act="historymenu">${ICON.history}</button>` +
    // (only where the folder has another side to be brought in line with: a project linked to a repository, a repository in the browser)
    `<button class="tb sb-sync" data-act="syncnow" title="${esc(T("Sync Now: fetch what other devices wrote, and send what was written here"))}" aria-label="${esc(T("Sync Now"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.4L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.4L20 15.5M20 20v-4.5h-4.5"/></svg></button>` +
    `<button class="tb" data-act="newmenu" title="${esc(T("New note or folder"))}" aria-label="${esc(T("New note or folder"))}">${ICON.plus}</button>` +
    `</header>` +
    `<input class="sb-field qn-search" type="search" placeholder="${esc(T("Search"))}" aria-label="${esc(T("Search the quick notes"))}" spellcheck="false" autocomplete="off">` +
    // (what the layouts add around the list — viewer.js: "the sidebar's layouts"; each shows its own)
    `<nav class="sb-rail" aria-label="${esc(T("Folders"))}"></nav>` +
    `<div class="sb-crumb"></div>` +
    `<div class="sb-smart" role="group"></div>` +
    `<div class="sb-recent sb-extra"></div>` +
    `<div class="sb-cap sb-cap-folders">${esc(T("Folders"))}</div>` +
    `<nav class="sb-list" aria-label="${esc(T("Notes"))}"></nav>` +
    `<nav class="sb-flat sb-extra" aria-label="${esc(T("Notes"))}"></nav>` +
    `<footer class="sb-foot"><button class="sb-new-note" type="button" data-sb="new">${ICON.plus}<span>${esc(T("New Note"))}</span></button><button class="tb" type="button" data-sb="more" title="${esc(T("Order of the notes, and what is listed"))}" aria-label="${esc(T("Order of the notes, and what is listed"))}">${ICON.list}</button></footer>`;
  document.body.appendChild(sidebar);
  sidebar.querySelector(".qn-search").addEventListener("input", (e) => { quickFilter = e.target.value.trim().toLowerCase(); if (folder && folder.quick) quickPaint(); else layoutSync(); });
  sidebar.querySelector(".qn-search").addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.target.value = ""; quickFilter = ""; if (folder && folder.quick) quickPaint(); else layoutSync(); e.target.blur(); } });
  const sbHead = sidebar.querySelector(".sb-head");
  const sbList = sidebar.querySelector(".sb-list");
  const sbTitlesBtn = sbHead.querySelector('[data-act="titles"]');
  const sbHistoryBtn = sbHead.querySelector('[data-act="historymenu"]');
  // where the folder stands with a history (the shell says: f.history) — as the menu's entries name it
  const historyState = () => { const h = (folder && folder.history) || {}; return h.state === "foreign" && h.own ? (h.was ? "paused" : "adopt") : h.state || "none"; };
  const syncState = () => (((folder && folder.history) || {}).sync || {}).state || "";
  const HISTORY_SAYS = {
    none: () => "History: off",
    paused: () => "History: off (its versions are kept)",
    adopt: () => "History: off (a Git repository is here)",
    foreign: (h) => `History: kept by the repository “${h.name}”`,
    project: () => "History: on",
    inside: (h) => `History: on, in the project “${h.name}”`,
  };

  let folder = null;        // { root, name, tree } while this window browses a folder
  let sbTitles = false;     // rows show the note title (first H1) instead of the file name
  const sbOpen = new Set(); // expanded directories
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const sidebarOpen = () => document.body.dataset.sidebar === "open";
  const byLabel = (a, b) => collator.compare(a.label, b.label);
  // the order of a folder's notes (the settings' sidebarSort): the one opened last first, by name,
  // or the one changed last first — by name where that does not tell them apart. Folders: by name.
  const SORTS = ["opened", "name", "modified"];
  const sortKey = () => (folder && folder.quick ? "modified" : SORTS.includes(window.MdPrefs?.sidebarSort) ? MdPrefs.sidebarSort : "opened"); // (quick notes: what was written last is first)
  const noteLabel = (n) => (folder && folder.quick ? quickOf(n).title : (sbTitles && n.title) || n.name);
  function sortNotes(notes) {
    const key = sortKey(), by = key === "opened" ? "opened" : key === "modified" ? "mtime" : null;
    return [...notes].sort((a, b) => (by && (b[by] || 0) - (a[by] || 0)) || collator.compare(noteLabel(a), noteLabel(b)));
  }
  function setSort(key) {
    if (key === sortKey()) return;
    window.MdPrefs = { ...(window.MdPrefs || {}), sidebarSort: key };
    post("prefs", { prefs: { sidebarSort: key } });
    sortedBy = key;
    resort();
  }
  function resort() {
    if (!folder) return;
    syncList(true);
    if (window.MdOverview) MdOverview.folderChanged();
  }

  function entriesOf(dir) {
    const dirs = dir.dirs.map((d) => ({ key: d.path, dir: d, label: d.name }));
    const notes = sortNotes(dir.notes).map((n) => ({ key: n.path, note: n, label: noteLabel(n) }));
    return [...dirs.sort(byLabel), ...notes];
  }
  const rowIcon = (path) => (/\.(md|markdown|mdown|txt)$/i.test(path) ? ICON.note : /\.pdf$/i.test(path) ? ICON.pdf
    : /\.(png|jpe?g|gif|webp|svg|avif|bmp|tiff?|heic)$/i.test(path) ? ICON.picture : ICON.file);
  function makeItem(e, depth) {
    const item = document.createElement("div");
    item.className = e.dir ? "sb-item sb-fold is-dir" : "sb-item sb-fold";
    item.dataset.key = e.key;
    item.innerHTML = `<div class="sb-in"><button class="sb-row" type="button" style="--depth:${depth}">` +
      (e.dir ? `<span class="sb-chev">${ICON.chevron}</span>` : "") + `<span class="sb-icon">${e.dir ? ICON.folder : rowIcon(e.key)}</span><span class="sb-label"></span></button>` +
      (e.dir ? `<div class="sb-kids sb-fold"><div class="sb-in"></div></div>` : "") + `</div>`;
    item.firstChild.firstChild.draggable = true; // (into another folder: moving, below)
    if (e.note) item.firstChild.firstChild.dataset.real = e.note.real;
    return item;
  }
  function syncDir(box, dir, depth, fresh) {
    const have = new Map();
    for (const el of box.children) if (!el.classList.contains("leaving")) have.set(el.dataset.key, el);
    let prev = null;
    for (const e of entriesOf(dir)) {
      let el = have.get(e.key);
      if (el && el.classList.contains("is-dir") !== !!e.dir) el = null;
      if (el) have.delete(e.key);
      else {
        el = makeItem(e, depth);
        if (fresh) { el.classList.add("enter"); fresh.push(el); }
      }
      const at = prev ? prev.nextSibling : box.firstChild;
      if (at !== el) box.insertBefore(el, at);
      prev = el;
      const row = el.firstChild.firstChild, label = row.querySelector(".sb-label"); // (not the row's last child: a shared note has its sign there)
      if (label.textContent !== e.label) label.textContent = e.label;
      row.title = e.note ? e.note.path.slice(folder.root.length + 1) : "";
      dressRow(el, e);
      if (e.dir) {
        el.classList.toggle("open", sbOpen.has(e.key));
        row.setAttribute("aria-expanded", String(sbOpen.has(e.key)));
        syncDir(el.querySelector(":scope > .sb-in > .sb-kids > .sb-in"), e.dir, depth + 1, fresh); // (not the row's next sibling: while the folder is renamed, that is the name's field)
      }
    }
    for (const el of have.values()) {
      if (!fresh) { el.remove(); continue; }
      el.classList.add("leaving");
      setTimeout(() => el.remove(), motionMs("--spring-smooth-dur", 510));
    }
  }
  function syncList(animate) {
    const fresh = animate ? [] : null;
    // rows that change their place glide there (where they stood, before the list is put in order)
    const stood = new Map();
    if (animate && sidebarOpen()) for (const el of sbList.querySelectorAll(".sb-item")) stood.set(el.dataset.key, el.getBoundingClientRect().top);
    const any = folder.tree.dirs.length || folder.tree.notes.length;
    sbList.querySelector(":scope > .menu-empty")?.remove();
    syncDir(sbList, folder.tree, 0, fresh);
    layoutSync();
    if (!any) sbList.insertAdjacentHTML("afterbegin", `<div class="menu-empty">${esc(T("No notes yet"))}</div>`);
    const moved = [];
    for (const [key, top] of stood) {
      const el = sbList.querySelector(`.sb-item[data-key="${CSS.escape(key)}"]:not(.leaving)`), dy = el ? top - el.getBoundingClientRect().top : 0;
      if (el && Math.abs(dy) > 1 && !el.parentNode.closest(".sb-item:not(.open)")) { el.style.transition = "none"; el.style.transform = `translateY(${dy}px)`; moved.push(el); }
    }
    if (moved.length) {
      void sbList.offsetWidth;
      const ms = motionMs("--spring-smooth-dur", 510);
      for (const el of moved) { el.style.transition = "transform var(--spring-smooth-dur) var(--spring-smooth)"; el.style.transform = ""; }
      setTimeout(() => { for (const el of moved) el.style.transition = ""; }, ms);
    }
    if (fresh && fresh.length) {
      void sbList.offsetWidth;
      fresh.forEach((el) => el.classList.remove("enter"));
    }
  }
  /* ------------------------------------------------------- the sidebar's layouts
   * The settings say how the sidebar is laid out (sidebarLayout); the list itself — its rows,
   * what a press, a pull, a right click does on them — is the same in all of them:
   *   source  the tree, the notes opened last above it, new and order at its foot
   *   rail    the folder's folders as signs in a narrow rail; beside it what is in the one chosen
   *   sheets  a sheet of paper for each note (drawn as the note is built), a folder for each
   *           folder: one folder at a time, a click goes in
   *   tiles   smart lists as tiles — all, today, shared, with tasks — above the folders
   * The quick notes are a list of their own ("plain"). A folder has a colour and a sign of its
   * own where one was chosen (right click › Colour and Icon…): kept in the folder, folder.looks. */
  const SB_LAYOUTS = ["source", "rail", "sheets", "tiles"];
  const sbLayout = () => (!folder || folder.quick ? "plain" : SB_LAYOUTS.includes(window.MdPrefs?.sidebarLayout) ? MdPrefs.sidebarLayout : "source");
  const FOLDER_ICONS = {
    book: svg('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v14H6.5A1.5 1.5 0 0 0 5 18.5z"/><path d="M5 18.5A1.5 1.5 0 0 0 6.5 20H19v-3"/>'),
    cap: svg('<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/>'),
    flask: svg('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/>'),
    pencil: svg('<path d="M4 20l1-4L16.500 4.500a2.100 2.100 0 0 1 3 3L8 19z"/>'),
    bulb: svg('<path d="M9 18h6M10 21h4M8.500 14.500a6 6 0 1 1 7 0c-.6.5-1 1.200-1 2h-5c0-.8-.4-1.500-1-2z"/>'),
    box: svg('<path d="M12 3 4 7.500v9L12 21l8-4.500v-9z"/><path d="M4 7.500 12 12l8-4.500M12 12v9"/>'),
    code: svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.500 5l-3 14"/>'),
    bolt: svg('<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>'),
    briefcase: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>'),
    inbox: svg('<path d="M4 13 6.500 5h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h5a3 3 0 0 0 6 0h5"/>'),
    calendar: svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>'),
    home: svg('<path d="M4 11 12 4l8 7M6 10v9h12v-9"/>'),
    people: svg('<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20a6.500 6.500 0 0 1 13 0M16 4.600a3.500 3.500 0 0 1 0 6.800M18 14.500a6.500 6.500 0 0 1 3.500 5.500"/>'),
    heart: svg('<path d="M12 20s-7-4.400-7-10a4 4 0 0 1 7-2.600A4 4 0 0 1 19 10c0 5.600-7 10-7 10z"/>'),
    star: svg('<path d="m12 3 2.700 5.600 6.100.8-4.500 4.300 1.100 6.100L12 17l-5.400 2.800 1.100-6.100L3.200 9.400l6.100-.8z"/>'),
    flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.200 3 14.800 0 18M12 3c-3 3.200-3 14.800 0 18"/>'),
    cart: svg('<path d="M3 4h2.500l2.200 11h10.600l1.700-8H7"/><circle cx="9" cy="19" r="1.500"/><circle cx="17" cy="19" r="1.500"/>'),
    music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6.500" cy="18" r="2.500"/><circle cx="17.500" cy="16" r="2.500"/>'),
    camera: svg('<path d="M4 8h3l1.500-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.500"/>'),
  };
  const SMART_ICONS = { all: svg('<path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>'), today: FOLDER_ICONS.calendar, shared: svg('<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>'), tasks: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>') };
  const sbRail = sidebar.querySelector(".sb-rail"), sbCrumb = sidebar.querySelector(".sb-crumb"), sbSmartBox = sidebar.querySelector(".sb-smart"), sbRecent = sidebar.querySelector(".sb-recent"), sbFlat = sidebar.querySelector(".sb-flat");
  let sbHere = null;     // rail, sheets: the folder whose notes are shown (its path; null: the folder itself)
  let sbSmart = "all";   // tiles: the smart list that is chosen
  const sbSeen = new Map();   // sheets, tiles: a note's path → { mtime, shape, open, color } — read from its beginning ("previews")
  const sbAsking = new Set();
  const relOf = (path) => path.slice(folder.root.length + 1);
  const lookOf = (path) => ((folder && folder.looks) || {})[relOf(path)] || {};
  const colorVar = (c) => (DECO_COLORS.includes(c) ? `var(--c-${c})` : "");
  const folderGlyph = (look) => FOLDER_ICONS[look.icon] || ICON.folder;
  const dirAt = (path) => { let at = null; const walk = (d) => { for (const x of d.dirs) { if (x.path === path) at = x; else if (path.startsWith(x.path + "/")) walk(x); } }; if (folder && path) walk(folder.tree); return at; };
  const everyNote = (dir = folder.tree, out = []) => { out.push(...dir.notes); for (const d of dir.dirs) everyNote(d, out); return out; };
  const sheetOf = (n) => { const s = sbSeen.get(n.path); return `<b>${esc(noteLabel(n))}</b>` + (s ? [...s.shape].map((l) => `<i class="${l}"></i>`).join("") : ""); };
  // what a row shows beyond its name: how a folder looks; when a note was changed; its sheet
  function dressRow(el, e) {
    const row = el.firstChild.firstChild, lay = sbLayout();
    if (lay === "plain") return;
    let tail = row.querySelector(":scope > .sb-tail");
    if (!tail) { tail = document.createElement("span"); tail.className = "sb-tail"; row.insertBefore(tail, row.querySelector(".sb-label").nextSibling); }
    const says = e.dir ? "" : quickWhen(e.note.mtime); // (a folder says nothing at its end: no number)
    if (tail.dataset.says !== says) tail.dataset.says = says; // (drawn by the stylesheet: the row's text stays its name)
    const look = e.dir ? lookOf(e.key) : {}, seen = e.note ? sbSeen.get(e.note.path) : null, color = e.dir ? look.color : seen && seen.color;
    row.style.setProperty("--fc", colorVar(color) || "");
    if (!colorVar(color)) row.style.removeProperty("--fc");
    if (e.dir && (row.dataset.icon || "") !== (FOLDER_ICONS[look.icon] ? look.icon : "")) { row.dataset.icon = FOLDER_ICONS[look.icon] ? look.icon : ""; row.querySelector(".sb-icon").innerHTML = folderGlyph(look); }
    let sheet = row.querySelector(":scope > .sb-sheet");
    if (lay !== "sheets") { if (sheet) sheet.remove(); return; }
    if (!sheet) { sheet = document.createElement("span"); sheet.className = e.dir ? "sb-sheet is-folder" : "sb-sheet"; sheet.setAttribute("aria-hidden", "true"); row.insertBefore(sheet, row.firstChild); }
    const html = e.dir ? `<span class="sb-sheet-tab"></span><span class="sb-sheet-in">${folderGlyph(look)}</span>` : `<span class="sb-sheet-in">${sheetOf(e.note)}</span>`;
    if (sheet.dataset.html !== html) { sheet.dataset.html = html; sheet.innerHTML = html; }
  }
  // a row that stands outside the tree (opened last, a smart list, what was searched for): the same row, its place said under its name
  function looseRow(n) {
    const el = makeItem({ key: n.path, note: n }, 0), row = el.firstChild.firstChild;
    row.draggable = false;
    row.dataset.loose = row.dataset.real; delete row.dataset.real; // (not the note's row in the tree: that one is marked, found, moved)
    row.querySelector(".sb-label").textContent = noteLabel(n);
    row.title = relOf(n.path);
    const tail = document.createElement("span"); tail.className = "sb-tail"; tail.dataset.says = quickWhen(n.mtime); row.appendChild(tail);
    return el;
  }
  function fill(box, cap, notes, none) {
    const key = cap + "\n" + notes.map((n) => n.path + "\t" + noteLabel(n) + "\t" + n.mtime).join("\n");
    if (box.dataset.key === key) return; // (as it stands: nothing is built anew)
    box.dataset.key = key;
    box.textContent = "";
    if (cap) box.insertAdjacentHTML("beforeend", `<div class="sb-cap">${esc(cap)}</div>`);
    for (const n of notes) box.appendChild(looseRow(n));
    if (!notes.length && none) box.insertAdjacentHTML("beforeend", `<div class="menu-empty">${esc(none)}</div>`);
  }
  const SMART = [
    ["all", "All", "gray", () => true],
    ["today", "Today", "blue", (n) => { const d = new Date(); return (n.mtime || 0) * 1000 >= new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }],
    ["shared", "Shared", "green", (n) => ((folder && folder.shared) || []).includes(n.real)],
    ["tasks", "With Tasks", "orange", (n) => (sbSeen.get(n.path) || {}).open > 0],
  ];
  function layoutSync() {
    const lay = sbLayout(), query = lay === "plain" ? "" : quickFilter;
    sidebar.dataset.layout = document.body.dataset.sbLayout = lay; // (the body too: the settings' gear floats over the sidebar's foot — viewer.css)
    if (lay === "plain") { sidebar.removeAttribute("data-here"); sidebar.removeAttribute("data-flat"); return; }
    if ((lay !== "rail" && lay !== "sheets") || (sbHere && !dirAt(sbHere))) sbHere = null;
    if (lay !== "tiles") sbSmart = "all";
    sidebar.toggleAttribute("data-here", !!sbHere);
    sidebar.style.setProperty("--depth-off", sbHere ? String(relOf(sbHere).split("/").length) : "0");
    for (const el of sbList.querySelectorAll(".sb-item.is-dir")) {
      const k = el.dataset.key, on = !!sbHere && (sbHere === k || sbHere.startsWith(k + "/"));
      el.classList.toggle("sb-path", on);
      el.classList.toggle("sb-at", sbHere === k);
    }
    const all = everyNote(), here = sbHere ? dirAt(sbHere) : null;
    // the rail: everything, and the folder's folders
    const rail = lay === "rail" ? [["", T("All Notes"), SMART_ICONS.all, "var(--c-gray, var(--fg2))"], ...[...folder.tree.dirs].sort((a, b) => collator.compare(a.name, b.name)).map((d) => [d.path, d.name, folderGlyph(lookOf(d.path)), colorVar(lookOf(d.path).color)])] : [];
    const railKey = JSON.stringify(rail.map(([p, n, , c]) => [p, n, c, (lookOf(p || folder.root + "/") || {}).icon]));
    if (sbRail.dataset.key !== railKey) { sbRail.dataset.key = railKey; sbRail.innerHTML = rail.map(([p, n, glyph, c]) => `<button class="sb-rt" type="button" data-go="${esc(p)}" title="${esc(n)}" aria-label="${esc(n)}"${c ? ` style="--fc: ${c}"` : ""}>${glyph}</button>`).join(""); }
    for (const b of sbRail.children) { const on = (b.dataset.go || null) === (sbHere ? folder.root + "/" + relOf(sbHere).split("/")[0] : null); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
    // where one is: in the rail's pane its name and how much is in it; among the sheets the way back
    const up = here && sbHere.replace(/\/[^/]*$/, "");
    const crumb = lay === "rail" ? `<span class="sb-crumb-name">${esc(here ? here.name : T("All Notes"))}</span>`
      : lay === "sheets" && here ? `<button class="sb-back" type="button" data-go="${esc(up === folder.root ? "" : up)}">${ICON.chevron}<span>${esc(up === folder.root ? folder.name : up.replace(/^.*\//, ""))}</span></button><span class="sb-crumb-name">${esc(here.name)}</span>` : "";
    if (sbCrumb.dataset.html !== crumb) { sbCrumb.dataset.html = crumb; sbCrumb.innerHTML = crumb; }
    sbCrumb.hidden = !crumb;
    // what was searched for, or a smart list: its notes in one list, in place of the tree
    const smart = SMART.find((s) => s[0] === sbSmart) || SMART[0];
    const flat = query ? all.filter((n) => (noteLabel(n) + "\n" + relOf(n.path)).toLowerCase().includes(query)) : smart[0] !== "all" ? all.filter(smart[3]) : null;
    sidebar.toggleAttribute("data-flat", !!flat);
    fill(sbFlat, flat ? (query ? T("Found") : T(smart[1])) : "", flat ? sortNotes(flat) : [], flat ? T("Nothing here") : "");
    // the notes opened last (source)
    const recent = lay === "source" && !flat ? all.filter((n) => n.opened).sort((a, b) => b.opened - a.opened).slice(0, 3) : [];
    fill(sbRecent, recent.length ? T("Recent") : "", recent, "");
    sbRecent.hidden = !recent.length;
    // the smart lists (tiles): how many notes each holds
    const tiles = lay === "tiles" ? SMART.map(([id, label, color, test]) => [id, label, color, all.filter(test).length]) : [];
    const tilesKey = JSON.stringify(tiles);
    if (sbSmartBox.dataset.key !== tilesKey) { sbSmartBox.dataset.key = tilesKey; sbSmartBox.innerHTML = tiles.map(([id, label, color, n]) => `<button class="sb-tile" type="button" data-smart="${id}" style="--fc: var(--c-${color}, var(--fg2))"><span class="sb-tile-dot">${SMART_ICONS[id]}</span><span class="sb-tile-n">${n}</span><span class="sb-tile-name">${esc(T(label))}</span></button>`).join(""); }
    for (const b of sbSmartBox.children) { const on = !query && b.dataset.smart === sbSmart; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
    for (const row of sidebar.querySelectorAll(".sb-extra .sb-row[data-loose]")) row.classList.toggle("active", !!current && row.dataset.loose === current.path);
    sbAsk(lay, here);
  }
  // the beginnings of the notes a layout draws from: the sheets of the folder shown; for the tiles all of them (which have tasks)
  function sbAsk(lay, here) {
    if (sbAsking.size || (lay !== "sheets" && lay !== "tiles")) return;
    const notes = lay === "tiles" ? everyNote() : (here || folder.tree).notes;
    const want = notes.filter((n) => !n.pdf && /\.(md|markdown|mdown)$/i.test(n.path) && (sbSeen.get(n.path) || {}).mtime !== n.mtime).slice(0, 40);
    if (!want.length) return;
    for (const n of want) { sbAsking.add(n.path); sbSeen.set(n.path, { ...(sbSeen.get(n.path) || { shape: "", open: 0, color: "" }), mtime: n.mtime }); } // (asked once for what it is now, whatever comes back)
    post("previews", { paths: want.map((n) => n.path) });
  }
  // … and what comes back: this list's share of it is taken out (the rest is the quick notes', All Notes')
  function sbPreviews(got) {
    const rest = {};
    let mine = false;
    for (const [path, p] of Object.entries(got || {})) {
      if (!sbAsking.has(path)) { rest[path] = p; continue; }
      mine = true;
      const fm = stripFrontmatter(String(p.text || "").replace(/\r\n?/g, "\n")), f = pageFacts({ items: fm.body.split("\n") });
      const color = fm.props && typeof fm.props.color === "string" && DECO_COLORS.includes(fm.props.color.trim().toLowerCase()) ? fm.props.color.trim().toLowerCase() : "";
      sbSeen.set(path, { mtime: (sbSeen.get(path) || {}).mtime, shape: f.shape, open: f.tasks.length - f.done, color });
    }
    if (mine || (sbAsking.size && !Object.keys(got || {}).length)) { sbAsking.clear(); if (folder && !folder.quick) syncList(false); } // (an answer with nothing in it: what was asked for is not to be had)
    return rest;
  }
  // another folder shown (rail, sheets): what is in it comes from the side one went to
  function setHere(path, back) {
    if ((path || null) === sbHere) return;
    sbHere = path || null;
    sbList.classList.remove("sb-push", "sb-push-back");
    syncList(false);
    void sbList.offsetWidth;
    sbList.classList.add(back ? "sb-push-back" : "sb-push");
    sbList.scrollTop = 0;
    markActiveNote(false);
  }
  sbList.addEventListener("animationend", () => sbList.classList.remove("sb-push", "sb-push-back"));
  sidebar.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || !folder) return;
    const here = t.closest("[data-go]"), smart = t.closest("[data-smart]"), loose = t.closest(".sb-extra .sb-row"), foot = t.closest("[data-sb]");
    if (here) setHere(here.dataset.go, here.classList.contains("sb-back"));
    else if (smart) { sbSmart = smart.dataset.smart; layoutSync(); }
    else if (loose) { if (!loose.classList.contains("active") || e.ctrlKey || e.metaKey) openRow(loose.closest(".sb-item"), e.ctrlKey || e.metaKey); }
    else if (foot && foot.dataset.sb === "new") openNewNote("note", sbHere);
    else if (foot) { const r = foot.getBoundingClientRect(); if (ctxOpen() && ctxKind === "blank") closeCtx(false); else openCtx(sidebar, r.left, r.top - 4, "blank", sbHere || folder.root); }
  });
  /* A folder's colour and its sign: chosen in a small window beside its row, kept in the folder
   * (the application writes .mdview/folders.json — "folderlook"). */
  const sbLook = document.createElement("div");
  sbLook.id = "sblook";
  sbLook.className = "ui-menu ui-popover surface";
  sbLook.setAttribute("role", "dialog");
  sbLook.tabIndex = -1;
  document.body.appendChild(sbLook);
  let sbLookFor = null;
  function paintLook() {
    const look = lookOf(sbLookFor);
    sbLook.innerHTML = `<div class="sl-cap">${esc(T("Colour"))}</div><div class="sl-colors">` + ["", ...DECO_COLORS].map((c) => `<button type="button" class="sl-color${(look.color || "") === c ? " on" : ""}" data-color="${c}" title="${esc(c ? T("color." + c) : T("slash.colorDefault"))}" aria-label="${esc(c ? T("color." + c) : T("slash.colorDefault"))}" aria-pressed="${(look.color || "") === c}"${c ? ` style="--fc: var(--c-${c})"` : ""}></button>`).join("") + `</div>`
      + `<div class="sl-cap">${esc(T("Icon"))}</div><div class="sl-icons"${colorVar(look.color) ? ` style="--fc: ${colorVar(look.color)}"` : ""}>` + ["", ...Object.keys(FOLDER_ICONS)].map((i) => `<button type="button" class="sl-icon${(FOLDER_ICONS[look.icon] ? look.icon : "") === i ? " on" : ""}" data-icon="${i}" aria-label="${i || "folder"}" aria-pressed="${(look.icon || "") === i}">${i ? FOLDER_ICONS[i] : ICON.folder}</button>`).join("") + `</div>`;
  }
  function openLook(item) {
    sbLookFor = item.dataset.key;
    paintLook();
    const r = item.firstChild.firstChild.getBoundingClientRect(), w = sbLook.offsetWidth, h = sbLook.offsetHeight;
    sbLook.style.setProperty("--origin", "top left");
    sbLook.style.left = Math.max(8, Math.min(r.left + 24, innerWidth - w - 8)) + "px";
    sbLook.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - h - 8)) + "px";
    sbLook.dataset.open = "";
    sbLook.focus({ preventScroll: true });
  }
  const closeLook = () => { if (!sbLook.hasAttribute("data-open")) return false; delete sbLook.dataset.open; sbLookFor = null; return true; };
  sbLook.addEventListener("click", (e) => {
    const b = e.target instanceof Element && e.target.closest("[data-color], [data-icon]");
    if (!b || !sbLookFor || !folder) return;
    const was = lookOf(sbLookFor), next = { color: b.dataset.color != null ? b.dataset.color : was.color || "", icon: b.dataset.icon != null ? b.dataset.icon : was.icon || "" };
    const looks = { ...(folder.looks || {}) };
    if (next.color || next.icon) looks[relOf(sbLookFor)] = next; else delete looks[relOf(sbLookFor)];
    folder.looks = looks; // (shown at once; the application says the same when it has written it)
    post("folderlook", { path: sbLookFor, color: next.color, icon: next.icon });
    syncList(false);
    paintLook();
  });
  sbLook.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); closeLook(); } });
  sbLook.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("mousedown", (e) => { if (sbLook.hasAttribute("data-open") && !(e.target instanceof Element && e.target.closest("#sblook"))) closeLook(); }, true);

  /* The sidebar's edge can be pulled, as in Finder: wider and narrower; pulled far to the left it
   * goes away, and from the window's left edge it comes out again. A double click: its own width. */
  let sbDragging = false;
  const sbGrip = document.createElement("div");
  sbGrip.id = "sb-grip";
  sbGrip.setAttribute("aria-hidden", "true");
  document.body.appendChild(sbGrip);
  const SB_MIN = 180, SB_GONE = 110, SB_OWN = 260;
  const sbMax = () => Math.max(SB_MIN, Math.min(640, innerWidth * 0.6));
  const sbWidth = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sb-w")) || SB_OWN;
  sbGrip.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !folder) return;
    e.preventDefault();
    const was = sbWidth(), wasOpen = sidebarOpen();
    let gone = !wasOpen, moved = false;
    sbDragging = true;
    document.body.classList.add("sb-sizing");
    sidebar.classList.add("no-anim");
    const move = (ev) => {
      moved = true;
      const x = ev.clientX;
      if (x < SB_GONE) { if (!gone) { gone = true; document.body.dataset.sidebar = "closed"; } return; }
      if (gone) { gone = false; document.body.dataset.sidebar = "open"; }
      document.documentElement.style.setProperty("--sb-w", Math.round(Math.max(SB_MIN, Math.min(sbMax(), x))) + "px");
    };
    const up = (ev) => {
      if (moved || Math.abs(ev.clientX - e.clientX) > 2) move(ev); // (where it was let go)
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      sbDragging = false;
      document.body.classList.remove("sb-sizing");
      sidebar.classList.remove("no-anim");
      if (!moved) return;
      if (gone) document.documentElement.style.setProperty("--sb-w", was + "px"); // (it comes back as wide as it was)
      post("sidebar", { width: Math.round(sbWidth()), visible: !gone });
      window.dispatchEvent(new Event("resize")); // (what fits itself to the column's width does so again)
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
  sbGrip.addEventListener("dblclick", () => {
    if (!sidebarOpen()) return;
    document.documentElement.style.setProperty("--sb-w", SB_OWN + "px");
    post("sidebar", { width: SB_OWN, visible: true });
    window.dispatchEvent(new Event("resize"));
  });
  function setFolder(f) {
    if (titlesAt) { // the list is fading out for a names/titles switch: swap once it is gone
      const wait = titlesAt + motionMs("--dur-fast", 160) * 0.7 - performance.now();
      titlesAt = 0;
      clearTimeout(titlesTimer);
      titlesTimer = setTimeout(() => { applyFolder(f, false); markShared(); sbList.classList.remove("swap"); }, Math.max(0, wait));
      return;
    }
    applyFolder(f, true);
    markShared();
  }
  /* A note, another file or a folder dragged into another folder — a row of the sidebar onto a
   * folder's row (or the list's empty room: the top), a tile of All Notes onto a folder's tile
   * (overview.js uses the same three). The application moves it ("move"). */
  const moving = {
    path: null, paths: null,
    // (el: what is dragged — held where the pointer took it, not by its corner or where a hover moved it;
    // also: what goes with it — the others selected in All Notes)
    start(e, path, el, also) {
      moving.path = path; moving.paths = also && also.length > 1 ? also : null; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("application/x-mdview-move", path);
      if (el) { const r = el.getBoundingClientRect(); e.dataTransfer.setDragImage(el, Math.max(0, Math.min(r.width, e.clientX - r.left)), Math.max(0, Math.min(r.height, e.clientY - r.top))); }
    },
    // (not where it is already, not into itself)
    fits: (path, dir) => dir !== path && !dir.startsWith(path + "/") && path.replace(/\/[^/]*$/, "") !== dir,
    can: (dir) => !!moving.path && !!dir && (moving.paths || [moving.path]).some((p) => moving.fits(p, dir)),
    end(dir) { const all = moving.paths || [moving.path]; moving.path = moving.paths = null; if (dir) for (const path of all) if (path && moving.fits(path, dir)) post("move", { path, dir }); },
  };
  let dropInto = null;
  const setDropInto = (el) => { if (dropInto === el) return; if (dropInto) dropInto.classList.remove("drop-into"); dropInto = el; if (el) el.classList.add("drop-into"); };
  const sbDropDir = (e) => { const dir = e.target.closest?.(".sb-item.is-dir"); return dir ? [dir, dir.dataset.key] : [sbList, folder && (sbHere || folder.root)]; };
  sbList.addEventListener("dragstart", (e) => {
    const item = e.target.closest?.(".sb-item");
    if (!item || e.target.closest(".sb-rename")) { e.preventDefault(); return; }
    moving.start(e, item.dataset.key, item.firstChild.firstChild);
  });
  sbList.addEventListener("dragover", (e) => {
    const [el, dir] = sbDropDir(e);
    if (!moving.can(dir)) { setDropInto(null); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropInto(el);
  });
  sbList.addEventListener("dragleave", (e) => { if (!sbList.contains(e.relatedTarget)) setDropInto(null); });
  sbList.addEventListener("drop", (e) => {
    const [, dir] = sbDropDir(e), ok = moving.can(dir);
    setDropInto(null);
    if (!ok) return;
    e.preventDefault();
    moving.end(dir);
  });
  document.addEventListener("dragend", () => { moving.path = null; setDropInto(null); });

  /* The notes that are shared under a link (the folder says which: shared) are marked: a small
   * sign at the end of their row, and the share button tinted while one of them is shown. */
  function markShared() {
    const shared = new Set((folder && folder.shared) || []);
    for (const row of sbList.querySelectorAll(".sb-row[data-real]")) {
      const is = shared.has(row.dataset.real), has = row.querySelector(".sb-shared");
      if (is && !has) { const s = document.createElement("span"); s.className = "sb-shared"; s.title = "Shared under a link"; s.innerHTML = ICON.share; row.appendChild(s); }
      else if (!is && has) has.remove();
    }
    const btn = toolbar.querySelector('[data-act="share"]'), on = !!(current && shared.has(current.path));
    btn.classList.toggle("active", on);
    btn.title = on ? "Shared under a link…" : "Share…";
  }
  /* ------------------------------------------------------------ quick notes
   * A window for writing something down at once (mdview --quick): the folder of the quick notes,
   * shown as a list of short notes — what each says first is its name, under it when it was
   * written and how it goes on; what was written last stands first. A new one is made by the +
   * and by a key of the settings' (quickNew), without a name being asked for: the application
   * names the file after its first line when it is left, and takes away one left empty.
   * The notes' beginnings are the application's to read ("previews", as the tiles of all notes). */
  const quickSeen = new Map(); // path → { mtime, title, says }
  const quickPlain = (line) => line.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[.\]\s+)?|\d+[.)]\s+)/, "").replace(/[*_`$]|\[\[|\]\]|!?\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
  function quickOf(n) {
    const seen = quickSeen.get(n.path);
    if (seen) return seen;
    return { title: /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}/.test(n.name) ? T("New Note") : n.name, says: "" }; // (until its beginning is read: its file's name — the time it was made at says nothing)
  }
  function quickWhen(secs) {
    if (!secs) return "";
    const d = new Date(secs * 1000), now = new Date(), day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), days = Math.round((day(now) - day(d)) / 86400000);
    if (days <= 0) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    if (days === 1) return T("Yesterday");
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });
  }
  let quickAsked = false, quickFilter = "";
  function quickPaint() {
    if (!folder || !folder.quick) return;
    const notes = new Map(folder.tree.notes.map((n) => [n.real, n])), want = [];
    for (const row of sbList.querySelectorAll(".sb-row[data-real]")) {
      const n = notes.get(row.dataset.real);
      if (!n) continue;
      const q = quickOf(n);
      let meta = row.querySelector(".qn-meta");
      if (!meta) { meta = document.createElement("span"); meta.className = "qn-meta"; meta.innerHTML = "<span class='qn-when'></span><span class='qn-says'></span>"; row.appendChild(meta); }
      const when = quickWhen(n.mtime), says = q.says || T("No additional text");
      if (meta.firstChild.textContent !== when) meta.firstChild.textContent = when;
      if (meta.lastChild.textContent !== says) meta.lastChild.textContent = says;
      const seen = quickSeen.get(n.path);
      if (!seen || seen.mtime !== n.mtime) want.push(n.path);
      const hit = !quickFilter || (q.title + "\n" + q.says).toLowerCase().includes(quickFilter);
      row.closest(".sb-item").hidden = !hit;
    }
    if (want.length && !quickAsked) { quickAsked = true; post("previews", { paths: want.slice(0, 40) }); }
  }
  function quickPreviews(got) {
    if (!folder || !folder.quick) return;
    quickAsked = false;
    const mtimes = new Map(folder.tree.notes.map((n) => [n.path, n.mtime]));
    for (const [path, p] of Object.entries(got || {})) {
      const lines = stripFrontmatter(String(p.text || "")).body.split("\n").map(quickPlain).filter(Boolean);
      quickSeen.set(path, { mtime: mtimes.get(path), title: lines[0] || T("New Note"), says: lines.slice(1, 3).join(" ") });
    }
    syncList(false); // (their names are what they say first now)
    markActiveNote(false);
    quickPaint();
  }
  // a new quick note is on screen: the caret in it, to write at once
  function quickFresh() {
    let tries = 0;
    const go = () => { if (mode === "active" && window.MdActive && MdActive.view.pm) MdActive.view.focus(); else if (tries++ < 40) setTimeout(go, 25); };
    go();
  }
  // the keys that make a new quick note, as the settings name them ("Ctrl+N", "Ctrl+Shift+K" …)
  const keysMatch = (e, combo) => {
    const parts = String(combo || "").split("+").map((x) => x.trim().toLowerCase()).filter(Boolean), key = parts.pop();
    return !!key && e.key.toLowerCase() === key && (e.ctrlKey || e.metaKey) === (parts.includes("ctrl") || parts.includes("super") || parts.includes("cmd")) && e.altKey === parts.includes("alt") && e.shiftKey === parts.includes("shift");
  };
  addEventListener("keydown", (e) => {
    if (!folder || !folder.quick || e.defaultPrevented || !keysMatch(e, window.MdPrefs?.quickNew || "Ctrl+N")) return;
    if (document.querySelector("#settings[data-open], #dlg[data-open], #share[data-open], #newdlg[data-open]")) return;
    e.preventDefault(); e.stopPropagation();
    openNewNote();
  }, true);

  /* What stands beside the notes — PDFs, pictures, sound and film, anything else — is listed as
   * the settings say, and the sidebar and All Notes each have their own say (sidebarPdf …, ovPdf …).
   * The application hands over what either wants (folder.all); each shows its part of it. */
  const GROUPS = [["pdf", "Pdf", "PDFs"], ["image", "Images", "Pictures"], ["media", "Media", "Sound and Video"], ["other", "Other", "Other Files"]];
  const groupOf = (n) => (n.kind === "pdf" ? "pdf" : n.kind === "image" ? "image" : n.kind === "audio" || n.kind === "video" ? "media" : "other");
  const groupOn = (where, g) => { const v = (window.MdPrefs || {})[where + GROUPS.find((x) => x[0] === g)[1]]; return where === "sidebar" && g === "pdf" ? v !== false : !!v; };
  function listed(node, where) {
    const notes = node.notes.filter((n) => !n.pdf || groupOn(where, groupOf(n)));
    // (a folder that holds only what is not listed here is left out; one that holds nothing at all — made just now — stays)
    const dirs = node.dirs.map((d) => [d, listed(d, where)]).filter(([d, l]) => l.dirs.length || l.notes.length || !(d.dirs.length || d.notes.length)).map(([, l]) => l);
    return { ...node, dirs, notes };
  }
  function applyFolder(f, animate) {
    f.all = f.tree;
    f.tree = listed(f.all, "sidebar");
    // (is there another side to sync with: a linked project — or, in the browser, always: the repository itself)
    document.body.toggleAttribute("data-linked", !!(window.MdWeb || ((f.history || {}).sync)));
    if (f.width && !sbDragging) document.documentElement.style.setProperty("--sb-w", f.width + "px");
    if (f.quick && !sbDragging && !(f.width >= 340)) document.documentElement.style.setProperty("--sb-w", "360px"); // (a list of notes wants room)
    document.body.toggleAttribute("data-quick", !!f.quick);
    if (!f.quick) quickSeen.clear();
    const first = !folder || folder.root !== f.root;
    if (first) { sbOpen.clear(); sbList.textContent = ""; sbHere = null; sbSmart = "all"; sbSeen.clear(); sbAsking.clear(); closeLook(); }
    folder = f;
    sbTitles = f.titles;
    sbTitlesBtn.classList.toggle("active", sbTitles);
    sbTitlesBtn.setAttribute("aria-pressed", String(sbTitles));
    sbTitlesBtn.title = sbTitlesBtn.ariaLabel = sbTitles ? "Show file names" : "Show note titles";
    sidebar.querySelector(".sb-folder-name").textContent = f.quick ? "Quick Notes" : f.name;
    sidebar.querySelector('[data-act="newmenu"]').title = sidebar.querySelector('[data-act="newmenu"]').ariaLabel = f.quick ? `New note (${keys(window.MdPrefs?.quickNew || "Ctrl+N")})` : "New note or folder";
    const hs = historyState();
    sbHistoryBtn.classList.toggle("quiet", hs !== "project" && hs !== "inside"); // (dimmed: this app keeps no history here)
    const odds = syncState() === "conflict"; // (changed here and on another device, the same place: to be said — the clock's menu)
    sbHistoryBtn.classList.toggle("warn", odds);
    // (a linked project: how it stands with its repository)
    const sy = syncState(), with_ = (f.history || {}).linked ? " · GitHub: " + ({ even: "the same on both", offline: "not reached", signin: "sign in to go on", conflict: "conflicts to resolve", error: "not going" }[sy] || "linked") : "";
    sbHistoryBtn.title = sbHistoryBtn.ariaLabel = HISTORY_SAYS[hs](f.history || {}) + (with_ || (odds ? " — conflicts to resolve" : ""));
    if (window.MdActive && MdActive.conflict) MdActive.conflict.standing((f.history || {}).sync);
    document.body.dataset.folder = "";
    if (first) openAncestors();
    syncList(animate && !first);
    quickPaint();
    markActiveNote(first);
    // (on a narrow window — a phone — the sidebar is a drawer over the note: shut until it is asked for, and as it stands after that)
    showSidebar(compact() ? (first ? false : sidebarOpen()) : f.quick ? true : f.visible, !first); // (the quick notes are their list)
    if (!current) clear();
    for (const el of tabEls()) { const t = tabs.find((x) => String(x.id) === el.dataset.id); if (t) paintTab(el, t); } // (names or titles, as the list)
    if (window.MdOverview) MdOverview.folderChanged();
  }

  // --- the note on screen: highlighted, its folders open, scrolled into view
  function openAncestors() {
    if (!folder || !current) return;
    const walk = (dir) => {
      if (dir.notes.some((n) => n.real === current.path)) return true;
      for (const d of dir.dirs) if (walk(d)) { sbOpen.add(d.path); return true; }
      return false;
    };
    walk(folder.tree);
  }
  function markActiveNote(reveal) {
    markShared(); // (the share button says whether the note now shown is shared)
    if (!folder) return;
    if (reveal && current) {
      const before = sbOpen.size;
      openAncestors();
      if (sbOpen.size !== before) syncList(true);
      // (rail, sheets: the folder the note lies in is the one shown)
      const lay = sbLayout(), holds = (dir) => dir.notes.some((n) => n.real === current.path), find = (dir) => (holds(dir) ? dir : dir.dirs.map(find).find(Boolean));
      const home = lay === "rail" || lay === "sheets" ? find(folder.tree) : null;
      if (home) { const at = home === folder.tree ? null : lay === "sheets" ? home.path : folder.root + "/" + relOf(home.path).split("/")[0]; if (at !== sbHere && !(lay === "rail" && !sbHere)) { sbHere = at; syncList(false); } }
    }
    for (const row of sidebar.querySelectorAll(".sb-extra .sb-row[data-loose]")) row.classList.toggle("active", !!current && row.dataset.loose === current.path);
    let active = null;
    for (const row of sbList.querySelectorAll(".sb-row[data-real]")) {
      const on = !!current && row.dataset.real === current.path;
      row.classList.toggle("active", on);
      if (on) { row.setAttribute("aria-current", "page"); active = row; } else row.removeAttribute("aria-current");
    }
    if (reveal && active) active.scrollIntoView({ block: "nearest" });
  }
  function toggleDir(item) {
    const key = item.dataset.key, open = !sbOpen.has(key);
    if (open) sbOpen.add(key); else sbOpen.delete(key);
    item.classList.toggle("open", open);
    item.firstChild.firstChild.setAttribute("aria-expanded", String(open));
  }
  sbList.addEventListener("click", (e) => {
    const row = e.target.closest(".sb-row");
    if (!row) return;
    const item = row.closest(".sb-item");
    if (item.classList.contains("is-dir")) { if (sbLayout() === "sheets") setHere(item.dataset.key, false); else toggleDir(item); } // (among the sheets a folder is gone into)
    else if (!row.classList.contains("active") || e.ctrlKey || e.metaKey) openRow(item, e.ctrlKey || e.metaKey);
  });
  // a note asked for in the list; with Ctrl held or the middle button: in a tab of its own
  function openRow(item, tab) {
    const row = item.firstChild.firstChild;
    going(row.dataset.real || item.dataset.key);
    post("note", { path: item.dataset.key, tab });
  }
  sbList.addEventListener("mousedown", (e) => { if (e.button === 1 && e.target.closest(".sb-row")) e.preventDefault(); }); // (no scrolling by the middle button here)
  sbList.addEventListener("auxclick", (e) => {
    const item = e.button === 1 && e.target.closest(".sb-row")?.closest(".sb-item");
    if (!item || item.classList.contains("is-dir")) return;
    e.preventDefault();
    openRow(item, true);
  });
  sbList.addEventListener("keydown", (e) => {
    const row = e.target.closest(".sb-row");
    if (!row || e.ctrlKey || e.metaKey || e.altKey) return;
    const item = row.closest(".sb-item"), isDir = item.classList.contains("is-dir");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // rows inside a closed (or closing) folder are skipped
      const rows = [...sbList.querySelectorAll(".sb-row")].filter((r) => {
        for (let p = r.closest(".sb-item").parentElement.closest(".sb-item"); p; p = p.parentElement.closest(".sb-item")) {
          if (!p.classList.contains("open") && !p.classList.contains("sb-path")) return false;
        }
        return !r.closest(".leaving");
      });
      const next = rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)];
      e.preventDefault();
      if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "F2") { e.preventDefault(); startRename(item); }
    else if (e.key === "Delete") { e.preventDefault(); post("trash", { path: item.dataset.key }); }
    else if (e.key === "ArrowRight" && isDir && !item.classList.contains("open")) { e.preventDefault(); toggleDir(item); }
    else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (isDir && item.classList.contains("open")) toggleDir(item);
      else item.parentElement.closest(".sb-item")?.firstChild.firstChild.focus();
    }
  });

  // --- rename (in place) and trash, from the context menu or F2 / Delete on a row
  const ctx = document.createElement("div");
  ctx.id = "ctxmenu";
  ctx.className = "ui-menu surface";
  ctx.style.setProperty("--origin", "top left");
  ctx.tabIndex = -1;
  ctx.setAttribute("role", "menu");
  // one menu for a file, a folder, the + button ("new"), and a note or folder among the tiles
  // ("ovnote", "ovdir": overview.js), and the empty room beside them ("blank": a new note or folder
  // in the folder `dir`); data-for says where an entry shows
  const entry = (cmd, icon, label, on, key = "", cls = "", more = "") =>
    `<button class="menu-item${cls}" role="menuitem" data-cmd="${cmd}" data-for="${on}"${more}><span class="menu-icon">${ICON[icon]}</span><span class="menu-label">${label}</span>${key ? `<span class="menu-key">${keys(key)}</span>` : ""}</button>`;
  ctx.innerHTML =
    entry("open", "note", T("Open"), "ovnote ovdir") +
    entry("opentab", "plus", T("Open in New Tab"), "file ovnote") +
    entry("opentab", "plus", T("Open in New Tabs"), "ovmany") +
    `<div class="menu-rule" data-for="file ovnote ovdir ovmany"></div>` +
    entry("tab:new", "plus", T("New Tab"), "tab", "Ctrl+T") +
    entry("tab:reopen", "note", T("Reopen Closed Tab"), "tab", "Ctrl+Shift+T") +
    `<div class="menu-rule" data-for="tab"></div>` +
    entry("tab:close", "x", T("Close Tab"), "tab", "Ctrl+W") +
    entry("tab:others", "x", T("Close Other Tabs"), "tab") +
    // the history's button: what can be done where the folder stands (data-state), or what is so (disabled)
    entry("history:conflicts", "info", T("Resolve Conflicts…"), "history", "", "", ' data-sync="conflict"') +
    `<div class="menu-rule" data-for="history" data-sync="conflict"></div>` +
    entry("history:show", "history", T("Show History of This Note"), "history", "Ctrl+Alt+H", "", ' data-state="project inside foreign adopt paused"') +
    `<div class="menu-rule" data-for="history" data-state="project inside foreign adopt paused"></div>` +
    entry("history:on", "history", T("Turn On History"), "history", "", "", ' data-state="none paused"') +
    entry("history:on", "history", T("Use This Repository for History…"), "history", "", "", ' data-state="adopt"') +
    entry("history:is", "check", T("History Is On"), "history", "", "", ' data-state="project" disabled') +
    entry("history:is", "check", "", "history", "", "", ' data-state="inside" disabled') +
    entry("history:is", "info", "", "history", "", "", ' data-state="foreign" disabled') +
    entry("history:off", "x", T("Turn Off History"), "history", "", "", ' data-state="project"') +
    entry("newnote", "note", T("New Note"), "dir new blank ovnew", "Ctrl+N") +
    entry("newfolder", "folderPlus", T("New Folder"), "dir new blank ovnew") +
    `<div class="menu-rule" data-for="blank"></div>` +
    entry("sort:opened", "check", T("Sort by Last Opened"), "blank") +
    entry("sort:name", "check", T("Sort by Name"), "blank") +
    entry("sort:modified", "check", T("Sort by Date Modified"), "blank") +
    `<div class="menu-rule" data-for="dir"></div>` +
    entry("default", "external", T("Open in Default App"), "file ovnote") +
    entry("openwith", "apps", T("Open With…"), "file ovnote") +
    entry("reveal", "reveal", T("Show in Finder"), "file dir ovnote ovdir") +
    entry("download", "down", T("Download"), "file ovnote") +
    `<div class="menu-rule" data-for="file dir ovnote ovdir"></div>` +
    entry("share", "share", T("Share…"), "file ovnote") +
    entry("look", "palette", T("Colour and Icon…"), "dir") +
    entry("rename", "rename", T("Rename"), "file dir ovnote ovdir", "F2") +
    entry("trash", "trash", T("Move to Trash"), "file dir ovnote ovdir ovmany", "Del", " danger") +
    // what is listed beside the notes: a menu of its own beside this one (the sidebar's, or All Notes' — where the click was)
    `<div class="menu-rule" data-for="blank file dir ovnote ovdir"></div>` +
    entry("sub:show", "list", T("Show"), "blank file dir ovnote ovdir", "", " has-sub", ' aria-haspopup="menu"');
  for (const el of ctx.querySelectorAll(".has-sub")) el.insertAdjacentHTML("beforeend", `<span class="menu-key menu-go">${ICON.chevron}</span>`);
  // the menu beside it: what "Show" leads to — a tick for each kind that is listed
  const ctxSub = document.createElement("div");
  ctxSub.id = "ctxsub";
  ctxSub.className = "ui-menu surface actmenu has-checks";
  ctxSub.setAttribute("role", "menu");
  ctxSub.tabIndex = -1;
  document.body.appendChild(ctxSub);
  let subItems = [], subHl = -1, subWhere = "sidebar";
  const subOpen = () => ctxSub.hasAttribute("data-open");
  const setSubHl = (i) => { subHl = i; subItems.forEach((el, k) => el.classList.toggle("hl", k === i)); };
  function openSub(from, keys) {
    if (subOpen()) { if (keys) setSubHl(0); return; }
    subWhere = ctxFor && ctxFor.closest("#overview") ? "ov" : "sidebar";
    ctxSub.innerHTML = GROUPS.map(([g, , label]) => { const on = groupOn(subWhere, g); return `<button class="menu-item" role="menuitemcheckbox" aria-checked="${on}" data-group="${g}"><span class="menu-icon"${on ? "" : ' style="visibility:hidden"'}>${ICON.check}</span><span class="menu-label">${label}</span></button>`; }).join("");
    subItems = [...ctxSub.children];
    const r = from.getBoundingClientRect(), w = ctxSub.offsetWidth, right = r.right + 2 + w <= innerWidth - 8;
    ctxSub.style.setProperty("--origin", right ? "top left" : "top right");
    ctxSub.style.left = (right ? r.right + 2 : Math.max(8, r.left - 2 - w)) + "px";
    ctxSub.style.top = Math.max(8, Math.min(r.top - 6, innerHeight - ctxSub.offsetHeight - 8)) + "px";
    ctxSub.dataset.open = "";
    from.setAttribute("aria-expanded", "true");
    setSubHl(keys ? 0 : -1);
    if (keys) ctxSub.focus({ preventScroll: true });
  }
  function closeSub(back) {
    if (!subOpen()) return false;
    delete ctxSub.dataset.open;
    for (const el of ctx.querySelectorAll(".has-sub")) el.removeAttribute("aria-expanded");
    if (back) ctx.focus({ preventScroll: true });
    return true;
  }
  function runSub(i) {
    const el = subItems[i];
    if (!el) return;
    const flash = motionMs("--flash-duration", 70), key = subWhere + GROUPS.find((x) => x[0] === el.dataset.group)[1], on = !groupOn(subWhere, el.dataset.group);
    el.classList.remove("hl");
    setTimeout(() => el.classList.add("hl"), flash);
    setTimeout(() => {
      closeCtx(false);
      window.MdPrefs = { ...(window.MdPrefs || {}), [key]: on };
      post("prefs", { prefs: { [key]: on } }); // (the application lists anew: what either wants)
    }, flash * 2);
  }
  ctxSub.addEventListener("mousemove", (e) => { const i = subItems.indexOf(e.target.closest(".menu-item")); if (i !== subHl) setSubHl(i); });
  ctxSub.addEventListener("mouseleave", () => setSubHl(-1));
  ctxSub.addEventListener("click", (e) => runSub(subItems.indexOf(e.target.closest(".menu-item"))));
  ctxSub.addEventListener("contextmenu", (e) => e.preventDefault());
  ctxSub.addEventListener("keydown", (e) => {
    const n = subItems.length, moves = { ArrowDown: subHl + 1, ArrowUp: subHl < 0 ? n - 1 : subHl - 1, Home: 0, End: n - 1 };
    if (e.key in moves) { e.preventDefault(); e.stopPropagation(); setSubHl(Math.min(n - 1, Math.max(0, moves[e.key]))); }
    else if (e.key === "Enter" && subHl >= 0) { e.preventDefault(); e.stopPropagation(); runSub(subHl); }
    else if (e.key === "ArrowLeft" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSub(true); }
  });
  document.body.appendChild(ctx);
  // A host says what it cannot do (MdHost.lacks: commands of this menu) and what it calls what it
  // does otherwise (MdHost.labels: a file deleted in a repository goes to no Trash).
  const HOST_LACKS = new Set((window.MdHost && window.MdHost.lacks) || []);
  for (const [cmd, label] of Object.entries((window.MdHost && window.MdHost.labels) || {})) for (const el of ctx.querySelectorAll(`[data-cmd="${cmd}"] .menu-label`)) el.textContent = label;
  let ctxItems = [];
  let ctxFor = null, ctxHl = -1, ctxKind = "file", ctxDir = null;
  const ctxOpen = () => ctx.hasAttribute("data-open");
  const setCtxHl = (i) => { ctxHl = i; ctxItems.forEach((el, k) => el.classList.toggle("hl", k === i)); };
  function openCtx(item, x, y, kind = "file", dir = null) {
    if (ctxFor) ctxFor.classList.remove("ctx-target");
    ctxFor = item; ctxDir = dir;
    ctxKind = ctx.dataset.kind = kind;
    for (const el of ctx.children) el.hidden = !el.dataset.for.split(" ").includes(kind) || (!!el.dataset.state && !el.dataset.state.split(" ").includes(historyState())) || (!!el.dataset.sync && el.dataset.sync !== syncState())
      || (el.dataset.cmd === "history:off" && !!((folder && folder.history) || {}).fixed) // (a host whose folders always have their history: nothing to switch off)
      || HOST_LACKS.has(el.dataset.cmd) // (what a host has no way to do — a browser shows nothing in a Finder — is not offered)
      || (el.dataset.cmd === "download" && !(window.MdHost && window.MdHost.download)); // (… and a file is handed out only where it is not one in a folder already)
    // (a rule with nothing above it, nothing below it, or another rule above it divides nothing)
    let above = false, rule = null;
    for (const el of ctx.children) {
      if (el.hidden) continue;
      if (el.classList.contains("menu-rule")) { el.hidden = !above || !!rule; if (!el.hidden) rule = el; }
      else { above = true; rule = null; }
    }
    if (rule) rule.hidden = true;
    if (kind === "history") { // (the two that name a folder)
      const name = (folder.history || {}).name;
      ctx.querySelector('[data-cmd="history:is"][data-state="inside"] .menu-label').textContent = `Part of the Project “${name}”`;
      ctx.querySelector('[data-cmd="history:is"][data-state="foreign"] .menu-label').textContent = `Kept by the Repository “${name}”`;
    }
    ctxItems = [...ctx.querySelectorAll(".menu-item:not([hidden])")];
    for (const el of ctxItems) if (el.dataset.cmd.startsWith("sort:")) { // the order in use is ticked
      const on = el.dataset.cmd.slice(5) === sortKey();
      el.setAttribute("role", "menuitemradio"); el.setAttribute("aria-checked", String(on));
      el.querySelector(".menu-icon").style.visibility = on ? "" : "hidden";
    }
    if (kind === "tab") for (const el of ctxItems) { // what there is nothing to do for stands dimmed
      const off = (el.dataset.cmd === "tab:reopen" && !tabClosed) || (el.dataset.cmd === "tab:others" && tabs.length < 2);
      el.disabled = off; el.classList.toggle("off", off);
    }
    ctxItems = ctxItems.filter((el) => !el.disabled);
    const hangs = kind === "new" || kind === "history"; // (from a button of the sidebar's head)
    ctx.style.setProperty("--origin", hangs ? "top right" : "top left");
    if (!hangs && kind !== "blank" || item.matches(".ov-more")) item.classList.add("ctx-target");
    setCtxHl(-1);
    if (hangs) x -= ctx.offsetWidth; // (it hangs from the button's right edge)
    ctx.style.left = Math.max(8, Math.min(x, innerWidth - ctx.offsetWidth - 8)) + "px";
    ctx.style.top = Math.max(8, Math.min(y, innerHeight - ctx.offsetHeight - 8)) + "px";
    ctx.dataset.open = "";
    ctx.focus({ preventScroll: true });
  }
  function closeCtx(refocus) {
    if (!ctxOpen()) return false;
    closeSub(false);
    delete ctx.dataset.open;
    ctxFor.classList.remove("ctx-target");
    if (refocus && ctxKind !== "new" && ctxKind !== "history" && ctxKind !== "blank" && ctxKind !== "tab") (ctxFor.classList.contains("sb-item") ? ctxFor.firstChild.firstChild : ctxFor).focus({ preventScroll: true });
    return true;
  }
  function runCtx(i) {
    const el = ctxItems[i], item = ctxFor;
    if (!el) return;
    if (el.dataset.cmd.startsWith("sub:")) { openSub(el, false); return; } // (a menu of its own: it stays)
    const flash = motionMs("--flash-duration", 70); // blink once, then act — like NSMenu
    el.classList.remove("hl");
    setTimeout(() => el.classList.add("hl"), flash);
    setTimeout(() => {
      const kind = ctxKind, dir = ctxDir;
      closeCtx(false);
      if (!item.isConnected) return;
      const cmd = el.dataset.cmd, tile = kind === "ovnote" || kind === "ovdir", path = tile ? item.dataset.path : item.dataset.key;
      if (kind === "ovmany") { MdOverview.many(cmd); return; } // (what is selected in All Notes, all of it)
      if (cmd === "newnote" || cmd === "newfolder") openNewNote(cmd === "newfolder" ? "folder" : "note", kind === "dir" ? item.dataset.key : kind === "blank" || kind === "ovnew" ? dir : null);
      else if (cmd.startsWith("sort:")) setSort(cmd.slice(5));
      else if (cmd === "history:show") openHistory();
      else if (cmd === "share") { if (/\.(md|markdown)$/i.test(path)) openShare(path); else toast(T("Only notes can be shared")); }
      else if (cmd === "history:conflicts") openConflicts();
      else if (cmd === "history:off") post("history-disable"); // (its versions stay; nothing more is kept)
      else if (cmd === "history:on") post("history-enable", { root: folder.root }); // (a repository that is there: the shell asks first)
      else if (cmd === "open") MdOverview.go(item);
      else if (cmd === "opentab") post("note", { path, tab: true });
      else if (cmd === "download") post("download", { path });
      else if (cmd.startsWith("tab:")) post("tab", { op: cmd.slice(4), id: item.dataset.id });
      else if (cmd === "look") openLook(item);
      else if (cmd === "rename") tile ? MdOverview.rename(item) : startRename(item);
      else if (cmd === "trash") post("trash", { path });
      else post("fileop", { op: cmd, path });
    }, flash * 2);
  }
  sidebar.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const item = e.target.closest(".sb-row")?.closest(".sb-item");
    if (item) openCtx(item, e.clientX, e.clientY, item.classList.contains("is-dir") ? "dir" : "file");
    else if (folder && !e.target.closest(".sb-head, .sb-field")) openCtx(sidebar, e.clientX, e.clientY, "blank", folder.root); // the empty room: new, in the folder itself
  });
  ctx.addEventListener("contextmenu", (e) => e.preventDefault());

  /* --- A choice among a few: a button that says what is chosen, and the app's own menu for the
   * others (the toolkit's select and its menu look like nothing else here). The <select> stays in
   * the page, unseen, and holds the value: what sets it and sends "change" sets the button too.
   * And a field with suggestions (combo): the same menu under the field, narrowed by what is typed. */
  const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const pick = document.createElement("div");
  pick.id = "pickmenu";
  pick.className = "ui-menu surface actmenu has-checks";
  pick.setAttribute("role", "menu");
  pick.tabIndex = -1;
  document.body.appendChild(pick);
  let pickFor = null, pickItems = [], pickHl = -1;
  const pickOpen = () => pick.hasAttribute("data-open");
  const pickSetHl = (i, scroll) => { pickHl = i; pickItems.forEach((b, k) => b.classList.toggle("hl", k === i)); if (scroll && pickItems[i]) pickItems[i].scrollIntoView({ block: "nearest" }); };
  function closePick(refocus) {
    if (!pickOpen()) return false;
    delete pick.dataset.open;
    const f = pickFor;
    pickFor = null;
    if (f && f.button) { f.button.setAttribute("aria-expanded", "false"); if (refocus) f.button.focus({ preventScroll: true }); }
    return true;
  }
  function pickShow(owner, anchor, entries, current) {
    pick.innerHTML = entries.map(([v, text]) => `<button class="menu-item" role="menuitemradio" type="button" aria-checked="${v === current}" data-v="${esc(v)}"><span class="menu-check">${TICK}</span><span class="menu-label">${esc(text)}</span></button>`).join("");
    pickItems = [...pick.children];
    pickFor = owner;
    pick.classList.toggle("no-checks", !!owner.input); // (a field's suggestions: nothing to tick)
    const r = anchor.getBoundingClientRect();
    pick.style.minWidth = Math.round(r.width) + "px";
    pick.style.maxHeight = "";
    const room = Math.max(innerHeight - r.bottom, r.top) - 16;
    pick.style.maxHeight = Math.min(room, 320) + "px";
    const h = pick.offsetHeight, w = Math.max(pick.offsetWidth, r.width), below = r.bottom + 4 + h <= innerHeight - 8;
    pick.style.setProperty("--origin", below ? "top right" : "bottom right");
    pick.style.left = Math.max(8, Math.min(owner.button ? r.right - w : r.left, innerWidth - w - 8)) + "px";
    pick.style.top = (below ? r.bottom + 4 : Math.max(8, r.top - 4 - h)) + "px";
    pick.dataset.open = "";
  }
  function pickChoose(i) {
    const item = pickItems[i], owner = pickFor;
    if (!item || !owner) return;
    const flash = motionMs("--flash-duration", 70); // blink once, then act — like NSMenu
    item.classList.remove("hl");
    setTimeout(() => item.classList.add("hl"), flash);
    setTimeout(() => { closePick(true); owner.take(item.dataset.v); }, flash * 2);
  }
  pick.addEventListener("mousedown", (e) => { if (pickFor && pickFor.input) e.preventDefault(); }); // (a field keeps the focus)
  pick.addEventListener("mousemove", (e) => { const i = pickItems.indexOf(e.target.closest(".menu-item")); if (i !== pickHl) pickSetHl(i); });
  pick.addEventListener("mouseleave", () => { if (!(pickFor && pickFor.input)) pickSetHl(-1); });
  pick.addEventListener("click", (e) => pickChoose(pickItems.indexOf(e.target.closest(".menu-item"))));
  pick.addEventListener("contextmenu", (e) => e.preventDefault());
  // the keys, whether the menu has the focus (a button's) or the field has it (a combo's)
  function pickKey(e) {
    const n = pickItems.length;
    if (e.key === "ArrowDown") pickSetHl(pickHl < 0 ? 0 : Math.min(n - 1, pickHl + 1), true);
    else if (e.key === "ArrowUp") pickSetHl(pickHl < 0 ? n - 1 : Math.max(0, pickHl - 1), true);
    else if (e.key === "Home" && !pickFor.input) pickSetHl(0, true);
    else if (e.key === "End" && !pickFor.input) pickSetHl(n - 1, true);
    else if (e.key === "Enter" || (e.key === " " && !pickFor.input)) { if (pickHl < 0) return false; pickChoose(pickHl); }
    else if (e.key === "Escape" || (e.key === "Tab" && !pickFor.input)) closePick(true);
    else return false;
    e.preventDefault(); e.stopPropagation();
    return true;
  }
  pick.addEventListener("keydown", (e) => { e.stopPropagation(); pickKey(e); });
  // a press beside it closes it and does nothing else
  addEventListener("pointerdown", (e) => {
    if (!pickOpen() || pick.contains(e.target)) return;
    const own = pickFor && (pickFor.button || pickFor.input).contains(e.target);
    if (own && pickFor.input) return;
    closePick(false);
    if (own) return;
    e.preventDefault(); e.stopPropagation();
    const eat = (c) => { c.preventDefault(); c.stopPropagation(); };
    addEventListener("click", eat, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", eat, true), 500);
  }, true);
  function popup(select) {
    const wrap = document.createElement("span"), button = document.createElement("button");
    wrap.className = "pop-wrap";
    button.className = "pop"; button.type = "button";
    button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-expanded", "false");
    if (select.getAttribute("aria-label")) button.setAttribute("aria-label", select.getAttribute("aria-label"));
    if (select.dataset.tip) { button.dataset.tip = select.dataset.tip; delete select.dataset.tip; }
    button.innerHTML = `<span class="pop-text"></span><span class="pop-chev">${ICON.updown}</span>`;
    const text = button.firstChild;
    const owner = { button, take: (v) => { if (select.value !== v) { select.value = v; select.dispatchEvent(new Event("change", { bubbles: true })); } } };
    wrap.sync = () => { text.textContent = select.selectedOptions[0] ? select.selectedOptions[0].textContent : ""; };
    select.hidden = true;
    select.tabIndex = -1;
    select.addEventListener("change", wrap.sync);
    const open = () => {
      pickShow(owner, button, [...select.options].map((o) => [o.value, o.textContent]), select.value);
      pickSetHl(pickItems.findIndex((b) => b.getAttribute("aria-checked") === "true"));
      button.setAttribute("aria-expanded", "true");
      pick.focus({ preventScroll: true });
    };
    button.addEventListener("click", () => { if (pickOpen() && pickFor === owner) closePick(true); else open(); });
    button.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); open(); } });
    if (select.parentNode) select.parentNode.insertBefore(wrap, select);
    wrap.append(select, button);
    wrap.sync();
    return wrap;
  }
  // a field that offers values while it is typed in: those that begin with what is typed, then those that hold it
  function combo(input, values) {
    const owner = { input, take: (v) => { input.value = v; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); } };
    const show = () => {
      const q = input.value.trim().toLowerCase(), all = values();
      const hits = q ? [...all.filter((v) => v.toLowerCase().startsWith(q)), ...all.filter((v) => !v.toLowerCase().startsWith(q) && v.toLowerCase().includes(q))] : all;
      if (!hits.length || (hits.length === 1 && hits[0].toLowerCase() === q)) { if (pickFor === owner) closePick(false); return; }
      pickShow(owner, input, hits.slice(0, 60).map((v) => [v, v]), input.value.trim());
      pickSetHl(-1);
      pick.scrollTop = 0;
    };
    input.removeAttribute("list");
    input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list");
    input.addEventListener("input", (e) => { if (e.isTrusted || document.activeElement === input) show(); });
    input.addEventListener("mousedown", () => { if (!(pickOpen() && pickFor === owner)) setTimeout(show); });
    input.addEventListener("blur", () => { if (pickFor === owner) closePick(false); });
    input.addEventListener("keydown", (e) => {
      if (pickOpen() && pickFor === owner) { pickKey(e); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); show(); }
    }, true);
    return input;
  }

  /* --- the menu for text everywhere else: a field, a title typed in place, the source editor, the
   * reading view — wherever no part of the app has a menu of its own. The toolkit's menu is never
   * shown (mdview.py); this one looks as the others do. It takes no focus, so the selection it
   * is about stays as it is; the application runs the editing command where the focus is. */
  const tmenu = document.createElement("div");
  tmenu.id = "textmenu";
  tmenu.className = "ui-menu surface actmenu";
  tmenu.setAttribute("role", "menu");
  tmenu.style.setProperty("--origin", "top left");
  document.body.appendChild(tmenu);
  let tItems = [], tHl = -1, tDo = {};
  const tOpen = () => tmenu.hasAttribute("data-open");
  const tSetHl = (i) => { tHl = i; tItems.forEach((b, k) => b.classList.toggle("hl", k === i)); };
  function closeTextMenu() {
    if (!tOpen()) return false;
    delete tmenu.dataset.open;
    return true;
  }
  function runTextMenu(i) {
    const b = tItems[i];
    if (!b || b.disabled) return;
    const flash = motionMs("--flash-duration", 70); // blink once, then act — like NSMenu
    b.classList.remove("hl");
    setTimeout(() => b.classList.add("hl"), flash);
    setTimeout(() => { closeTextMenu(); tDo[b.dataset.cmd]?.(); }, flash * 2);
  }
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return; // (a part with a menu of its own)
    e.preventDefault();
    const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (!t || t.closest("#settings-scrim, #dlg-scrim, #toolbar, #zoom")) return;
    const field = t.closest("input, textarea"), rich = t.closest('[contenteditable="true"]');
    const editable = field ? !field.readOnly && !field.disabled && !/^(checkbox|radio|range|button|submit)$/.test(field.type) : !!rich;
    if (field && !editable && field.tagName === "INPUT" && /^(checkbox|radio|range|button|submit)$/.test(field.type)) return;
    const selected = field ? field.selectionStart !== field.selectionEnd : !getSelection().isCollapsed;
    const link = t.closest("a[href]"), img = t.closest("img"), pdf = t.closest(".pdf-embed[data-wiki]");
    const href = link && !link.getAttribute("href").startsWith("#") ? link.href : null;
    const edit = (cmd) => () => post("editcmd", { cmd });
    const rows = [];
    if (editable) rows.push([T("Cut"), "Ctrl+X", selected, edit("Cut")]);
    rows.push([T("Copy"), "Ctrl+C", selected, edit("Copy")]);
    if (editable) rows.push([T("Paste"), "Ctrl+V", true, edit("Paste")]);
    if (pdf) rows.push([T("Go to PDF"), "", true, () => post("wikilink", { target: pdf.dataset.wiki, tab: "own" })], null);
    const fig = img || field || t.closest(".pm") ? null : zoomFigureAt(t);
    if (fig) rows.push([T("Show Large"), "", true, () => zoomFigure(fig)], null);
    if (href || (img && img.src)) rows.push(null);
    if (href) rows.push([T("Copy Link"), "", true, () => post("copy", { text: href })]);
    if (img && img.src) rows.push([T("Copy Image"), "", true, () => post("copyimage", { src: img.src })]);
    rows.push(null);
    // (in the active mode, beside the text or on it: the note's blocks as wholes, not its text — a field's text stays text)
    const blocks = !field && mode === "active" && window.MdActive && MdActive.view.pm && MdActive.blocks && (t.closest(".pm") || !t.closest("#sidebar, #overview, #tabs, #rpanel, #dlg, #settings, #history, #share, #ai-chat"));
    rows.push([T("Select All"), "Ctrl+A", true, blocks ? () => MdActive.blocks.selectAll(MdActive.view.pm) : edit("SelectAll")]);
    // a note with properties, clicked beside its text: they are put away, or shown again (for every note)
    if (!field && !t.closest("#sidebar, #overview, #tabs, .ui-menu, #share") && document.querySelector('#content details.props, #active .isl[data-kind="frontmatter"]')) {
      const shown = window.MdPrefs?.props !== false;
      rows.push(null, [window.MdStrings.t(shown ? "menu.propsHide" : "menu.propsShow"), "", true, () => { window.MdPrefs = { ...(window.MdPrefs || {}), props: !shown }; post("prefs", { prefs: { props: !shown } }); prefsChanged(); }]);
    }
    tDo = {};
    tmenu.innerHTML = rows.map((r, i) => (r ? `<button class="menu-item" role="menuitem" type="button" data-cmd="${i}"${r[2] ? "" : " disabled"}><span class="menu-label">${r[0]}</span>${r[1] ? `<span class="menu-key">${keys(r[1])}</span>` : ""}</button>` : `<div class="menu-rule"></div>`)).join("");
    rows.forEach((r, i) => { if (r) tDo[i] = r[3]; });
    tItems = [...tmenu.querySelectorAll(".menu-item")];
    tSetHl(-1);
    tmenu.style.left = Math.max(8, Math.min(e.clientX, innerWidth - tmenu.offsetWidth - 8)) + "px";
    tmenu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - tmenu.offsetHeight - 8)) + "px";
    tmenu.dataset.open = "";
  });
  tmenu.addEventListener("contextmenu", (e) => e.preventDefault());
  tmenu.addEventListener("mousedown", (e) => e.preventDefault()); // (the focus, and with it the selection, stays where it is)
  tmenu.addEventListener("mousemove", (e) => { const b = e.target.closest(".menu-item"), i = b && !b.disabled ? tItems.indexOf(b) : -1; if (i !== tHl) tSetHl(i); });
  tmenu.addEventListener("mouseleave", () => tSetHl(-1));
  tmenu.addEventListener("click", (e) => runTextMenu(tItems.indexOf(e.target.closest(".menu-item"))));
  // while it is open: a press beside it closes it (a left one does nothing else), the keys are its own
  addEventListener("pointerdown", (e) => {
    if (!tOpen() || tmenu.contains(e.target)) return;
    closeTextMenu();
    if (e.button !== 0) return; // a right click goes on to open the next menu
    e.preventDefault(); e.stopPropagation();
    const eat = (c) => { c.preventDefault(); c.stopPropagation(); };
    addEventListener("click", eat, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", eat, true), 500);
  }, true);
  addEventListener("keydown", (e) => {
    if (!tOpen()) return;
    const live = tItems.map((b, i) => (b.disabled ? -1 : i)).filter((i) => i >= 0), at = live.indexOf(tHl);
    if (e.key === "Escape") closeTextMenu();
    else if (e.key === "ArrowDown") tSetHl(live[Math.min(live.length - 1, at + 1)]);
    else if (e.key === "ArrowUp") tSetHl(live[at < 0 ? live.length - 1 : Math.max(0, at - 1)]);
    else if (e.key === "Enter") { if (tHl >= 0) runTextMenu(tHl); else closeTextMenu(); }
    else { closeTextMenu(); return; } // (any other key is the text's)
    e.preventDefault(); e.stopPropagation();
  }, true);
  addEventListener("blur", closeTextMenu);
  addEventListener("scroll", closeTextMenu, true);
  ctx.addEventListener("mousemove", (e) => {
    const i = ctxItems.indexOf(e.target.closest(".menu-item"));
    if (i === ctxHl) return;
    setCtxHl(i);
    // (the entry that leads to a menu of its own opens it under the pointer; any other entry puts it away)
    if (i >= 0 && ctxItems[i].classList.contains("has-sub")) openSub(ctxItems[i], false); else if (i >= 0) closeSub(false);
  });
  ctx.addEventListener("mouseleave", () => { if (!subOpen()) setCtxHl(-1); }); // (on the way into the menu beside it, its entry stays marked)
  ctx.addEventListener("click", (e) => runCtx(ctxItems.indexOf(e.target.closest(".menu-item"))));
  ctx.addEventListener("keydown", (e) => {
    const n = ctxItems.length;
    const moves = { ArrowDown: ctxHl + 1, ArrowUp: ctxHl < 0 ? n - 1 : ctxHl - 1, Home: 0, End: n - 1 };
    if (e.key in moves) { e.preventDefault(); closeSub(false); setCtxHl(Math.min(n - 1, Math.max(0, moves[e.key]))); }
    else if ((e.key === "Enter" || e.key === "ArrowRight") && ctxHl >= 0 && ctxItems[ctxHl].classList.contains("has-sub")) { e.preventDefault(); openSub(ctxItems[ctxHl], true); }
    else if (e.key === "Enter" && ctxHl >= 0) { e.preventDefault(); runCtx(ctxHl); }
  });

  function startRename(item) {
    const row = item.firstChild.firstChild;
    if (row.classList.contains("renaming")) return;
    const stem = item.classList.contains("is-dir") ? item.dataset.key.replace(/^.*\//, "") : item.dataset.key.replace(/^.*\//, "").replace(/\.[^.]+$/, ""); // (a folder has no ending to keep)
    const input = document.createElement("input");
    input.className = "sb-field sb-rename";
    input.type = "text";
    input.value = stem;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "File name");
    input.style.setProperty("--depth", row.style.getPropertyValue("--depth"));
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      const focused = document.activeElement === input;
      input.remove();
      row.classList.remove("renaming");
      if (focused) row.focus({ preventScroll: true });
      if (commit && name && name !== stem) post("rename", { path: item.dataset.key, name });
    };
    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key.startsWith("Arrow") || e.key === "Delete" || e.key === "F2") e.stopPropagation(); // not the list's keys
      else if ((e.ctrlKey || e.metaKey) && !/^[acvxz]$/i.test(e.key)) { e.preventDefault(); e.stopPropagation(); } // (nor the window's, while a name is typed)
    });
    input.addEventListener("blur", () => finish(true)); // clicking away keeps the name, like Finder
    row.classList.add("renaming");
    row.after(input);
    input.focus({ preventScroll: true });
    input.select();
  }
  // The shell renamed a file: keep its row (and the open note) instead of removing and re-adding it.
  function noteRenamed(r) {
    for (const item of sbList.querySelectorAll(".sb-item:not(.is-dir)")) {
      if (item.dataset.key !== r.old) continue;
      item.dataset.key = r.path;
      item.firstChild.firstChild.dataset.real = r.real;
    }
    if (current && current.path === r.oldReal) {
      current.path = r.real;
      current.name = r.name;
      document.title = r.name;
    }
    if (edPath === r.oldReal) edPath = r.real;
  }

  // --- file names <-> titles: the list crossfades, since every row may move
  let titlesTimer = 0, titlesAt = 0;
  function setTitles(on) {
    post("sidebar", { titles: on }); // the shell rescans (titles are only read when shown) and answers with setFolder
    sbTitlesBtn.classList.toggle("active", on);
    sbList.classList.add("swap");
    titlesAt = performance.now();
    clearTimeout(titlesTimer);
    titlesTimer = setTimeout(() => { titlesAt = 0; sbList.classList.remove("swap"); }, 2000); // no answer: show the list again
  }

  // --- showing / hiding: the sidebar slides, the text column glides to its new
  // place (transform only; the width change itself is applied at once)
  /* Under a finger. A browser makes mouse events of a tap, after the fact — a pointer that came to rest where the finger was: what
   * shows itself to a resting pointer asks touching() and shows itself by the tap instead.
   * What is pulled with a mouse (the edges things are sized at, a table's handles) is pulled by a finger the same way: on those
   * the touch is handed on as the mouse's press, moves and release, and the browser's own are left out. */
  // (an app, not a page: two fingers do not make the window's whole content larger — Safari asks with events of its own, and
  // does not heed what the page's head says; what is meant to be pinched, a whiteboard, a PDF, takes the fingers itself)
  if (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  let touchedAt = -1e9;
  addEventListener("touchstart", () => { touchedAt = performance.now(); }, { capture: true, passive: true });
  const touching = () => performance.now() - touchedAt < 1200;
  {
    const GRIPS = "#sb-grip, .col-grip, .tbl-h-col, .tbl-h-row, .dlg-grip, .pa-sheet";
    let pulled = null;
    const mouse = (type, t, target, buttons) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons, clientX: t.clientX, clientY: t.clientY, screenX: t.screenX, screenY: t.screenY }));
    const under = (t) => document.elementFromPoint(t.clientX, t.clientY) || document.body;
    addEventListener("touchstart", (e) => {
      // (what lies under the finger, not what the browser took the touch for: it hands one that is near a thing made to be met
      // to that thing, and the note's margin beside the sidebar's edge is a place of its own)
      const t = e.touches.length === 1 ? e.touches[0] : null, hit = t && document.elementFromPoint(t.clientX, t.clientY);
      if (!hit || !hit.closest(GRIPS)) { pulled = null; return; }
      pulled = { id: t.identifier, moved: false };
      mouse("mousedown", t, hit, 1);
    }, { capture: true, passive: true });
    addEventListener("touchmove", (e) => {
      const t = pulled && [...e.changedTouches].find((x) => x.identifier === pulled.id);
      if (!t) return;
      if (e.cancelable) e.preventDefault();
      pulled.moved = true;
      mouse("mousemove", t, under(t), 1);
    }, { capture: true, passive: false });
    const done = (e) => {
      const t = pulled && [...e.changedTouches].find((x) => x.identifier === pulled.id);
      if (!t) return;
      const was = pulled;
      pulled = null;
      mouse("mouseup", t, under(t), 0);
      if (was.moved && e.cancelable) e.preventDefault(); // (pulled: no tap follows, and none of the browser's mouse events)
    };
    addEventListener("touchend", done, { capture: true, passive: false });
    addEventListener("touchcancel", done, { capture: true, passive: false });
  }
  /* A finger held on something for a moment is a right click: the menu of what it rests on. (A
   * browser on a phone sends no "contextmenu" for it — Safari never, others not everywhere — so
   * the page makes one, where the browser did not: its own counts and this one is dropped.) The
   * tap that would follow the lift is swallowed, so nothing under the menu is set off. */
  {
    const HOLD = 500, SLACK = 10;
    let held = null, own = 0, swallow = 0;
    const drop = () => { if (held) { clearTimeout(held.timer); held = null; } };
    addEventListener("pointerdown", (e) => {
      drop();
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      if (e.target.closest?.("#board")) return; // (on a whiteboard a finger held still is drawing, or about to)
      const target = e.target, x = e.clientX, y = e.clientY;
      held = { x, y, timer: setTimeout(() => {
        held = null;
        if (performance.now() - own < HOLD + 200 || !target.isConnected) return; // (the browser said it itself)
        swallow = performance.now();
        getSelection()?.removeAllRanges(); // (the word a held finger selects is not what was meant)
        target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, button: 2, clientX: x, clientY: y }));
      }, HOLD) };
    }, true);
    addEventListener("pointermove", (e) => { if (held && Math.hypot(e.clientX - held.x, e.clientY - held.y) > SLACK) drop(); }, true);
    for (const type of ["pointerup", "pointercancel", "scroll"]) addEventListener(type, drop, true);
    addEventListener("contextmenu", (e) => { if (e.isTrusted) { own = performance.now(); drop(); } }, true);
    addEventListener("click", (e) => { if (swallow && performance.now() - swallow < 900) { swallow = 0; e.preventDefault(); e.stopPropagation(); } }, true);
  }
  /* A narrow window — a phone, a tablet held upright in a split: the sidebar is a drawer that lies
   * over the note (viewer.css, the same width), with a shade beside it that shuts it; a note chosen
   * in it shuts it too. */
  const narrow = window.matchMedia ? window.matchMedia("(max-width: 760px)") : { matches: false, addEventListener() {} };
  const compact = () => narrow.matches;
  const sbScrim = document.createElement("div");
  sbScrim.id = "sb-scrim";
  document.body.appendChild(sbScrim);
  sbScrim.addEventListener("click", () => { if (sidebarOpen()) showSidebar(false, true); });
  sidebar.addEventListener("click", (e) => { if (compact() && e.target.closest(".sb-item:not(.is-dir) > .sb-in > .sb-row") && !e.ctrlKey && !e.metaKey) showSidebar(false, true); });
  narrow.addEventListener("change", () => { if (folder && compact() && sidebarOpen()) showSidebar(false, false); });
  function showSidebar(open, animate) {
    if (sidebarOpen() === !!open && document.body.dataset.sidebar) return;
    const col = mode === "edit" ? editor : mode === "active" ? MdActive.view.el : content;
    const anchor = mode === "edit" ? captureEditAnchor() : captureAnchor();
    const before = col.getBoundingClientRect().left, tabsBefore = tabRow.getBoundingClientRect().left;
    sidebar.classList.toggle("no-anim", !animate);
    document.body.dataset.sidebar = open ? "open" : "closed";
    if (mode === "edit") {
      const el = anchor.line == null ? null : edBack.children[anchor.line];
      if (el) window.scrollBy({ top: el.getBoundingClientRect().top - anchor.top, behavior: "instant" });
    } else if (current) restoreAnchor(anchor);
    const dx = before - col.getBoundingClientRect().left, tdx = tabsBefore - tabRow.getBoundingClientRect().left;
    if (!animate || reducedMotion()) return;
    for (const [el, d] of [[col, dx], [tabRow, tdx]]) {
      if (!d) continue;
      el.style.transition = "none";
      el.style.transform = `translateX(${d}px)`;
      void el.offsetWidth;
      el.style.transition = "";
      el.style.transform = "";
    }
  }

  /* A folder with no note in it: said, and a note offered — the first thing a new folder shows.
   * (The note view and All Notes alike; the button asks for the note's name as the + does.) */
  /* Nothing open at all (the app started by itself, on the desktop): what can be opened — a folder of notes, which the
   * sidebar then shows, or one file. */
  const startState = () => `<div class="empty-state start-state"><div class="empty-icon">${ICON.folder}</div><b>${esc(T("start.title"))}</b><p>${esc(T("start.text"))}</p>` +
    `<div class="start-go"><button class="btn primary" type="button" data-empty="folder">${esc(T("start.folder"))}</button><button class="btn" type="button" data-empty="file">${esc(T("start.file"))}</button></div></div>`;
  const emptyState = () => !folder && !READING && DESKTOP ? startState() : `<div class="empty-state"><div class="empty-icon">${ICON.folder}</div><b>${esc(T("empty.title"))}</b><p>${esc(T("empty.text"))}</p>` +
    (READING || !folder ? "" : `<button class="btn primary" type="button" data-empty="new">${esc(T("new.note"))}</button>`) + `</div>`;
  document.addEventListener("click", (e) => { if (e.target.closest?.('[data-empty="new"]') && folder) { e.preventDefault(); openNewNote(); } });
  document.addEventListener("click", (e) => { const b = e.target.closest?.('[data-empty="folder"], [data-empty="file"]'); if (b) { e.preventDefault(); post(b.dataset.empty === "folder" ? "folder" : "open"); } });

  // --- new note
  /* A new note or folder is asked for in a small window of its own — from the sidebar's +, from All
   * Notes, from a menu, by Ctrl+N: its name, and where it goes. Enter makes it, Esc (or a click
   * beside the window) does not. Among the quick notes the name may be left out: the note is then
   * named after its first line, as ever. */
  let newKind = "note", newDir = null, newDlg = null, newBack = null;
  const newOpen = () => !!newDlg && newDlg.hasAttribute("data-open");
  function buildNewNote() {
    newDlg = document.createElement("div");
    newDlg.id = "newdlg";
    newDlg.innerHTML = `<form class="new-box surface" role="dialog" aria-modal="true" aria-labelledby="new-title" novalidate>` +
      `<div class="new-head"><span class="new-sign" aria-hidden="true"></span><div class="new-words"><b id="new-title"></b><p class="new-where"></p></div></div>` +
      `<input id="new-name" class="sb-field" type="text" spellcheck="false" autocomplete="off">` +
      `<div class="new-foot"><button class="btn" type="button" data-new="cancel">${esc(T("dialog.cancel"))}</button><button class="btn primary" type="submit">${esc(T("new.create"))}</button></div></form>`;
    document.body.appendChild(newDlg);
    const input = newDlg.querySelector("#new-name"), go = newDlg.querySelector(".btn.primary");
    const quick = () => !!(folder && folder.quick) && newKind !== "folder";
    input.addEventListener("input", () => { go.disabled = !input.value.trim() && !quick(); });
    newDlg.addEventListener("mousedown", (e) => { if (e.target === newDlg) { e.preventDefault(); closeNewNote(); } });
    newDlg.addEventListener("click", (e) => { if (e.target.closest('[data-new="cancel"]')) closeNewNote(); });
    newDlg.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeNewNote(); return; }
      if (e.key === "Enter" && !e.isComposing && e.target === input) { e.preventDefault(); newDlg.querySelector("form").requestSubmit(); return; }
      if (e.key !== "Tab") return; // (the keyboard stays in the window)
      const stops = [...newDlg.querySelectorAll("input, button:not(:disabled)")], i = stops.indexOf(document.activeElement);
      e.preventDefault();
      stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
    });
    // (… and no key of the window behind it works through it: Ctrl+E, Ctrl+F, Ctrl+W)
    newDlg.addEventListener("keydown", (e) => { if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) { e.stopPropagation(); if (!/^[acvxz]$/i.test(e.key)) e.preventDefault(); } });
    newDlg.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.trim(), kind = newKind;
      if (!name && !quick()) return;
      // next to the note on screen, if that one lives in this folder
      const here = newDir || (current && current.path.startsWith(folder.root + "/") && !document.body.hasAttribute("data-overview") ? current.path.replace(/\/[^/]*$/, "") : folder.root);
      closeNewNote(false);
      if (kind !== "folder" && window.MdOverview) MdOverview.close(false); // (the new note is opened: not under the tiles)
      if (!name) post("quicknote"); else post(kind === "folder" ? "newfolder" : "newnote", { name, dir: here });
    });
  }
  function openNewNote(kind = "note", dir = null) {
    if (!folder || newOpen()) return;
    if (!newDlg) buildNewNote();
    newKind = kind; newDir = dir;
    const quick = !!folder.quick && kind !== "folder", input = newDlg.querySelector("#new-name");
    const where = dir || (current && current.path.startsWith(folder.root + "/") && !document.body.hasAttribute("data-overview") ? current.path.replace(/\/[^/]*$/, "") : folder.root);
    newDlg.querySelector(".new-sign").innerHTML = kind === "folder" ? ICON.folder : ICON.note;
    newDlg.querySelector("#new-title").textContent = T(kind === "folder" ? "new.folder" : "new.note");
    newDlg.querySelector(".new-where").textContent = quick ? T("new.quickHint") : T("new.in", where === folder.root ? folder.name : where.slice(folder.root.length + 1));
    input.placeholder = kind === "folder" ? "Folder name" : "Note name";
    input.setAttribute("aria-label", kind === "folder" ? "New folder name" : "New note name");
    input.value = "";
    newDlg.querySelector(".btn.primary").disabled = !quick;
    closeCtx(false);
    newBack = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    newDlg.dataset.open = "";
    input.focus({ preventScroll: true });
  }
  function closeNewNote(back = true) {
    if (!newOpen()) return false;
    delete newDlg.dataset.open;
    newDlg.querySelector("#new-name").blur();
    if (back && newBack && newBack.isConnected) newBack.focus({ preventScroll: true });
    newBack = null;
    return true;
  }


  // ------------------------------------------------------------ tabs (folder windows)
  /* A folder window has tabs, as Craft has them: a strip above the note with the notes and PDFs
   * that are open; before them the way to all notes (the house), behind them a new tab (+). The
   * application keeps them (mdview.py, tabs) — the file each one shows, its way back, their
   * order, from one opening of the folder to the next — the page draws the strip and says what
   * was asked for. A click shows a tab; the ✕ that takes its icon's place under the pointer, or
   * the middle button, closes it; it can be pulled to another place. A note opens in a tab of its
   * own with Ctrl or the middle button (sidebar, tiles, links). An empty tab shows all notes.
   * Keys: Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab and Ctrl+Shift+Tab, Ctrl+1 … 9. */
  const tabbar = document.createElement("nav");
  tabbar.id = "tabs";
  tabbar.setAttribute("aria-label", "Tabs");
  // (the sidebar's button stands at the left, where the sidebar is: first in the strip — beside the
  // sidebar's edge while that is open, at the window's while it is closed)
  tabbar.innerHTML = `<div class="tab-row">` +
    `<button class="tab-home tab-side" data-act="sidebar" title="${esc(T("Sidebar (Ctrl+Alt+S)"))}" aria-label="${esc(T("Sidebar"))}">${ICON.sidebar}</button>` +
    `<button class="tab-home" data-act="overview" title="${esc(T("All notes (Ctrl+Alt+G)"))}" aria-label="${esc(T("All notes"))}" aria-pressed="false">${ICON.home}</button>` +
    `<div class="tab-list" role="tablist"></div>` +
    `<button class="tab-new" data-act="newtab" title="${esc(T("New tab (Ctrl+T)"))}" aria-label="${esc(T("New tab"))}">${ICON.plus}</button></div>`;
  document.body.appendChild(tabbar);
  const tabRow = tabbar.firstChild, tabList = tabbar.querySelector(".tab-list");
  let tabs = [], tabActive = null, tabShown = null, tabClosed = false; // tabActive: the one marked (at once, on a click); tabShown: the one the application says is shown
  const tabsOn = () => document.body.hasAttribute("data-tabs");
  const topRoom = () => (tabsOn() ? tabbar.offsetHeight : 0); // what of the window's top the strip takes
  const tabEls = () => [...tabList.children].filter((el) => el.classList.contains("tab") && !el.classList.contains("leaving"));
  /* The plate under the tab one is on: it lies in the tabs' track (its last child, always) and glides to the tab chosen.
   * It follows by watching the list — which tab is marked, how many there are, how wide they got — and is out of the way
   * while a tab is pulled (that one carries its own). */
  const tabPlate = document.createElement("i");
  tabPlate.className = "tab-plate";
  tabPlate.setAttribute("aria-hidden", "true");
  tabList.appendChild(tabPlate);
  let plateFrame = 0, plateSet = false;
  function placePlate() {
    plateFrame = 0;
    const on = tabList.querySelector('.tab[aria-selected="true"]:not(.leaving)'), pulled = !!tabList.querySelector(".tab.pulled, .tab.landing");
    tabList.toggleAttribute("data-none", !tabEls().length);
    if (!on || pulled || !on.offsetWidth) { tabPlate.style.opacity = "0"; plateSet = false; return; }
    if (!plateSet) tabPlate.style.transition = "none"; // (it appears where it belongs: it does not come gliding from the corner)
    tabPlate.style.width = on.offsetWidth + "px";
    tabPlate.style.transform = `translateX(${on.offsetLeft}px)`;
    tabPlate.style.opacity = "";
    if (!plateSet) { void tabPlate.offsetWidth; tabPlate.style.transition = ""; plateSet = true; }
  }
  const plateSoon = () => { if (!plateFrame) plateFrame = requestAnimationFrame(placePlate); };
  new MutationObserver(plateSoon).observe(tabList, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "class"] });
  if (window.ResizeObserver) new ResizeObserver(plateSoon).observe(tabList);
  addEventListener("resize", plateSoon);
  function tabLabel(t) {
    if (!t.path) return T("All Notes");
    let title = "";
    if (sbTitles && folder) { // as the sidebar names it
      const find = (dir) => dir.notes.find((n) => n.real === t.path) || dir.dirs.reduce((hit, d) => hit || find(d), null);
      title = find(folder.tree)?.title || "";
    }
    return title || t.name.replace(/\.(md|markdown|mdown|mkd|mkdn|mdx|pdf)$/i, "");
  }
  function paintTab(el, t) {
    const label = tabLabel(t), text = el.lastChild;
    if (el.dataset.path !== (t.path || "")) {
      el.dataset.path = t.path || "";
      el.firstChild.innerHTML = t.path ? rowIcon(t.path) : ICON.apps;
      if (t.path) el.dataset.tip = folder && t.path.startsWith(folder.root + "/") ? t.path.slice(folder.root.length + 1) : t.path; else delete el.dataset.tip;
    }
    if (text.textContent !== label) {
      const had = text.textContent;
      text.textContent = label;
      if (had && text.animate) text.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionMs("--dur-fast", 160), easing: "ease-out" }); // (another note in the tab: its name fades in)
    }
  }
  function markTabs() {
    for (const el of tabEls()) {
      const on = Number(el.dataset.id) === tabActive;
      el.setAttribute("aria-selected", String(on));
      el.tabIndex = on ? 0 : -1;
    }
  }
  // tabs that stand elsewhere than before glide there (stood: where each one was, by element)
  function tabGlide(stood) {
    const moved = [];
    for (const [el, left] of stood) {
      if (!el.isConnected || el.classList.contains("leaving")) continue;
      el.style.transition = "none";
      el.style.transform = "";
      const dx = left - el.getBoundingClientRect().left;
      if (Math.abs(dx) > 1 && !reducedMotion()) { el.style.transform = `translateX(${dx}px)`; moved.push(el); } else el.style.transition = "";
    }
    if (!moved.length) return;
    void tabList.offsetWidth;
    for (const el of moved) { el.style.transition = ""; el.style.transform = ""; }
  }
  function setTabs(d) {
    const first = !tabsOn();
    if (first) { document.body.dataset.tabs = ""; document.documentElement.style.setProperty("--top", tabbar.offsetHeight + "px"); showToolbar(true); }
    const stood = new Map(), have = new Map(), fresh = [];
    for (const el of tabEls()) { stood.set(el, el.getBoundingClientRect().left); have.set(el.dataset.id, el); }
    const box = tabList.getBoundingClientRect();
    let prev = null;
    for (const t of d.tabs) {
      let el = have.get(String(t.id));
      if (el) have.delete(String(t.id));
      else {
        el = document.createElement("div");
        el.className = "tab";
        el.setAttribute("role", "tab");
        el.dataset.id = t.id;
        el.innerHTML = `<span class="tab-icon"></span><button class="tab-x" type="button" tabindex="-1" aria-label="${esc(T("Close tab"))}" data-tip="Close tab (${keys("Ctrl+W")})">${ICON.x}</button><span class="tab-label"></span>`;
        if (!first) { el.classList.add("enter"); fresh.push(el); }
      }
      const at = prev ? prev.nextSibling : tabList.firstChild;
      if (at !== el) tabList.insertBefore(el, at);
      prev = el;
      paintTab(el, t);
    }
    for (const el of have.values()) { // a closed one fades where it stood, out of the others' way
      const r = el.getBoundingClientRect();
      el.style.left = r.left - box.left + "px";
      el.style.width = r.width + "px";
      el.style.transform = "";
      el.classList.add("leaving");
      setTimeout(() => el.remove(), motionMs("--dur-base", 240));
    }
    const was = tabShown, wasPath = tabs.find((t) => t.id === was)?.path;
    tabs = d.tabs; tabActive = tabShown = d.active; tabClosed = !!d.closed;
    markTabs();
    tabGlide(stood);
    if (fresh.length) { void tabList.offsetWidth; fresh.forEach((el) => el.classList.remove("enter")); }
    // an empty tab shows all notes; a tab come to shows its note, not the tiles
    const now = tabs.find((t) => t.id === tabShown);
    if (window.MdOverview && now) {
      if (!now.path && (was !== tabShown || wasPath)) MdOverview.open();
      else if (now.path && was !== tabShown) MdOverview.close(false);
    }
  }
  function selectTab(id) {
    const t = tabs.find((x) => x.id === id);
    // the tab of the note that lies under all notes: back to the note
    if (t && id === tabActive && t.path && window.MdOverview && MdOverview.isOpen) { MdOverview.close(); return; }
    if (!t || id === tabActive) return;
    tabActive = id; // marked at once; the application answers with the tabs as they then are
    markTabs();
    if (t.path) going(t.path);
    post("tab", { op: "select", id });
  }
  const closeTab = (id) => post("tab", { op: "close", id });
  // pulled sideways, a tab goes along and the others make room; let go, it lands in the gap
  function pullTab(el, e) {
    const x0 = e.clientX;
    let els = null, from = -1, to = -1, step = 0, min = 0, max = 0;
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!els) {
        const all = tabEls();
        if (Math.abs(dx) < 4 || all.length < 2) return;
        els = all; from = to = els.indexOf(el);
        const r = el.getBoundingClientRect(), a = els[0].getBoundingClientRect(), z = els[els.length - 1].getBoundingClientRect();
        step = els[1].getBoundingClientRect().left - a.left;
        min = a.left - r.left; max = z.right - r.right;
        el.classList.add("pulled");
        hideTip();
      }
      const d = Math.max(min, Math.min(max, dx));
      el.style.transform = `translateX(${d}px)`;
      to = Math.max(0, Math.min(els.length - 1, from + Math.round(d / step)));
      els.forEach((t, i) => {
        if (t === el) return;
        const s = i > from && i <= to ? -step : i < from && i >= to ? step : 0;
        t.style.transform = s ? `translateX(${s}px)` : "";
      });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (!els) return;
      const stood = new Map(els.map((t) => [t, t.getBoundingClientRect().left + (t.getBoundingClientRect().width - t.offsetWidth) / 2]));
      el.classList.remove("pulled");
      if (to !== from) {
        tabList.insertBefore(el, to > from ? els[to].nextSibling : els[to]);
        const t = tabs.splice(from, 1)[0];
        tabs.splice(to, 0, t);
        post("tab", { op: "move", id: Number(el.dataset.id), to });
      }
      el.classList.add("landing");
      setTimeout(() => el.classList.remove("landing"), motionMs("--spring-snappy-dur", 560));
      tabGlide(stood);
    };
    try { el.setPointerCapture(e.pointerId); } catch (_e) { /* (a pointer that is gone) */ }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
  tabList.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".tab");
    if (!el || el.classList.contains("leaving") || e.target.closest(".tab-x")) return;
    if (e.button === 1) { e.preventDefault(); return; } // (the middle button closes, on its click)
    if (e.button !== 0) return;
    selectTab(Number(el.dataset.id));
    pullTab(el, e);
  });
  tabList.addEventListener("click", (e) => {
    const x = e.target.closest(".tab-x");
    if (x) closeTab(Number(x.parentNode.dataset.id));
  });
  tabList.addEventListener("auxclick", (e) => {
    const el = e.target.closest(".tab");
    if (el && e.button === 1) { e.preventDefault(); closeTab(Number(el.dataset.id)); }
  });
  tabbar.addEventListener("dblclick", (e) => { if (!e.target.closest(".tab, button")) post("tab", { op: "new" }); }); // (the empty room of the strip)
  tabbar.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const el = e.target.closest(".tab");
    if (el && !el.classList.contains("leaving")) openCtx(el, e.clientX, e.clientY, "tab");
  });
  tabList.addEventListener("keydown", (e) => {
    const el = e.target.closest(".tab");
    if (!el || e.ctrlKey || e.metaKey || e.altKey) return;
    const els = tabEls(), i = els.indexOf(el);
    const next = e.key === "ArrowRight" ? els[i + 1] : e.key === "ArrowLeft" ? els[i - 1] : e.key === "Home" ? els[0] : e.key === "End" ? els[els.length - 1] : null;
    if (next) { e.preventDefault(); selectTab(Number(next.dataset.id)); next.focus({ preventScroll: true }); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); closeTab(Number(el.dataset.id)); }
  });
  /* The keys, before any part of the page sees them (Ctrl+Tab is the text's in no editor here).
   * Not under a dialog: what it holds belongs to the note on screen. */
  addEventListener("keydown", (e) => {
    if (!tabsOn() || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (locks > (document.body.hasAttribute("data-overview") ? 1 : 0)) return;
    const k = e.key.toLowerCase(), i = tabs.findIndex((t) => t.id === tabActive), n = tabs.length;
    let run = null;
    if (e.key === "Tab" || (!e.shiftKey && (e.key === "PageDown" || e.key === "PageUp"))) {
      const back = e.key === "Tab" ? e.shiftKey : e.key === "PageUp";
      run = () => { if (n > 1) selectTab(tabs[(i + (back ? n - 1 : 1)) % n].id); };
    } else if (k === "t") run = () => post("tab", { op: e.shiftKey ? "reopen" : "new" });
    else if (!e.shiftKey && k === "w") run = () => post("tab", { op: "close" });
    else if (!e.shiftKey && /^Digit[1-9]$/.test(e.code)) run = () => { const t = e.code === "Digit9" ? tabs[n - 1] : tabs[e.code.slice(5) - 1]; if (t) selectTab(t.id); }; // (9: the last, as in a browser)
    if (!run) return;
    e.preventDefault(); e.stopImmediatePropagation();
    run();
  }, true);
  // the room the toolbar takes at the strip's right end
  if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty("--tb-w", toolbar.offsetWidth + "px")).observe(toolbar);

  // --- toolbar + find buttons
  const actions = {
    outline: () => (outlineOpen() ? closeOutline() : openOutline()),
    find: () => (findOpen() ? closeFind() : openFind()),
    share: () => { if (current && current.kind !== "pdf" && !current.error) openShare(); else toast(T("Only notes can be shared")); },
    edit: () => switchMode(mode === "edit" ? "read" : "edit"),
    mode: (b) => switchMode(b.dataset.mode),
    sidebar: () => { if (folder) { showSidebar(!sidebarOpen(), true); if (!compact()) post("sidebar", { visible: sidebarOpen() }); } }, // (a drawer opened or shut on a phone is not how the sidebar is kept)
    overview: () => { if (folder && window.MdOverview) MdOverview.open(); }, // (the house: always to all notes — back to the note by its tab, or Esc)
    // the panel at the right — what can be put in, and the formats (active/panel.js). It belongs to the
    // active mode: in the others its button is dimmed and does nothing
    panel: () => { if (mode === "active" && window.MdActive && MdActive.panel) MdActive.panel.toggle(); }, // all notes of the folder as tiles (overview.js)
    titles: () => setTitles(!sbTitles),
    newnote: () => openNewNote(),
    newmenu: () => { // the + button: a note or a folder — among the quick notes a new one
      if (folder && folder.quick) return openNewNote();
      const b = sidebar.querySelector('[data-act="newmenu"]'), r = b.getBoundingClientRect();
      if (ctxOpen() && ctxKind === "new") { closeCtx(false); return; }
      openCtx(b, r.right, r.bottom + 4, "new");
    },
    // Sync Now: what is typed is saved first; the application keeps what waits and brings the two sides in line
    syncnow: () => {
      const b = sbHead.querySelector(".sb-sync");
      flush(false);
      post("sync-now");
      b.classList.remove("turning"); void b.offsetWidth; b.classList.add("turning"); // (it turns once: asked for)
      toast(T("Syncing…"));
    },
    historymenu: () => { // the clock: the folder's history, switched on or said to be
      const r = sbHistoryBtn.getBoundingClientRect();
      if (ctxOpen() && ctxKind === "history") { closeCtx(false); return; }
      openCtx(sbHistoryBtn, r.right, r.bottom + 4, "history");
    },
    folder: () => post("folder"),
    notefolder: () => post("folder", { here: true }),
    newtab: () => post("tab", { op: "new" }),
    prev: () => focusHit(hitIdx - 1),
    next: () => focusHit(hitIdx + 1),
    closefind: () => closeFind(),
  };
  // the panel's button leaves the focus where it is (in the text one goes on typing in)
  toolbar.addEventListener("mousedown", (e) => { if (e.target.closest('[data-act="panel"]')) e.preventDefault(); });
  for (const root of [toolbar, findBar, sbHead, tabbar]) {
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (b) actions[b.dataset.act](b);
    });
  }

  // click outside the outline closes it and is swallowed (macOS popover behaviour)
  let swallowClick = false;
  addEventListener("pointerdown", (e) => {
    if (ctxOpen() && ctxSub.contains(e.target)) return;
    if (ctxOpen() && !ctx.contains(e.target)) {
      closeCtx(false);
      if (e.button !== 0) return; // a right click goes on to open the next menu
    } else if (!outlineOpen() || outlinePop.contains(e.target) || e.target.closest('[data-act="outline"]')) return;
    else closeOutline();
    swallowClick = e.button === 0;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  addEventListener("click", (e) => {
    if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); }
  }, true);

  document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".page-row") && !e.target.closest('.pm[contenteditable="true"]')) { e.preventDefault(); e.target.click(); } });
  // a link to a note followed: in a tab of its own (the note it stands in stays open); a heading of this note: there
  const followWiki = (target) => { if (String(target).startsWith("#")) scrollToFragment(String(target).slice(1), true); else post("wikilink", { target, tab: "own" }); };
  // --- content clicks: links, tasks, copy
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    const row = e.target.closest(".page-row");
    if (row && row.dataset.wiki != null) { // a link to a note, a block of its own (in text that is being edited: its block's own click, islands.js)
      if (!row.closest('.pm[contenteditable="true"]')) followWiki(row.dataset.wiki);
      return;
    }
    if (row && !row.closest(".pm") && !row.closest(".transclusion")) { pageOpen(row.dataset.page); return; } // (in the active mode: its block's own click, islands.js)
    const box = e.target.closest("input.task");
    if (box && box.dataset.prop != null) { // a property, true or false: written into the note at once
      if (box.closest(".pm")) { if (!(window.MdActive && MdActive.islands.propClicked(box))) e.preventDefault(); return; } // (in the active mode: written into its properties)
      const text = current && !current.readonly && !current.error && current.kind !== "pdf" && mode === "read" ? toggleProp(current.raw != null ? current.raw : current.text, box.dataset.prop, box.checked) : null;
      if (text == null) { e.preventDefault(); return; }
      current.raw = text;
      current.text = text.replace(/\r\n?/g, "\n");
      post("save", { text, path: current.path, exact: true, seq: ++saveSeq });
      return;
    }
    if (box) {
      // (in the text that is being edited a box is the editor's own — edit.js; one that stands in a
      // block of HTML there has a line number from when the note was read: nothing is ticked by it)
      if (box.closest('.pm[contenteditable="true"] .isl')) { e.preventDefault(); return; }
      if (box.disabled || box.dataset.line == null) { e.preventDefault(); return; }
      box.closest("li")?.classList.toggle("is-checked", box.checked);
      const shown = viewOf(current), line = Number(box.dataset.line);
      post("toggle", { line: shown && shown.pageOf ? pageFileLine(shown.root, shown.page, line) : line, checked: box.checked }); // (a page's line: the file's)
      return;
    }
    // code put away behind its card: shown in a window of its own (while it is edited, its dialog is that window)
    const card = e.target.closest(".code-card");
    if (card && !card.closest(".pm")) { openCode(card.closest(".code-block")); return; }
    if (e.target.closest("[data-codeview-close]") || e.target === codeBox) { closeCode(); return; }
    const copy = e.target.closest(".code-copy");
    if (copy) {
      post("copy", { text: copy.closest(".code-block").querySelector("code").textContent });
      copy.textContent = T("Copied");
      copy.classList.add("done");
      setTimeout(() => { copy.textContent = T("Copy"); copy.classList.remove("done"); }, 1400);
      return;
    }
    // A PDF embedded in the note is a picture: a double click shows it large, like any picture. To
    // the PDF itself it is Ctrl+click, or Go to PDF in its menu.
    // a whiteboard: opened (in the active mode: its block's own click, edit.js)
    const bi = e.target.closest(".board-block")?.querySelector("img") || (e.target.tagName === "IMG" ? e.target : null);
    if (bi && isBoardImg(bi) && !bi.closest(".pm") && shownRoot().contains(bi)) { e.preventDefault(); openBoard(bi); return; }
    const pe = e.target.closest(".pdf-embed[data-wiki]");
    if (pe && shownRoot().contains(pe)) { if (e.ctrlKey || e.metaKey) post("wikilink", { target: pe.dataset.wiki, tab: "own" }); return; }
    const a = e.target.closest("a");
    if (!a || !shownRoot().contains(a)) return;
    e.preventDefault();
    // In text that is being edited a click follows the link too (it is changed from the menu of a
    // right click: Edit Link…). Not with Alt held, which only places the caret in it, and not at
    // the end of a selection pulled over it.
    if (mode === "active" && MdActive.view.editable && !a.closest(".isl") && (e.altKey || !getSelection().isCollapsed)) return;
    if (mode === "active" && window.MdActive && MdActive.link) MdActive.link.close(); // (the small window under the link the caret came to rest in: not over the way out)
    // (another note or a PDF: in a tab of its own — the one it has already, else a new one — so the note the link stands in stays open; tab: "own")
    if (a.dataset.wiki != null) { post("wikilink", { target: a.dataset.wiki, tab: "own" }); return; }
    const href = a.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#")) { scrollToFragment(href.slice(1), true); return; }
    post("link", { href: a.href, tab: "own" });
  });
  document.addEventListener("auxclick", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    // the middle button on a link to a note or a PDF: in a tab of its own (not in text that is being edited: there it pastes)
    if (e.button !== 1 || !tabsOn() || !shownRoot().contains(a) || (mode === "active" && MdActive.view.editable && !a.closest(".isl"))) return;
    const href = a.getAttribute("href");
    if (a.dataset.wiki != null) post("wikilink", { target: a.dataset.wiki, tab: true });
    else if (href && !href.startsWith("#")) post("link", { href: a.href, tab: true });
  });
  addEventListener("mouseup", (e) => {
    if (e.button === 3) post("back");
    else if (e.button === 4) post("forward");
  });

  /* --- A note larger and smaller: Ctrl or Super with + and −, Ctrl+0 for its own size. Only the
   * note's text is scaled (the settings' docZoom, in percent) — the toolbar, the sidebar, menus and
   * dialogs keep their size. A PDF on screen has these keys for its pages (pdfview.js). Taken
   * before any part of the page sees them, so they work with the caret in the text too. */
  const DOC_ZOOMS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250];
  const docZoom = () => (DOC_ZOOMS.includes(window.MdPrefs?.docZoom) ? MdPrefs.docZoom : 100);
  function setDocZoom(z) {
    if (z === docZoom()) { toast(z + " %"); return; }
    window.MdPrefs = { ...(window.MdPrefs || {}), docZoom: z };
    post("prefs", { prefs: { docZoom: z } });
    prefsChanged();
    toast(z + " %");
  }
  addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const up = e.key === "+" || e.key === "=" || e.code === "NumpadAdd", down = e.key === "-" || e.key === "_" || e.code === "NumpadSubtract";
    const reset = !e.shiftKey && (e.key === "0" || e.code === "Numpad0");
    if (!up && !down && !reset) return;
    if (window.MdPdf && MdPdf.shown && MdPdf.shown.root.isConnected) return; // (the PDF's own)
    if (window.MdBoard && MdBoard.shown) return; // (the whiteboard's own)
    e.preventDefault(); e.stopPropagation();
    const i = DOC_ZOOMS.indexOf(docZoom());
    setDocZoom(reset ? 100 : DOC_ZOOMS[Math.max(0, Math.min(DOC_ZOOMS.length - 1, i + (up ? 1 : -1)))]);
  }, true);

  // --- keyboard
  addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const typing = e.target.matches?.("input[type=search], input[type=text], textarea") || e.target.isContentEditable;
    if (e.key === "Escape") {
      if (closeCtx(true) || closeNewNote() || closeOutline() || closeFind()) e.preventDefault();
      return;
    }
    if (mod && e.shiftKey && k === "o") { e.preventDefault(); actions.outline(); return; }
    if (mod && e.shiftKey && k === "e") { e.preventDefault(); post("external"); return; }
    if (mod && e.altKey && !e.shiftKey && k === "s") { e.preventDefault(); actions.sidebar(); return; }
    if (mod && e.altKey && !e.shiftKey && k === "g") { e.preventDefault(); if (folder && window.MdOverview) MdOverview.toggle(); return; } // (the key goes there and back)
    if (mod && e.altKey && !e.shiftKey && k === "h") { e.preventDefault(); openHistory(); return; }
    if (mod && e.altKey && !e.shiftKey && k === "p") { e.preventDefault(); actions.panel(); return; }
    if (mod && e.altKey && !e.shiftKey && k === "o") { e.preventDefault(); post("folder"); return; }
    if (mod && e.altKey && !e.shiftKey && /^Digit[123]$/.test(e.code)) { e.preventDefault(); switchMode(MODES[e.code.slice(5) - 1]); return; }
    if (mod && !e.shiftKey && !e.altKey && k === "v") {
      // reading: an image on the clipboard goes to the end of the note
      if (!typing && mode === "read" && current && !current.error && !(window.MdHost && window.MdHost.drop)) post("pasteimage", { path: current.path, append: true }); // (a host that takes files: the paste event, above)
      return;
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const map = {
        f: openFind, e: actions.edit, o: () => post("open"), r: () => post("reload"),
        // (saved — and, in a folder with a history, kept as a version at once and sent to its
        // repository, without waiting for the quiet while)
        s: () => { if (mode !== "read") { flushSave(); toast(T("Saved")); } post("history-now"); },
        n: () => { if (folder) openNewNote(); },
        ",": openSettings,
        p: printDoc, w: () => post("close"), q: () => post("close"), // (Ctrl+W in a window with tabs: the tab, see there)
        g: () => focusHit(hitIdx + 1),
      };
      if (map[k]) { e.preventDefault(); map[k](); }
      return;
    }
    if (mod && e.shiftKey && k === "g") { e.preventDefault(); focusHit(hitIdx - 1); return; }
    // (among the pages of the note first; then among the notes)
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); if (!pageStep(-1)) post("back"); return; }
    if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); if (!pageStep(1)) post("forward"); return; }
    if (!typing && !mod && !e.altKey && e.key === "/") { e.preventDefault(); openFind(); }
  });

  // open a link as a click on it would: another note here, anything else outside
  function follow(href) {
    if (href.startsWith("#")) { scrollToFragment(href.slice(1), true); return; }
    post("link", { href: new URL(href, document.baseURI).href, tab: "own" });
  }
  // Ctrl held: links in the active mode show that a click follows them
  for (const type of ["keydown", "keyup", "blur"]) {
    addEventListener(type, (e) => document.body.classList.toggle("mod-down", type !== "blur" && (e.ctrlKey || e.metaKey)));
  }

  // Ctrl+Shift+V in the active mode: the clipboard's text, handed over by the application
  // Paste from the context menu: the application hands over what the page may not read itself
  function pasteClip(r) {
    if (mode === "active" && window.MdActive?.view?.editable) MdActive.clip.pasteFrom(MdActive.view.pm, r.text, r.html);
  }
  // the settings changed (here or in another window)
  function setPrefs(p) {
    window.MdPrefs = p;
    prefsChanged();
    if (window.MdActive?.onPrefs) MdActive.onPrefs();
  }
  // a dialog over the note: the note holds still (counted: one may open over another)
  // Not by a style on the page (taking its scrollbar away lays a long note out anew, 150 ms each
  // way): the place is kept, and whatever moves the page — a wheel beside the dialog, a key, a
  // touchpad still gliding — is put back at once.
  let locks = 0, lockX = 0, lockY = 0;
  const holdPlace = () => { if (scrollY !== lockY || scrollX !== lockX) scrollTo({ left: lockX, top: lockY, behavior: "instant" }); };
  function lockScroll(on) {
    const was = locks;
    locks = Math.max(0, locks + (on ? 1 : -1));
    if (!was && locks) { lockX = scrollX; lockY = scrollY; addEventListener("scroll", holdPlace, { passive: true }); }
    else if (was && !locks) removeEventListener("scroll", holdPlace);
  }
  // what of the page follows the settings: the order of the notes, the width of the text column
  const MEASURES = { narrow: "38rem", normal: "46rem", wide: "58rem", full: "none" };
  let sortedBy = "opened", measured = "normal", zoomed = 100, listedAs = "";
  // ---------------------------------------------------------------- AI (ai.js, loaded when it is first asked for)
  /* Claude, asked through the claude command on this computer: to work on blocks of the note (Transform with AI, the menus of a
   * right click), and to talk about the whole note (the bubble at the lower right). The desktop only — and nowhere at all,
   * in no menu, once it is turned off in the settings. */
  const aiOn = () => DESKTOP && !READING && (window.MdPrefs || {}).aiOn !== false;
  let aiLoad = null;
  const loadAi = () => aiLoad || (aiLoad = new Promise((resolve, reject) => {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = `${ASSETS}/ai.css`;
    document.head.appendChild(l);
    const s = document.createElement("script");
    s.nonce = NONCE; s.src = `${ASSETS}/ai.js`; s.onload = () => resolve(window.MdAi); s.onerror = () => { aiLoad = null; reject(new Error("ai.js missing")); };
    document.head.appendChild(s);
  }));
  const aiBubble = document.createElement("button");
  aiBubble.id = "ai-bubble"; aiBubble.type = "button";
  aiBubble.title = T("ai.chat"); aiBubble.setAttribute("aria-label", T("ai.chat"));
  aiBubble.innerHTML = SVG_ICON.spark;
  aiBubble.addEventListener("click", () => loadAi().then((ai) => ai.chat.toggle()).catch(() => {}));
  document.body.appendChild(aiBubble);
  const aiShown = () => { document.body.toggleAttribute("data-ai", aiOn()); if (!aiOn() && window.MdAi) window.MdAi.off(); };
  aiShown();
  // (the note as it is written now, whatever the mode; and Markdown as the page shows it, for what Claude answers)
  const noteText = () => (mode === "active" && window.MdActive?.view?.pm ? MdActive.view.serialize(false) : mode === "edit" ? edInput.value : current ? current.text || "" : "");
  /* The note's whole text as its file has it (what is typed is in it first). */
  function aiFileText() {
    if (mode === "active" && window.MdActive && MdActive.view.pm && MdActive.view.dirty) { leaving = true; flushSave(); leaving = false; }
    return mode === "edit" ? edInput.value : current ? current.text || "" : "";
  }
  /* … and that text put anew (the active mode): shown, kept, and one step of the note's history — back with Ctrl+Z, or
   * undoFileText. The page on screen stays the page on screen. → whether it was done */
  function aiSetFileText(text) {
    if (mode !== "active" || !current || current.readonly || current.kind === "pdf" || !window.MdActive) return false;
    const before = aiFileText();
    text = String(text).replace(/\r\n?/g, "\n");
    if (text === before) return false;
    trailRedo = [];
    trailPush(current.path, before);
    trailPush(current.path, text);
    // (whoever had the keys keeps them: a field of the chat, the page's name being typed)
    const had = document.activeElement, named = !!(had && had.matches && had.matches(".pb-title")), sel = named ? [had.selectionStart, had.selectionEnd] : null;
    trailShow(text);
    trailFloor = trail.at;
    const back = named ? pagebar.querySelector(".pb-title") : had && had !== document.body && had.isConnected && !MdActive.view.dom.contains(had) ? had : null;
    if (back && back !== document.activeElement) { back.focus({ preventScroll: true }); if (sel) { try { back.setSelectionRange(sel[0], sel[1]); } catch (e) { /* (as it stands) */ } } }
    return true;
  }
  /* The folder's notes, for what the chat may be given to read: { path, name, dir }. */
  function folderNotes() {
    const out = [];
    const walk = (d, dir) => {
      for (const n of d.notes) out.push({ path: n.real || n.path, name: String(n.title || n.name || "").replace(/\.(md|markdown)$/i, ""), dir });
      for (const x of d.dirs) walk(x, dir ? dir + "/" + x.name : x.name);
    };
    if (folder) walk(folder.tree, "");
    return out;
  }
  // (an <svg> written bare, not in a fence, is put in one: as plain HTML among Markdown its empty lines would tear it apart)
  const fenceSvg = (text) => String(text).split(/(^```[\s\S]*?^```[^\n]*$)/m).map((part, i) => (i % 2 ? part : part.replace(/^[ \t]*(<svg[\s>][\s\S]*?<\/svg>)[ \t]*$/gim, (_m, svg) => "\n```svg\n" + svg.trim() + "\n```\n"))).join("");
  /* Markdown as the reading view shows it, into el (what Claude wrote): formulas, pictures of svg fences, and diagrams, which are drawn a moment later. */
  const drawDiagrams = (root) => { if (root.querySelector("pre.mermaid")) renderMermaid(generation, null, root).catch(() => {}); };
  function mdInto(el, text, diagrams = true) {
    el.innerHTML = mdHtml(fenceSvg(text));
    if (diagrams) drawDiagrams(el);
  }
  const mdHtml = (text) => md.render(stripComments(String(text)), { links: {}, outline: [], depth: 1, lineOffset: 0 });
  function prefsChanged() {
    aiShown();
    if (docZoom() !== zoomed) {
      // (what was at the top of the window stays there: the place is kept as a share of the page's height)
      const share = document.documentElement.scrollHeight > innerHeight ? scrollY / document.documentElement.scrollHeight : 0;
      zoomed = docZoom();
      if (zoomed === 100) document.documentElement.style.removeProperty("--doc-zoom"); else document.documentElement.style.setProperty("--doc-zoom", String(zoomed / 100));
      scrollTo({ top: share * document.documentElement.scrollHeight, behavior: "instant" });
      window.dispatchEvent(new Event("resize"));
    }
    document.documentElement.toggleAttribute("data-props-off", window.MdPrefs?.props === false); // (properties put away: viewer.css)
    const sort = sortKey(), measure = MEASURES[window.MdPrefs?.measure] ? MdPrefs.measure : "normal";
    // what the sidebar or All Notes lists beside the notes: each shows its part anew (the application
    // sends the folder again only where what both want together changed)
    const lists = ["sidebar", "ov"].map((w) => GROUPS.map(([g]) => (groupOn(w, g) ? 1 : 0)).join("")).join("/");
    if (lists !== listedAs) { listedAs = lists; if (folder && folder.all) { folder.tree = folder.all; folder.visible = document.body.dataset.sidebar === "open"; applyFolder(folder, true); markShared(); } }
    if (sort !== sortedBy) { sortedBy = sort; resort(); }
    if (folder && sidebar.dataset.layout !== sbLayout()) syncList(false); // (the sidebar laid out another way)
    if (measure !== measured) {
      measured = measure;
      if (measure === "normal") document.documentElement.style.removeProperty("--measure"); else document.documentElement.style.setProperty("--measure", MEASURES[measure]);
      window.dispatchEvent(new Event("resize")); // (what fits itself to the column's width does so again)
    }
  }
  // pictures dropped on the document, saved or found by the application
  function insertDropped(r) {
    if (mode === "active" && current && current.path === r.path) MdActive.clip.insertDropped(MdActive.view.pm, r.markups);
  }
  // files the application put back beside the note (a removal undone): their pictures are loaded anew
  function filesBack(names) {
    for (const img of document.querySelectorAll("#active img, #content img")) {
      let src = img.getAttribute("src") || "";
      try { src = decodeURIComponent(src); } catch (e) { /* (as it is) */ }
      if (!names.some((n) => src.split(/[?#]/)[0].endsWith(n))) continue;
      const u = img.src.split("#")[0].split("?")[0];
      img.src = u + "?" + Date.now();
    }
  }
  function pasteText(r) {
    if (mode === "active" && window.MdActive?.view?.editable && typeof r.text === "string") MdActive.clip.insertPlain(MdActive.view.pm, r.text);
  }
  /* Tooltips of the app's own (after 700 ms, in the app's look) for everything that has a
   * title: the title moves to data-tip, so the browser's tooltip never shows. */
  const tipEl = document.createElement("div");
  tipEl.id = "apptip";
  tipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tipEl);
  let tipTimer = 0, tipFor = null, tipWarm = 0;
  const hideTip = () => { clearTimeout(tipTimer); tipFor = null; delete tipEl.dataset.open; };
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest?.("[title], [data-tip]");
    if (t && t.hasAttribute("title")) { const v = t.getAttribute("title"); t.removeAttribute("title"); if (v) t.dataset.tip = v; } // (a title set anew is what is so now: it takes the place of the one before)
    const el = t && t.dataset.tip && !t.closest("#fmtbar, #linkpop") ? t : null; // (the active mode's own have their own)
    if (el === tipFor) return;
    hideTip();
    if (!el) return;
    tipFor = el;
    tipTimer = setTimeout(() => {
      if (!el.isConnected || tipFor !== el) return;
      tipEl.textContent = el.dataset.tip;
      const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      const below = r.bottom + 6 + h <= innerHeight - 8;
      tipEl.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + "px";
      tipEl.style.top = (below ? r.bottom + 6 : r.top - 6 - h) + "px";
      tipEl.dataset.open = "";
      tipWarm = Date.now();
    }, Date.now() - tipWarm < 1000 ? 0 : 700); // moving on from one tooltip to the next: at once
  });
  document.addEventListener("mousedown", hideTip, true);
  document.addEventListener("keydown", hideTip, true);
  window.addEventListener("blur", hideTip);
  prefsChanged(); // (a new window: the settings it was given — the note's size, the column's width)
  // a whiteboard's file changed on the disk (the shell says so): where the note shows it, its picture is made anew
  const boardChanged = (path) => { const name = String(path).split("/").pop(); if ([...document.querySelectorAll("#content img, #active img")].some((i) => (i.dataset.board || decodeURIComponent(i.src)).endsWith(name))) loadBoard().then(() => window.MdBoard.fileChanged(String(path))).catch(() => {}); };
  // (the application is told which whiteboards the note shows, so that it looks at their folders: the desktop only — a browser has no files)
  if (DESKTOP) {
    let told = "", telling = 0;
    const tell = () => {
      const base = String((window.MdHost || {}).files || "");
      const paths = [...new Set([...document.querySelectorAll("#content .board-block img, #active .board-block img")].map((i) => { const src = String(i.dataset.board || "") || (i.src.startsWith(base + "/") ? decodeURIComponent(i.src.slice(base.length).split(/[?#]/)[0]).replace(/^\/(?=[A-Za-z]:[\\/])/, "") : ""); return src; }).filter(Boolean))].sort();
      if (paths.join("\n") !== told) { told = paths.join("\n"); post("board-watch", { paths }); }
    };
    new MutationObserver(() => { clearTimeout(telling); telling = setTimeout(tell, 300); }).observe(document.body, { childList: true, subtree: true });
  }
  window.MdView = { filesBack, boardChanged, aiDelta: (id, text) => window.MdAi && MdAi.delta(id, text), aiDone: (id, text, error) => window.MdAi && MdAi.done(id, text, error), aiPicked: (list) => window.MdAi && MdAi.picked(list), pinch: (phase, scale) => (window.MdBoard && MdBoard.shown ? MdBoard.pinch(phase, scale) : window.MdPdf && MdPdf.pinch && MdPdf.pinch(phase, scale)), boardMade, boardText: (id, text, error) => window.MdBoard && MdBoard.answer(id, text, error), boardSaved: (id, error) => window.MdBoard && MdBoard.answer(id, error), boardPut: (id, names, error) => window.MdBoard && MdBoard.answer(id, names, error), prefsChanged, settingsInfo: (d) => window.MdActive && MdActive.prefs && MdActive.prefs.info(d), historyKept: () => window.MdActive && MdActive.prefs && MdActive.prefs.stale(), history: (d) => window.MdActive && MdActive.history && MdActive.history.got(d), historyText: (d) => window.MdActive && MdActive.history && MdActive.history.gotText(d), historyRestored: (d) => window.MdActive && MdActive.history && MdActive.history.restored(d), busy, share: (d) => window.MdActive && MdActive.share && MdActive.share.got(d), conflicts: (d) => window.MdActive && MdActive.conflict && MdActive.conflict.got(d), conflictsFailed: () => window.MdActive && MdActive.conflict && MdActive.conflict.failed(), graphic: (...a) => window.MdActive && MdActive.graphic && MdActive.graphic.result(...a), graphicImage: (...a) => window.MdActive && MdActive.graphic && MdActive.graphic.image(...a), completion: (...a) => window.MdActive && MdActive.ghost && MdActive.ghost.result(...a), linkResolved, pdfChunk: (...a) => window.MdPdf && MdPdf.chunk(...a), render, setTheme, scrollToFragment, toast, setMode, flush, saveFailed, setFolder, setTabs, clear, noteRenamed, insertImage, pasteText, pasteClip, setPrefs, insertDropped,
    // what the active mode (active/*.js, loaded on demand) builds on
    core: { md, stripFrontmatter, stripComments, renderProps, toggleProp, pages: { parse: parsePages, text: pagesText, view: pageView, put: pagePut, fileLine: pageFileLine, isRow: (raw) => PAGE_ROW.test(String(raw || "").trim()), idOf: (raw) => (PAGE_ROW.exec(String(raw || "").trim()) || [])[3] || null, STYLES: PAGE_STYLES, facts: pageFacts, append: (id, markdown) => pageAppend(id, markdown),
      // a page's line: how it looks — and the line that says it looks another way
      // a link to a note as a block of its own: [[inner]] and how it looks
      link: { STYLES: LINK_STYLES, isRow: (raw) => LINK_ROW.test(String(raw || "").trim()), innerOf: (raw) => (LINK_ROW.exec(String(raw || "").trim()) || [])[1] || "", lookOf: (raw) => pageLook((LINK_ROW.exec(String(raw || "").trim()) || [])[2]), mark: linkMark, follow: (target) => followWiki(target) },
      lookOf: (raw) => pageLook((PAGE_ROW.exec(String(raw || "").trim()) || [])[1]),
      rename: (raw, name) => { const m = PAGE_ROW.exec(String(raw || "").trim()); return m ? pageMark(pageLook(m[1]), pageName(name) || m[2], m[3]) : raw; }, titleOf: (raw) => (PAGE_ROW.exec(String(raw || "").trim()) || [])[2] || "",
      withLook: (raw, look) => { const m = PAGE_ROW.exec(String(raw || "").trim()); return m ? pageMark({ ...pageLook(m[1]), ...look }, m[2], m[3]) : raw; },
      // … and the page as it stands in the file, for the clipboard
      markdownOf: (raw) => { const m = PAGE_ROW.exec(String(raw || "").trim()), page = m && pagesShown && pagesShown.byId.get(m[3]); return page ? pageLines(page).join("\n").replace(/\r/g, "") : m ? pageMark(pageLook(m[1]), m[2]) + "\n\n<!-- /page -->" : String(raw || ""); }, fresh: () => "x" + ++pageFresh, open: (id) => pageOpen(id) }, isExternal, slugify, inlineText, esc, ICON: SVG_ICON, UI: ICON, DECO_COLORS, callout: { kind: calloutKind, title: calloutTitle, icon: CALLOUT_ICON }, keys, follow, tex, mermaidSvg, toast,
      copy: (text) => post("copy", { text }), post, touching, mdHtml, mdInto, drawDiagrams, fenceSvg, noteText,
      // (the folder's notes, for what the chat may be given to read: { path, name, dir })
      folderName: () => (folder ? (folder.quick ? "Quick Notes" : folder.name) : ""),
      folderNotes,
      ai: {
        // (the note as its file has it — its pages are sections of that text — and that text put anew, as one step back)
        fileText: aiFileText, setFileText: aiSetFileText, undoFileText: () => trailStep(-1),
        where: () => { const v = current && viewOf(current), out = []; for (let pg = v && v.page; pg && pg.id != null; pg = pg.parent) out.unshift(pg.title || "Untitled"); return out; }, on: aiOn, load: loadAi, transform: (view, range) => loadAi().then((ai) => ai.transform(view, range)).catch(() => {}) }, emptyState, zoomImage, zoomFigure, zoomFigureAt, going, sortNotes, svgPicture, lockScroll, imageSize, popup, combo, closePick: () => closePick(false), moving, fileHref, fileSize, fileExt, codeHidden, codeLang, listed, rowIcon, tableLook, tableMark, tableStyle, headColor, ruleLook, fileMenu: (...a) => openCtx(...a),
      hydrate: (root) => renderMermaid(generation, null, root), // diagrams in freshly inserted HTML
      board: { open: openBoard, is: isBoardImg, make: newBoard },
      get current() { return current; }, get folder() { return folder; }, get top() { return topRoom(); } },
    quickFresh,
    setPreviews: (p) => { const rest = sbPreviews(p); if (!Object.keys(rest).length && Object.keys(p || {}).length) return; quickPreviews(rest); if (window.MdOverview) MdOverview.previews(rest); } };
})();
