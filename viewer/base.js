/* mdview, the page — its ground: the message to the shell (post), the icons, small helpers.
 * The page inside the web view is viewer/*.js in the order the shell loads them (SCRIPTS in
 * src-tauri/src/shell.rs) and viewer.js last, each a closure of its own. What one file uses of
 * another goes over P (window.MdPage): each file's head names what it takes, its foot what it gives.
 * Where what is: docs/MAP.md. */
"use strict";
(() => {
  const P = (window.MdPage = {});
  // state of one file that others read (and set, where a setter is given): P.name is the variable itself
  P.live = (o) => { for (const k in o) Object.defineProperty(P, k, { get: o[k][0], set: o[k][1], enumerable: true }); };

  const NONCE = document.currentScript.nonce;
  const DESKTOP = !!window.__TAURI_INTERNALS__; // the desktop application's window (not a browser, whose host is the web app's)
  const ASSETS = document.currentScript.src.replace(/\/viewer\/[^/]*$/, ""); // (this file is in viewer/)
  const content = document.getElementById("content");
  const baseEl = document.querySelector("base");
  // Anything that leaves the file or the window hands over unsaved edits first.
  const LEAVING = new Set(["back", "forward", "open", "reload", "close", "print", "external", "note", "newnote", "quicknote", "folder", "rename", "move", "trash", "tab", "link", "wikilink"]); // (a link followed leaves the note too: what was typed a moment ago is in the file first)
  let leaving = false; // a save because the note, the mode or the window is being left (not the timer's)
  const post = (type, data = {}) => {
    if (LEAVING.has(type)) { leaving = true; window.MdBoard?.leave?.(); P.flushSave(); leaving = false; } // (an open whiteboard is the note's: what is drawn goes first)
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

  // what the page's other files use of this one
  Object.assign(P, { NONCE, DESKTOP, ASSETS, content, baseEl, post, T, esc, motionMs, keys, svg, SVG_ICON,
    ICON, fileHref, fileSize, fileExt, PDF_COLORS, DECO_COLORS, CALLOUT_ALIAS, CALLOUT_ICON, slugify,
    inlineText });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    leaving: [() => leaving, (v) => { leaving = v; }],
  });
})();
