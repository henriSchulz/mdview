/* mdview — AI: Claude, asked through the claude command on this computer (the application runs it:
 * src-tauri/src/ai.rs). Two things:
 *   Transform with AI   blocks of the note, and what to do with them — the answer takes their place
 *                       or stands under them (the active mode; from the menus of a right click)
 *   the chat            about the whole note, in a small window at the lower right; what is written
 *                       for the note shows there first, and is put into the note by its button
 * Loaded when either is first asked for (viewer.js: loadAi), with ai.css. Nothing of it where AI is
 * turned off in the settings. */
"use strict";
(() => {
  const core = window.MdView.core, T = window.MdStrings.t, esc = core.esc, post = core.post;
  const Ai = (window.MdAi = {});
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    send: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    stop: svg('<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    fresh: svg('<path d="M12 5v14M5 12h14"/>'),
    size: svg('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 20h3.5a1.5 1.5 0 0 0 1.5-1.5V15M14 10l6-6M10 14l-6 6"/>'),
    put: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 5.5v-0.5A1.5 1.5 0 0 0 14 3.5H6A2.5 2.5 0 0 0 3.5 6v8A1.5 1.5 0 0 0 5 15.5h0.5"/>'),
  };

  // ---------------------------------------------------------------- asking
  const jobs = new Map(); // id → { channel, onDelta, onDone }
  let seq = 0;
  /* channel: "transform" or "chat" (one answer at a time for each). → the question's id */
  function ask(channel, payload, onDelta, onDone) {
    const id = "a" + ++seq;
    jobs.set(id, { channel, onDelta, onDone });
    post("ai-ask", { id, channel, ...payload });
    return id;
  }
  function stop(id) { const j = jobs.get(id); if (!j) return; jobs.delete(id); post("ai-stop", { channel: j.channel }); }
  Ai.delta = (id, text) => { const j = jobs.get(id); if (j) j.onDelta(String(text || "")); };
  Ai.done = (id, text, error) => { const j = jobs.get(id); if (!j) return; jobs.delete(id); j.onDone(text == null ? null : String(text), error || null); };
  const noteName = () => String((core.current && core.current.name) || "").replace(/\.(md|markdown)$/i, "");
  const active = () => { const A = window.MdActive; return document.body.dataset.view === "active" && A && A.view && A.view.pm && A.view.pm.editable ? A : null; };
  /* What is chosen in the note: the selected blocks; else the blocks a selection of text reaches; else (blocks: false) nothing —
   * (blocks: true) the block the caret is in. → { from, to } */
  function chosen(view, caretToo) {
    const A = window.MdActive, state = view.state, picked = A.blocks.selection(state);
    if (picked) return { from: picked.from, to: picked.to };
    const sel = state.selection;
    if (sel.empty && !caretToo) return null;
    const from = sel.$from.depth ? sel.$from.before(1) : sel.from, to = sel.$to.depth ? sel.$to.after(1) : sel.to;
    return to > from ? { from, to } : null;
  }

  // ---------------------------------------------------------------- Transform with AI
  /* What is asked for with one press: [name, what Claude is told]. */
  const PRESETS = [
    ["improve", "Improve the writing: clearer, more precise, better flow. Keep the meaning, the language and the length roughly as they are."],
    ["fix", "Fix spelling, grammar and punctuation. Change nothing else."],
    ["shorter", "Make it shorter: say the same in about half the words."],
    ["longer", "Expand it: more detail and explanation, in the same tone."],
    ["simpler", "Rewrite it in simpler words, so that someone new to the subject understands it."],
    ["summary", "Summarise it in a few sentences."],
    ["bullets", "Turn it into a bulleted list of its key points."],
    ["table", "Turn it into a Markdown table."],
    ["formal", "Rewrite it in a formal, professional tone."],
    ["casual", "Rewrite it in a relaxed, friendly tone."],
    ["english", "Translate it into English."],
    ["german", "Translate it into German."],
    ["continue", "Keep the text as it is and continue writing after it, in the same style: one or two more paragraphs."],
  ];
  /* view: the editor. range: { from, to } of the blocks meant (none: what is chosen there). */
  Ai.transform = (view, range = null) => {
    const A = window.MdActive;
    if (!A || !view || !view.editable || A.dialog.open) return;
    const r = range || chosen(view, true);
    if (!r) return core.toast(T("ai.nothing"));
    const selection = A.clip.markdownOf(view.state, view.state.doc.slice(r.from, r.to));
    if (!selection.trim()) return core.toast(T("ai.nothing"));
    let job = null, result = null, where = "replace", shownAt = 0, timer = 0;
    try { where = localStorage.getItem("mdview:ai-where") === "below" ? "below" : "replace"; } catch (e) { /* (as new) */ }
    const el = A.dialog.el, doneBtn = () => document.querySelector('#dlg [data-do="done"]');
    const tidy = () => { clearInterval(timer); if (job) stop(job); job = null; };
    A.dialog.show({
      title: T("ai.transform"),
      kind: "ai",
      anchor: () => null,
      build(body, _tools, info) {
        const chips = el("div", { class: "ai-chips", role: "group", "aria-label": T("ai.quick") }, PRESETS.map(([k]) => `<button class="ai-chip" type="button" data-preset="${k}">${esc(T("ai.do." + k))}</button>`).join(""));
        const text = el("textarea", { class: "ai-text lp-field", rows: "3", placeholder: T("ai.instruction"), "aria-label": T("ai.instruction"), spellcheck: "false" });
        const row = el("div", { class: "ai-row" },
          `<span class="ai-seg" role="radiogroup" aria-label="${esc(T("ai.where"))}"><button type="button" role="radio" data-where="replace">${esc(T("ai.where.replace"))}</button><button type="button" role="radio" data-where="below">${esc(T("ai.where.below"))}</button></span>` +
          `<label class="ai-check"><input type="checkbox" class="ai-whole" checked><span>${esc(T("ai.whole"))}</span></label><span class="ai-space"></span>` +
          `<button class="btn primary" type="button" data-go="run">${esc(T("ai.run"))}</button>`);
        const out = el("div", { class: "ai-out", hidden: "" });
        body.classList.add("ai-dialog");
        body.append(chips, text, row, out);
        info.textContent = T("ai.hint");
        const run = row.querySelector('[data-go="run"]'), whole = row.querySelector(".ai-whole"), insert = doneBtn();
        const show = () => {
          for (const b of row.querySelectorAll("[data-where]")) b.setAttribute("aria-checked", String(b.dataset.where === where));
          run.textContent = job ? T("ai.stop") : result != null ? T("ai.again") : T("ai.run");
          run.classList.toggle("primary", !job && result == null);
          insert.textContent = T(where === "replace" ? "ai.replace" : "ai.insertBelow");
          insert.disabled = result == null || !!job;
          for (const c of chips.children) c.disabled = !!job;
        };
        const go = () => {
          const instruction = text.value.trim();
          if (!instruction) { text.focus(); return; }
          tidy();
          result = null;
          let said = "";
          out.hidden = false;
          out.innerHTML = `<div class="ai-wait"><span class="ai-spin"></span><span class="ai-secs"></span></div><div class="ai-stream"></div>`;
          const stream = out.querySelector(".ai-stream"), secs = out.querySelector(".ai-secs");
          shownAt = performance.now();
          const tick = () => { secs.textContent = T("ai.working", Math.round((performance.now() - shownAt) / 1000)); };
          tick();
          timer = setInterval(tick, 1000);
          job = ask("transform", { instruction, selection, note: whole.checked ? core.noteText() : "", name: noteName() },
            (piece) => { said += piece; stream.textContent = said; out.scrollTop = out.scrollHeight; },
            (all, error) => {
              job = null;
              clearInterval(timer);
              if (error || all == null || !all.trim()) { out.innerHTML = `<div class="ai-error">${esc(error || T("ai.failed"))}</div>`; show(); return; }
              // (an answer wrapped in a fence all the same: what is in it is meant)
              result = all.trim().replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i, "$1");
              out.innerHTML = `<div class="dlg-preview doc ai-preview"></div>`;
              try { out.firstChild.innerHTML = A.islands.kit.html(result); } catch (e) { out.firstChild.textContent = result; }
              out.scrollTop = 0;
              show();
              insert.focus();
            });
          show();
        };
        chips.addEventListener("click", (e) => { const b = e.target.closest("[data-preset]"); if (!b || job) return; text.value = PRESETS.find(([k]) => k === b.dataset.preset)[1]; go(); });
        row.addEventListener("click", (e) => {
          const b = e.target.closest("button");
          if (!b) return;
          if (b.dataset.where) { where = b.dataset.where; try { localStorage.setItem("mdview:ai-where", where); } catch (x) { /* (not kept) */ } show(); }
          else if (b.dataset.go === "run") { if (job) { tidy(); out.hidden = result == null; show(); } else go(); }
        });
        // Ctrl+Enter in the field asks (once there is an answer, the dialog's own Ctrl+Enter takes it)
        text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && result == null && !job) { e.preventDefault(); e.stopPropagation(); go(); } });
        show();
        return { focus: () => text.focus(), result: () => (result != null && !job ? { text: result, where } : undefined), text: () => text.value };
      },
      done(res) {
        tidy();
        const state = view.state, nodes = A.clip.blocksOf(state, res.text);
        if (!nodes.length || r.to > state.doc.content.size) { view.focus(); return; }
        const tr = res.where === "replace" ? state.tr.replaceWith(r.from, r.to, nodes) : state.tr.insert(r.to, nodes);
        const at = res.where === "replace" ? r.from : r.to;
        try { tr.setSelection(PM.state.Selection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size)), 1)); } catch (e) { /* (the caret stays) */ }
        view.dispatch(tr.scrollIntoView().setMeta("step", true));
        view.focus();
      },
      cancel() { tidy(); view.focus(); },
    });
  };

  // ---------------------------------------------------------------- the chat
  const SIZES = ["s", "m", "l"];
  const talks = new Map(); // a note's path → [{ role, text }]
  let box = null, log = null, field = null, sendBtn = null, talking = null; // talking: { id, path, text }
  const pathNow = () => String((core.current && core.current.path) || "");
  const talk = () => { const p = pathNow(); if (!talks.has(p)) talks.set(p, []); return talks.get(p); };
  /* What Claude said, in parts: text, and what it wrote for the note (between <insert> and </insert> — one that is not shut yet,
   * while the answer comes, is one in the making). */
  function parts(text) {
    const out = [];
    let rest = String(text);
    for (;;) {
      const a = rest.indexOf("<insert>");
      if (a < 0) break;
      if (rest.slice(0, a).trim()) out.push({ text: rest.slice(0, a) });
      const b = rest.indexOf("</insert>", a);
      if (b < 0) { out.push({ insert: rest.slice(a + 8), open: true }); rest = ""; break; }
      out.push({ insert: rest.slice(a + 8, b) });
      rest = rest.slice(b + 9);
    }
    // (a tag being typed — "<ins" at the end — is not shown as text)
    rest = rest.replace(/<\/?i(?:n(?:s(?:e(?:r(?:t)?)?)?)?)?$/, "");
    if (rest.trim()) out.push({ text: rest });
    return out;
  }
  const md = (text) => { try { return core.mdHtml(text); } catch (e) { return `<p>${esc(text)}</p>`; } };
  function bubbleOf(m, i, live) {
    if (m.role === "user") return `<div class="ai-msg ai-user"><div class="ai-said">${esc(m.text)}</div></div>`;
    if (m.error) return `<div class="ai-msg ai-bot"><div class="ai-error">${esc(m.error)}</div></div>`;
    const ps = parts(m.text);
    let n = 0;
    const inner = ps.map((p) => (p.insert == null ? `<div class="ai-md">${md(p.text)}</div>`
      : `<div class="ai-card"${p.open ? " data-open" : ""}><div class="ai-md">${md(p.insert)}</div>` +
        (p.open ? "" : `<div class="ai-card-foot"><button class="btn primary" type="button" data-put="${i}:${n}">${I.put}<span>${esc(T("ai.put"))}</span></button><button class="btn" type="button" data-copy="${i}:${n++}">${I.copy}<span>${esc(T("ai.copy"))}</span></button></div>`) + `</div>`)).join("");
    return `<div class="ai-msg ai-bot"${live ? " data-live" : ""}>${inner || (live ? `<div class="ai-typing"><i></i><i></i><i></i></div>` : "")}</div>`;
  }
  function draw(stick = true) {
    if (!box) return;
    const list = talk(), live = talking && talking.path === pathNow();
    box.querySelector(".ai-title").textContent = noteName() ? T("ai.chat.about", noteName()) : T("ai.chat");
    log.innerHTML = (list.length || live ? "" : `<div class="ai-empty"><b>${esc(T("ai.chat.hello"))}</b><p>${esc(T("ai.chat.hint"))}</p><div class="ai-tips">${["summary", "explain", "table", "next"].map((k) => `<button class="ai-chip" type="button" data-tip="${k}">${esc(T("ai.tip." + k))}</button>`).join("")}</div></div>`) +
      list.map((m, i) => bubbleOf(m, i, false)).join("") + (live ? bubbleOf({ role: "assistant", text: talking.text }, list.length, true) : "");
    sendBtn.innerHTML = live ? I.stop : I.send;
    sendBtn.title = T(live ? "ai.stop" : "ai.send"); sendBtn.setAttribute("aria-label", sendBtn.title);
    if (stick) log.scrollTop = log.scrollHeight;
  }
  let frame = 0;
  const drawSoon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80; draw(near); }); };
  function say(text) {
    text = String(text || "").trim();
    if (!text || talking) return;
    const path = pathNow(), list = talk(), A = active();
    list.push({ role: "user", text });
    // (what is chosen in the note goes along: "this", "these" are what the user points at)
    let selection = "";
    if (A) { const r = chosen(A.view.pm, false); if (r) selection = A.clip.markdownOf(A.view.pm.state, A.view.pm.state.doc.slice(r.from, r.to)); }
    const mine = (talking = { id: null, path, text: "" });
    mine.id = ask("chat", { note: core.noteText(), name: noteName(), selection, messages: list.map((m) => ({ role: m.role, text: m.text || "" })).filter((m) => m.text) },
      (piece) => { mine.text += piece; if (pathNow() === path) drawSoon(); },
      (all, error) => {
        if (talking === mine) talking = null;
        (talks.get(path) || []).push(error || all == null ? { role: "assistant", text: "", error: error || T("ai.failed") } : { role: "assistant", text: all });
        if (pathNow() === path) draw();
      });
    field.value = "";
    fit();
    draw();
  }
  const fit = () => { field.style.height = "auto"; field.style.height = Math.min(160, Math.max(38, field.scrollHeight)) + "px"; };
  /* What Claude wrote for the note, put into it: under the blocks that are selected; else under the block the caret was put
   * in; else at the note's end. (Not in the active mode: the note is taken there first.) */
  async function put(markdown) {
    if (!active()) {
      if (!core.current || core.current.readonly) return core.toast(T("ai.noPut"));
      window.MdView.setMode("active");
      for (let i = 0; i < 60 && !active(); i++) await new Promise((r) => setTimeout(r, 50));
    }
    const A = active();
    if (!A) return core.toast(T("ai.noPut"));
    const view = A.view.pm, state = view.state, nodes = A.clip.blocksOf(state, String(markdown).trim());
    if (!nodes.length) return;
    const picked = A.blocks.selection(state), sel = state.selection, end = state.doc.content.size;
    const at = picked ? picked.to : sel.from > 1 || !sel.empty ? (sel.$to.depth ? sel.$to.after(1) : sel.to) : end;
    const tr = state.tr.insert(Math.min(at, end), nodes);
    try { tr.setSelection(PM.state.Selection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size)), 1)); } catch (e) { /* (the caret stays) */ }
    view.dispatch(tr.scrollIntoView().setMeta("step", true));
    core.toast(T("ai.putDone"));
  }
  function build() {
    box = document.createElement("section");
    box.id = "ai-chat";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", T("ai.chat"));
    box.hidden = true;
    try { box.dataset.size = SIZES.includes(localStorage.getItem("mdview:ai-size")) ? localStorage.getItem("mdview:ai-size") : "m"; } catch (e) { box.dataset.size = "m"; }
    box.innerHTML =
      `<header class="ai-head"><span class="ai-title"></span><span class="ai-space"></span>` +
        `<button class="ai-ib" type="button" data-do="fresh" title="${esc(T("ai.chat.fresh"))}" aria-label="${esc(T("ai.chat.fresh"))}">${I.fresh}</button>` +
        `<button class="ai-ib" type="button" data-do="size" title="${esc(T("ai.chat.size"))}" aria-label="${esc(T("ai.chat.size"))}">${I.size}</button>` +
        `<button class="ai-ib" type="button" data-do="close" title="${esc(T("ai.chat.close"))}" aria-label="${esc(T("ai.chat.close"))}">${I.close}</button></header>` +
      `<div class="ai-log" aria-live="polite"></div>` +
      `<footer class="ai-foot"><textarea class="ai-field" rows="1" placeholder="${esc(T("ai.chat.ask"))}" aria-label="${esc(T("ai.chat.ask"))}" spellcheck="false"></textarea><button class="ai-send" type="button"></button></footer>` +
      `<div class="ai-note">${esc(T("ai.hint"))}</div>`;
    document.body.appendChild(box);
    log = box.querySelector(".ai-log"); field = box.querySelector(".ai-field"); sendBtn = box.querySelector(".ai-send");
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b === sendBtn) { if (talking && talking.path === pathNow()) { stop(talking.id); const t = talking; talking = null; if (t.text.trim()) talk().push({ role: "assistant", text: t.text }); draw(); } else say(field.value); return; }
      if (b.dataset.tip) return say(T("ai.tip." + b.dataset.tip + ".ask"));
      if (b.dataset.do === "close") return Ai.chat.close();
      if (b.dataset.do === "fresh") { if (talking && talking.path === pathNow()) { stop(talking.id); talking = null; } talks.set(pathNow(), []); draw(); field.focus(); return; }
      if (b.dataset.do === "size") { const next = SIZES[(SIZES.indexOf(box.dataset.size) + 1) % SIZES.length]; box.dataset.size = next; try { localStorage.setItem("mdview:ai-size", next); } catch (x) { /* (not kept) */ } return; }
      const which = b.dataset.put || b.dataset.copy;
      if (which) {
        const [i, n] = which.split(":").map(Number), m = talk()[i], piece = m && parts(m.text).filter((p) => p.insert != null && !p.open)[n];
        if (!piece) return;
        if (b.dataset.put) put(piece.insert); else { core.copy(piece.insert.trim()); core.toast(T("ai.copied")); }
      }
    });
    field.addEventListener("input", fit);
    field.addEventListener("keydown", (e) => {
      e.stopPropagation(); // (what is typed here is not the note's, nor one of its keys)
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); say(field.value); }
      else if (e.key === "Escape") { e.preventDefault(); Ai.chat.close(); }
    });
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); Ai.chat.close(); } });
  }
  Ai.chat = {
    get open() { return !!box && !box.hidden; },
    toggle() { if (Ai.chat.open) Ai.chat.close(); else Ai.chat.show(); },
    show() {
      if (!core.ai.on()) return;
      if (!box) build();
      box.hidden = false;
      void box.offsetWidth;
      box.dataset.open = "";
      document.body.dataset.aiChat = "";
      draw();
      fit();
      setTimeout(() => field.focus({ preventScroll: true }), 0);
    },
    close() {
      if (!box || box.hidden) return;
      delete box.dataset.open;
      delete document.body.dataset.aiChat;
      setTimeout(() => { if (box && box.dataset.open == null) box.hidden = true; }, 220);
    },
  };
  /* AI turned off in the settings: whatever was asked is dropped, the chat is shut. */
  Ai.off = () => { for (const id of [...jobs.keys()]) stop(id); talking = null; if (box) { delete box.dataset.open; delete document.body.dataset.aiChat; box.hidden = true; } };
  // (another note on screen: its own talk)
  new MutationObserver(() => { if (Ai.chat.open && box.dataset.path !== pathNow()) { box.dataset.path = pathNow(); draw(); } }).observe(document.querySelector("title") || document.head, { childList: true, subtree: true, characterData: true });
  /* For the tests: what the chat holds. */
  Ai.state = () => ({ open: Ai.chat.open, size: box ? box.dataset.size : null, talk: talk().map((m) => ({ ...m })), talking: !!talking, jobs: jobs.size });
})();
