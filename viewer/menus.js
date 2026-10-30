/* mdview, the page — the app's own small menus: a choice among a few (popup, combo) and the menu
 * for text in a field or in the reading view. */
"use strict";
(() => {
  const P = window.MdPage;
  const { post, T, esc, motionMs, keys, ICON } = P; // viewer/base.js
  const { zoomFigure, zoomFigureAt } = P; // viewer/modes.js
  const { sbList, sbTitlesBtn, ctx, subOpen, openSub, closeSub, setCtxHl, runCtx } = P; // viewer/sidebar.js

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
    if (!t || t.closest("#settings-scrim, #dlg-scrim, #toolbar, #orail, #palette, #pal-btn, #zoom, #tour, #update")) return;
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
    const blocks = !field && P.mode === "active" && window.MdActive && MdActive.view.pm && MdActive.blocks && (t.closest(".pm") || !t.closest("#sidebar, #overview, #tabs, #rpanel, #dlg, #settings, #history, #share, #ai-chat"));
    rows.push([T("Select All"), "Ctrl+A", true, blocks ? () => MdActive.blocks.selectAll(MdActive.view.pm) : edit("SelectAll")]);
    // a note with properties, clicked beside its text: they are put away, or shown again (for every note)
    if (!field && !t.closest("#sidebar, #overview, #tabs, .ui-menu, #share") && document.querySelector('#content details.props, #active .isl[data-kind="frontmatter"]')) {
      const shown = window.MdPrefs?.props !== false;
      rows.push(null, [window.MdStrings.t(shown ? "menu.propsHide" : "menu.propsShow"), "", true, () => { window.MdPrefs = { ...(window.MdPrefs || {}), props: !shown }; post("prefs", { prefs: { props: !shown } }); P.prefsChanged(); }]);
    }
    // beside the note's text (not in a field, not on a link or a picture): the settings, as from the gear
    if (!field && !href && !img && !t.closest("#sidebar, #overview, #tabs, .ui-menu, #share, #dlg, #settings")) rows.push(null, [window.MdStrings.t("prefs.open"), "Ctrl+,", true, () => P.openSettings()]);
    menuAt(e.clientX, e.clientY, rows);
  });
  /* The same menu for another part of the page (a whiteboard's right click): rows of [name, keys, whether it can be chosen
   * now, what it does, a class of its own ("danger")], null for a rule; at a point of the window. */
  function menuAt(x, y, rows) {
    tDo = {};
    tmenu.innerHTML = rows.map((r, i) => (r ? `<button class="menu-item${r[4] ? " " + r[4] : ""}" role="menuitem" type="button" data-cmd="${i}"${r[2] ? "" : " disabled"}><span class="menu-label">${r[0]}</span>${r[1] ? `<span class="menu-key">${keys(r[1])}</span>` : ""}</button>` : `<div class="menu-rule"></div>`)).join("");
    rows.forEach((r, i) => { if (r) tDo[i] = r[3]; });
    tItems = [...tmenu.querySelectorAll(".menu-item")];
    tSetHl(-1);
    tmenu.style.left = Math.max(8, Math.min(x, innerWidth - tmenu.offsetWidth - 8)) + "px";
    tmenu.style.top = Math.max(8, Math.min(y, innerHeight - tmenu.offsetHeight - 8)) + "px";
    tmenu.dataset.open = "";
  }
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
    const i = P.ctxItems.indexOf(e.target.closest(".menu-item"));
    if (i === P.ctxHl) return;
    setCtxHl(i);
    // (the entry that leads to a menu of its own opens it under the pointer; any other entry puts it away)
    if (i >= 0 && P.ctxItems[i].classList.contains("has-sub")) openSub(P.ctxItems[i], false); else if (i >= 0) closeSub(false);
  });
  ctx.addEventListener("mouseleave", () => { if (!subOpen()) setCtxHl(-1); }); // (on the way into the menu beside it, its entry stays marked)
  ctx.addEventListener("click", (e) => runCtx(P.ctxItems.indexOf(e.target.closest(".menu-item"))));
  ctx.addEventListener("keydown", (e) => {
    const n = P.ctxItems.length;
    const moves = { ArrowDown: P.ctxHl + 1, ArrowUp: P.ctxHl < 0 ? n - 1 : P.ctxHl - 1, Home: 0, End: n - 1 };
    if (e.key in moves) { e.preventDefault(); closeSub(false); setCtxHl(Math.min(n - 1, Math.max(0, moves[e.key]))); }
    else if ((e.key === "Enter" || e.key === "ArrowRight") && P.ctxHl >= 0 && P.ctxItems[P.ctxHl].classList.contains("has-sub")) { e.preventDefault(); openSub(P.ctxItems[P.ctxHl], true); }
    else if (e.key === "Enter" && P.ctxHl >= 0) { e.preventDefault(); runCtx(P.ctxHl); }
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
    if (P.current && P.current.path === r.oldReal) {
      P.current.path = r.real;
      P.current.name = r.name;
      document.title = r.name;
    }
    if (P.edPath === r.oldReal) P.edPath = r.real;
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

  // what the page's other files use of this one
  Object.assign(P, { closePick, popup, combo, menuAt, startRename, noteRenamed, setTitles });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    titlesTimer: [() => titlesTimer, (v) => { titlesTimer = v; }],
    titlesAt: [() => titlesAt, (v) => { titlesAt = v; }],
  });
})();
