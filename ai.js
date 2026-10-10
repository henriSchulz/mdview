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
    edit: svg('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 3 3"/>'),
    chat: svg('<path d="M5 6.5A2.5 2.5 0 0 1 7.500 4h9A2.500 2.500 0 0 1 19 6.500v7a2.500 2.500 0 0 1-2.500 2.500H11l-4 3.500V16A2.500 2.500 0 0 1 5 13.500z"/>'),
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
    let job = null, result = null, where = "replace", shownAt = 0, timer = 0, picked = "", paint = 0;
    try { where = localStorage.getItem("mdview:ai-where") === "below" ? "below" : "replace"; } catch (e) { /* (as new) */ }
    const el = A.dialog.el, doneBtn = () => document.querySelector('#dlg [data-do="done"]');
    const tidy = () => { clearInterval(timer); clearTimeout(paint); paint = 0; if (job) stop(job); job = null; };
    A.dialog.show({
      title: T("ai.transform"),
      kind: "ai",
      anchor: () => null,
      build(body, _tools, info) {
        const chips = el("div", { class: "ai-chips", role: "group", "aria-label": T("ai.quick") }, PRESETS.map(([k]) => `<button class="ai-chip" type="button" data-preset="${k}">${esc(T("ai.do." + k))}</button>`).join(""));
        const text = el("textarea", { class: "ai-text lp-field", rows: "3", placeholder: T("ai.instruction"), "aria-label": T("ai.instruction"), spellcheck: "false" });
        const row = el("div", { class: "ai-opts" },
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
          for (const c of chips.children) { c.disabled = !!job; c.setAttribute("aria-pressed", String(c.dataset.preset === picked)); }
        };
        const go = () => {
          // (what was pressed, and what was written beside it — either is enough)
          const instruction = [picked ? PRESETS.find(([k]) => k === picked)[1] : "", text.value.trim()].filter(Boolean).join("\n\nAlso: ");
          if (!instruction) { text.focus(); return; }
          tidy();
          result = null;
          let said = "";
          out.hidden = false;
          out.innerHTML = `<div class="ai-wait"><span class="ai-spin"></span><span class="ai-secs"></span></div><div class="ai-md ai-stream"></div>`;
          const stream = out.querySelector(".ai-stream"), secs = out.querySelector(".ai-secs");
          shownAt = performance.now();
          const tick = () => { secs.textContent = T("ai.working", Math.round((performance.now() - shownAt) / 1000)); };
          tick();
          timer = setInterval(tick, 1000);
          job = ask("transform", { instruction, selection, note: whole.checked ? core.noteText() : "", name: noteName() },
            // (drawn a few times a second, as it will stand in the note — not at every letter)
            (piece) => { said += piece; if (!paint) paint = setTimeout(() => { paint = 0; if (!stream.isConnected) return; try { core.mdInto(stream, said, false); } catch (e) { stream.textContent = said; } out.scrollTop = out.scrollHeight; }, 120); },
            (all, error) => {
              job = null;
              clearInterval(timer); clearTimeout(paint); paint = 0;
              if (error || all == null || !all.trim()) { out.innerHTML = `<div class="ai-error">${esc(error || T("ai.failed"))}</div>`; show(); return; }
              // (an answer wrapped in a fence all the same: what is in it is meant)
              result = all.trim().replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i, "$1");
              // (shown as the reading view shows a note: formulas, in a table too, code, diagrams)
              out.innerHTML = `<div class="ai-md ai-preview"></div>`;
              result = core.fenceSvg(result).trim();
              try { core.mdInto(out.firstChild, result); } catch (e) { out.firstChild.textContent = result; }
              out.scrollTop = 0;
              show();
              insert.focus();
            });
          show();
        };
        chips.addEventListener("click", (e) => { const b = e.target.closest("[data-preset]"); if (!b || job) return; picked = picked === b.dataset.preset && result == null ? "" : b.dataset.preset; show(); if (picked) go(); });
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
  /* A window at the right, about the note on screen and whatever else it is given to read. Conversations are kept in this
   * browser (the last forty), each with its title; the one in hand goes on whatever note is on screen. */
  const STORE = "mdview:ai-talks", PLACE = "mdview:ai-place";
  const PRESET = { s: [340, 480], m: [420, 640], l: [640, 2000] };
  const MODELS = [["", "ai.model.own"], ["haiku", "Haiku"], ["sonnet", "Sonnet"], ["opus", "Opus"]];
  let talksAll = [];
  try { const was = JSON.parse(localStorage.getItem(STORE) || "[]"); if (Array.isArray(was)) talksAll = was.filter((t) => t && Array.isArray(t.messages)); } catch (e) { /* (none kept) */ }
  const keep = () => { try { localStorage.setItem(STORE, JSON.stringify(talksAll.slice(0, 40).map((t) => ({ ...t, messages: t.messages.slice(-80).map((m) => ({ ...m, text: String(m.text || "").slice(0, 40000) })) })))); } catch (e) { /* (not kept) */ } };
  let box = null, log = null, field = null, cur = null, talking = null; // cur: the conversation in hand; talking: { id, talk, text, el }
  let editing = false; // the chat's Edit mode: what Claude answers changes the note itself
  try { editing = localStorage.getItem("mdview:ai-edit") === "1"; } catch (e) { /* (as new) */ }
  let lastMade = null; // { message, doc }: the note as the last edits left it — while it is still so, they can be taken back from the chat
  const undoable = (m) => { const A = active(); return !!lastMade && lastMade.message === m && !!A && A.view.pm.state.doc === lastMade.doc; };
  /* Claude's edits, carried out in the note (the active mode): each finds its passage in the blocks as they are written and
   * puts the new text in their place; all of them are one step of Undo. → { done, missed: [what was not found] } */
  function carryOut(edits) {
    const A = active(), out = { done: 0, missed: [] };
    if (!A) { out.missed = edits.map((e) => e.find); return out; }
    const view = A.view.pm, state = view.state, blocks = [];
    state.doc.forEach((node, pos) => { if (!(node.type.name === "island" && (node.attrs.virtual || node.attrs.kind === "frontmatter"))) blocks.push({ from: pos, to: pos + node.nodeSize, md: A.clip.markdownOf(state, state.doc.slice(pos, pos + node.nodeSize)).replace(/^\n+|\s+$/g, "") }); });
    const loose = (t) => new RegExp(t.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
    const jobs = [];
    for (const e of edits) {
      if (!e.find.trim()) { if (e.replace.trim()) jobs.push({ from: state.doc.content.size, to: state.doc.content.size, text: e.replace, i: blocks.length, j: blocks.length - 1 }); else out.missed.push("∅"); continue; }
      const re = loose(e.find);
      let hit = null;
      // (the fewest blocks, standing together, that hold the passage)
      for (let span = 1; span <= 14 && !hit; span++) for (let i = 0; i + span <= blocks.length && !hit; i++) {
        const joined = blocks.slice(i, i + span).map((b) => b.md).join("\n\n");
        if (re.test(joined)) hit = { i, j: i + span - 1, from: blocks[i].from, to: blocks[i + span - 1].to, text: joined.replace(re, () => e.replace) };
      }
      if (!hit || jobs.some((x) => hit.i <= x.j && x.i <= hit.j)) { out.missed.push(e.find.trim()); continue; }
      jobs.push(hit);
    }
    if (!jobs.length) return out;
    // (a page of the note is its line, "<!-- page: Name #id -->": the id is what holds the page's content — a line that comes
    // back without it gets it again, by its name or its place, so that no page is emptied by a rewrite of its line)
    const PAGE = /^([ \t]*<!--\s*page(?:\s+[a-z ]+?)?\s*:\s*)(.*?)(\s*-->[ \t]*)$/gm, idOf = (t) => (/\s#([\w-]+)$/.exec(t) || [])[1];
    for (const x of jobs) {
      if (x.i > x.j) continue;
      const had = [...blocks.slice(x.i, x.j + 1).map((b) => b.md).join("\n\n").matchAll(PAGE)].map((m) => ({ id: idOf(m[2]), title: m[2].replace(/\s#[\w-]+$/, "").trim() })).filter((p) => p.id);
      if (!had.length) continue;
      const kept = new Set([...x.text.matchAll(PAGE)].map((m) => idOf(m[2])).filter(Boolean));
      x.text = x.text.replace(PAGE, (line, head, title, tail) => {
        if (idOf(title)) return line;
        const free = had.filter((p) => !kept.has(p.id)), p = free.find((f) => f.title === title.trim()) || free[0];
        if (!p) return line;
        kept.add(p.id);
        return `${head}${title.trim()} #${p.id}${tail}`;
      });
    }
    const tr = state.tr;
    let first = Infinity;
    for (const x of jobs.sort((a, b) => b.from - a.from || b.i - a.i)) { // (from the end, so that the places before stay where they are)
      const nodes = x.text.trim() ? A.clip.blocksOf(state, core.fenceSvg(x.text)) : [];
      if (nodes.length) tr.replaceWith(x.from, x.to, nodes); else tr.delete(x.from, x.to);
      first = Math.min(first, x.from);
      out.done++;
    }
    // (the caret and what is selected stay as they are, and so does the place on screen: only when the first change is out of
    // sight is it brought in, gently)
    view.dispatch(tr.setMeta("step", true));
    const dom = view.nodeDOM(Math.min(first, view.state.doc.content.size - 1));
    if (dom && dom.getBoundingClientRect) { const r = dom.getBoundingClientRect(); if (r.bottom < 60 || r.top > innerHeight - 60) dom.scrollIntoView({ block: "center", behavior: "smooth" }); }
    return out;
  }
  let useDoc = true, extra = []; // what the next question is given to read: the note on screen, and { kind, path, name } beside it
  const fresh = () => ({ id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: "", at: Date.now(), messages: [] });
  const titleOf = (t) => t.title || (t.messages.find((m) => m.role === "user") || {}).text || "";
  const q = (sel) => box.querySelector(sel);
  /* What Claude said, in parts: text, and what it wrote for the note (between <insert> and </insert> — one that is not shut yet,
   * while the answer comes, is one in the making). */
  /* The edits in what Claude said (the chat's Edit mode): [{ find, replace }]. */
  const EDIT = /<edit>\s*<find>\n?([\s\S]*?)\n?<\/find>\s*<replace>\n?([\s\S]*?)\n?<\/replace>\s*<\/edit>/g;
  const editsOf = (text) => [...String(text).matchAll(EDIT)].map((m) => ({ find: m[1], replace: m[2] }));
  // (what it said without them — one being written, while the answer comes, is left out too)
  const noEdits = (text) => String(text).replace(EDIT, "").replace(/<edit>[\s\S]*$/, "").replace(/<\/?e(?:d(?:i(?:t)?)?)?$/, "");
  function parts(text) {
    const out = [];
    let rest = noEdits(text);
    for (;;) {
      const a = rest.indexOf("<insert>");
      if (a < 0) break;
      if (rest.slice(0, a).trim()) out.push({ text: rest.slice(0, a) });
      const b = rest.indexOf("</insert>", a);
      if (b < 0) { out.push({ insert: rest.slice(a + 8), open: true }); rest = ""; break; }
      out.push({ insert: rest.slice(a + 8, b) });
      rest = rest.slice(b + 9);
    }
    rest = rest.replace(/<\/?i(?:n(?:s(?:e(?:r(?:t)?)?)?)?)?$/, ""); // (a tag being written — "<ins" at the end — is not shown as text)
    if (rest.trim()) out.push({ text: rest });
    return out;
  }
  const md = (text) => { try { return core.mdHtml(core.fenceSvg(text)); } catch (e) { return `<p>${esc(text)}</p>`; } };
  const SHEET = `<span class="ai-sheet" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
  const chipOf = (name, sub, more = "") => `<span class="ai-doc"${more}>${SHEET}<span class="ai-doc-text"><b>${esc(name)}</b><small>${esc(sub)}</small></span></span>`;
  const subOf = (c) => T(c.kind === "folder" ? "ai.ctx.folder" : c.kind === "file" ? "ai.ctx.file" : c.kind === "doc" ? "ai.ctx.doc" : "ai.ctx.note");
  /* One message of the conversation, as the window shows it. i: its place in the conversation (for the cards' buttons). */
  function htmlOf(m, i, live) {
    if (m.role === "user") return `<div class="ai-msg ai-user">${(m.ctx || []).map((c) => chipOf(c.name, subOf(c))).join("")}<div class="ai-said">${esc(m.text)}</div></div>`;
    if (m.error) return `<div class="ai-msg ai-bot"><div class="ai-error">${esc(m.error)}</div></div>`;
    let n = 0;
    const inner = parts(m.text).map((p) => (p.insert == null ? `<div class="ai-md">${md(p.text)}</div>`
      : `<div class="ai-card"${p.open ? " data-open" : ""}><div class="ai-md">${md(p.insert)}</div>` +
        (p.open ? "" : `<div class="ai-card-foot"><button class="ai-pillbtn ai-main" type="button" data-put="${i}:${n}">${I.put}<span>${esc(T("ai.put"))}</span></button><button class="ai-pillbtn" type="button" data-copy="${i}:${n++}">${I.copy}<span>${esc(T("ai.copy"))}</span></button></div>`) + `</div>`)).join("");
    const made = m.made ? `<div class="ai-made"${m.made.done ? "" : " data-none"}><span class="ai-made-text">${I.edit}<span>${esc(m.made.done ? T(m.made.done === 1 ? "ai.made.one" : "ai.made", m.made.done) : T("ai.made.none"))}</span></span>` +
      (m.made.done && undoable(m) ? `<button class="ai-pillbtn" type="button" data-undo="${i}">${esc(T("ai.made.undo"))}</button>` : "") + `</div>` +
      (m.made.missed && m.made.missed.length ? `<div class="ai-missed"><b>${esc(T("ai.made.missed", m.made.missed.length))}</b>${m.made.missed.map((f) => `<code>${esc(f.slice(0, 90))}</code>`).join("")}</div>` : "") : "";
    return `<div class="ai-msg ai-bot"${live ? " data-live" : ""}>${inner}${made}` + (live ? "" : `<div class="ai-acts"><button class="ai-ib ai-small" type="button" data-copyall="${i}" title="${esc(T("ai.copy"))}" aria-label="${esc(T("ai.copy"))}">${I.copy}</button></div>`) + `</div>`;
  }
  const bottom = () => { log.scrollTop = log.scrollHeight; };
  /* The whole conversation, drawn (when the window opens, another conversation is taken up, or a message is done). */
  function drawAll() {
    if (!box) return;
    const title = titleOf(cur);
    q(".ai-title-text").textContent = title ? title.slice(0, 60) : T("ai.chat.new");
    log.innerHTML = cur.messages.map((m, i) => htmlOf(m, i, false)).join("");
    if (talking && talking.talk === cur) { log.insertAdjacentHTML("beforeend", htmlOf({ role: "assistant", text: talking.text }, cur.messages.length, true)); talking.el = log.lastElementChild; }
    core.drawDiagrams(log);
    drawFoot();
    bottom();
  }
  /* What is under the conversation: whether Claude is at it, what the next question is given to read, the model, the button. */
  function drawFoot() {
    if (!box) return;
    const live = !!talking && talking.talk === cur, name = noteName();
    pill();
    requestAnimationFrame(() => { if (box) box.style.setProperty("--ai-foot", q(".ai-compose").offsetHeight + 22 + "px"); });
    q(".ai-ctx").innerHTML = (useDoc && name ? chipOf(name, T("ai.ctx.doc"), ' data-ctx="doc"') : "") + extra.map((c, i) => chipOf(c.name, subOf(c), ` data-ctx="${i}"`)).join("");
    for (const c of q(".ai-ctx").children) c.insertAdjacentHTML("beforeend", `<button class="ai-doc-x" type="button" title="${esc(T("ai.ctx.remove"))}" aria-label="${esc(T("ai.ctx.remove"))}">${I.close}</button>`);
    const mode = q(".ai-mode");
    mode.setAttribute("aria-pressed", String(editing));
    mode.innerHTML = (editing ? I.edit : I.chat) + `<span>${esc(T(editing ? "ai.mode.edit" : "ai.mode.ask"))}</span>`;
    mode.title = T(editing ? "ai.mode.edit.tip" : "ai.mode.ask.tip");
    field.placeholder = T(editing ? "ai.chat.change" : "ai.chat.ask");
    box.toggleAttribute("data-editing", editing);
    const model = (window.MdPrefs || {}).aiClaude || "";
    q(".ai-model:not(.ai-mode) span").textContent = T((MODELS.find(([k]) => k === model) || MODELS[0])[1]);
    const send = q(".ai-send");
    send.innerHTML = live ? I.stop : I.send;
    send.title = T(live ? "ai.stop" : "ai.send"); send.setAttribute("aria-label", send.title);
    send.toggleAttribute("data-idle", !live && !field.value.trim());
  }
  /* The small sign over the field while Claude is at it and nothing new shows: working, or which change it is writing. */
  function pill() {
    const el = q(".ai-pill"), live = !!talking && talking.talk === cur;
    const opened = live ? (talking.text.match(/<edit>/g) || []).length : 0, writing = opened > (live ? (talking.text.match(/<\/edit>/g) || []).length : 0) ? opened : 0;
    const label = writing ? T("ai.made.writing", writing) : T("ai.chat.working"), show = live && (!!writing || !noEdits(talking.text).trim());
    if (el.hidden === show) el.hidden = !show;
    const text = el.querySelector(".ai-pill-text");
    if (text.textContent !== label) text.textContent = label;
  }
  // (what Claude says, as it comes: only its own message is drawn anew, a few times a second — the rest of the window stands still)
  let pending = 0;
  function drawLive() {
    if (pending || !talking || talking.talk !== cur || !talking.el) return;
    pending = setTimeout(() => {
      pending = 0;
      if (!talking || talking.talk !== cur || !talking.el || !talking.el.isConnected) return;
      const near = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
      // (only what changed is drawn anew: while an edit is being written nothing of the message does, and the circle that
      // says so is one that stays — drawn anew at every piece it would begin its turn again each time)
      const html = htmlOf({ role: "assistant", text: talking.text }, cur.messages.length, true);
      if (html !== talking.html) { talking.html = html; talking.el.outerHTML = html; talking.el = log.lastElementChild; }
      pill();
      if (near) bottom();
    }, 90);
  }
  async function say(text) {
    text = String(text || "").trim();
    if (!text || talking) return;
    const edit = editing;
    if (edit && !active()) { // (the note is changed where it is written: the active mode)
      if (!core.current || core.current.readonly || core.current.kind === "pdf") return core.toast(T("ai.noEdit"));
      window.MdView.setMode("active");
      for (let i = 0; i < 60 && !active(); i++) await new Promise((r) => setTimeout(r, 50));
      if (!active()) return core.toast(T("ai.noEdit"));
    }
    if (edit) useDoc = true;
    const A = active(), mine = cur, name = noteName();
    if (!talksAll.includes(mine)) talksAll.unshift(mine);
    const ctx = [...(useDoc && name ? [{ kind: "doc", name }] : []), ...extra.map((c) => ({ kind: c.kind, name: c.name }))];
    mine.messages.push({ role: "user", text, ctx });
    mine.at = Date.now();
    // (what is chosen in the note goes along: "this", "these" are what the user points at)
    let selection = "";
    if (A && useDoc) { const r = chosen(A.view.pm, false); if (r) selection = A.clip.markdownOf(A.view.pm.state, A.view.pm.state.doc.slice(r.from, r.to)); }
    const t = (talking = { id: null, talk: mine, text: "", el: null });
    t.id = ask("chat", { edit, note: useDoc ? core.noteText() : "", name: useDoc ? name : "", selection, context: extra.map((c) => ({ kind: c.kind, path: c.path })), messages: mine.messages.map((m) => ({ role: m.role, text: m.text || "" })).filter((m) => m.text) },
      (piece) => { t.text += piece; drawLive(); },
      (all, error) => {
        if (talking === t) talking = null;
        clearTimeout(pending); pending = 0;
        const m = error || all == null ? { role: "assistant", text: "", error: error || T("ai.failed") } : { role: "assistant", text: all };
        if (edit && !m.error) { // (its edits, carried out at once)
          const edits = editsOf(all);
          if (edits.length) { try { m.made = carryOut(edits); } catch (e) { m.made = { done: 0, missed: [], error: String((e && e.stack) || e) }; } const now = active(); lastMade = m.made.done && now ? { message: m, doc: now.view.pm.state.doc } : null; }
        }
        mine.messages.push(m);
        keep();
        if (cur === mine) drawAll();
      });
    field.value = "";
    fit();
    keep();
    drawAll();
  }
  const fit = () => { field.style.height = "auto"; field.style.height = Math.min(180, Math.max(24, field.scrollHeight)) + "px"; };
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
    const view = A.view.pm, state = view.state, nodes = A.clip.blocksOf(state, core.fenceSvg(markdown).trim());
    if (!nodes.length) return;
    const picked = A.blocks.selection(state), sel = state.selection, end = state.doc.content.size;
    const at = picked ? picked.to : sel.from > 1 || !sel.empty ? (sel.$to.depth ? sel.$to.after(1) : sel.to) : end;
    const tr = state.tr.insert(Math.min(at, end), nodes);
    try { tr.setSelection(PM.state.Selection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size)), 1)); } catch (e) { /* (the caret stays) */ }
    view.dispatch(tr.scrollIntoView().setMeta("step", true));
    core.toast(T("ai.putDone"));
  }

  // ---- the small menus of the window: what else there is (conversations, this one, how large), what to add to read
  let menuFor = null;
  function menu(kind, anchor) {
    const m = q(".ai-menu");
    if (!kind || menuFor === kind) { menuFor = null; delete m.dataset.open; return; }
    const row = (attr, label, more = "") => `<button class="ai-row" type="button" ${attr}>${label}${more}</button>`;
    let html = "";
    if (kind === "more") {
      const others = talksAll.filter((t) => t.messages.length).slice(0, 8), when = (t) => new Date(t.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const size = Object.keys(PRESET).find((k) => Math.abs(box.offsetWidth - PRESET[k][0]) < 4) || "";
      html = (others.length ? `<h6>${esc(T("ai.menu.history"))}</h6>` + others.map((t) => row(`data-talk="${t.id}"${t === cur ? ' aria-current="true"' : ""}`, `<span class="ai-row-two"><b>${esc(titleOf(t).slice(0, 44) || T("ai.chat.new"))}</b><small>${esc(when(t))} · ${esc(T("ai.menu.count", t.messages.length))}</small></span>`)).join("") + "<hr>" : "") +
        `<h6>${esc(T("ai.menu.this"))}</h6>` + row('data-m="title"', esc(T("ai.menu.title"))) + row('data-m="copy"', esc(T("ai.menu.copy"))) + row('data-m="delete"', esc(T("ai.menu.delete"))) +
        `<hr><h6>${esc(T("ai.menu.size"))}</h6><div class="ai-sizes">${["s", "m", "l"].map((k) => `<button type="button" data-size="${k}" aria-pressed="${size === k}">${esc(T("ai.size." + k))}</button>`).join("")}</div>`;
    } else if (kind === "add") {
      const n = core.folderNotes().length;
      html = (n ? row('data-m="note"', esc(T("ai.add.note"))) + row('data-m="folder"', esc(T("ai.add.folder", n))) : "") + row('data-m="file"', esc(T("ai.add.file")));
    } else if (kind === "note") {
      html = `<input class="ai-find" type="text" placeholder="${esc(T("ai.add.find"))}" aria-label="${esc(T("ai.add.find"))}" spellcheck="false"><div class="ai-found"></div>`;
    } else if (kind === "model") {
      const now = (window.MdPrefs || {}).aiClaude || "";
      html = MODELS.map(([k, label]) => row(`data-model="${k}"${k === now ? ' aria-current="true"' : ""}`, esc(T(label)))).join("");
    }
    m.innerHTML = html;
    m.dataset.kind = kind;
    const r = anchor.getBoundingClientRect(), b = box.getBoundingClientRect(), up = r.top - b.top > b.height / 2;
    m.style.left = m.style.right = m.style.top = m.style.bottom = "";
    if (r.left - b.left > b.width / 2) m.style.right = Math.max(8, b.right - r.right) + "px"; else m.style.left = Math.max(8, r.left - b.left) + "px";
    if (up) m.style.bottom = b.bottom - r.top + 6 + "px"; else m.style.top = r.bottom - b.top + 6 + "px";
    m.style.setProperty("--origin", `${up ? "bottom" : "top"} ${r.left - b.left > b.width / 2 ? "right" : "left"}`);
    menuFor = kind;
    m.dataset.open = "";
    if (kind === "note") {
      const find = m.querySelector(".ai-find"), found = m.querySelector(".ai-found"), all = core.folderNotes();
      const list = () => {
        const s = find.value.trim().toLowerCase(), has = new Set(extra.map((c) => c.path));
        const hits = all.filter((x) => x.path !== (core.current || {}).path && !has.has(x.path) && (!s || x.name.toLowerCase().includes(s) || x.dir.toLowerCase().includes(s))).slice(0, 60);
        found.innerHTML = hits.length ? hits.map((x) => row(`data-note="${esc(x.path)}" data-name="${esc(x.name)}"`, `<span class="ai-row-two"><b>${esc(x.name)}</b>${x.dir ? `<small>${esc(x.dir)}</small>` : ""}</span>`)).join("") : `<p class="ai-none">${esc(T("ai.add.none"))}</p>`;
      };
      find.addEventListener("input", list);
      find.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); menu(null); field.focus(); } else if (e.key === "Enter") { e.preventDefault(); found.querySelector("[data-note]")?.click(); } });
      list();
      setTimeout(() => find.focus(), 0);
    }
  }
  const add = (c) => { if (!extra.some((x) => x.kind === c.kind && x.path === c.path)) extra.push(c); drawFoot(); };
  /* The files chosen in the system's window (the application answers "ai-pick" with them). */
  Ai.picked = (list) => { for (const f of list || []) add({ kind: "file", path: f.path, name: f.name }); };
  function setSize(w, h) {
    box.style.width = Math.round(Math.max(320, w)) + "px";
    box.style.height = Math.round(Math.max(360, h)) + "px";
    try { localStorage.setItem(PLACE, JSON.stringify({ w: box.offsetWidth, h: Math.round(Math.max(360, h)) })); } catch (e) { /* (not kept) */ }
  }
  function build() {
    box = document.createElement("section");
    box.id = "ai-chat";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", T("ai.chat"));
    box.hidden = true;
    box.innerHTML =
      `<i class="ai-grip" data-grip="corner"></i><i class="ai-grip" data-grip="left"></i><i class="ai-grip" data-grip="top"></i>` +
      `<header class="ai-head"><button class="ai-title" type="button" data-do="more"><span class="ai-title-text"></span>${svg('<path d="m9 6 6 6-6 6"/>')}</button><span class="ai-space"></span>` +
        `<button class="ai-ib" type="button" data-do="fresh" title="${esc(T("ai.chat.fresh"))}" aria-label="${esc(T("ai.chat.fresh"))}">${svg('<path d="M11.5 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4.5"/><path d="m10 14 1-3.6 7.3-7.3a1.4 1.4 0 0 1 2 0l.6.6a1.4 1.4 0 0 1 0 2L13.6 13z"/>')}</button>` +
        `<button class="ai-ib" type="button" data-do="more" title="${esc(T("ai.menu.more"))}" aria-label="${esc(T("ai.menu.more"))}">${svg('<circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none"/>')}</button>` +
        `<button class="ai-ib" type="button" data-do="close" title="${esc(T("ai.chat.close"))}" aria-label="${esc(T("ai.chat.close"))}">${svg('<path d="m6 9 6 6 6-6"/>')}</button></header>` +
      `<div class="ai-log" aria-live="polite"></div>` +
      `<div class="ai-pill" hidden><span class="ai-spin"></span><span class="ai-pill-text">${esc(T("ai.chat.working"))}</span></div>` +
      `<footer class="ai-compose"><div class="ai-ctx"></div>` +
        `<textarea class="ai-field" rows="1" placeholder="${esc(T("ai.chat.ask"))}" aria-label="${esc(T("ai.chat.ask"))}" spellcheck="false"></textarea>` +
        `<div class="ai-bar"><button class="ai-round" type="button" data-do="add" title="${esc(T("ai.add"))}" aria-label="${esc(T("ai.add"))}">${I.fresh}</button>` +
          `<button class="ai-model ai-mode" type="button" data-do="mode"></button>` +
          `<button class="ai-model" type="button" data-do="model" title="${esc(T("prefs.aiClaude"))}">${svg('<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>')}<span></span></button><span class="ai-space"></span>` +
          `<button class="ai-send" type="button"></button></div></footer>` +
      `<div class="ai-menu"></div>`;
    document.body.appendChild(box);
    log = q(".ai-log"); field = q(".ai-field");
    let place = null;
    try { place = JSON.parse(localStorage.getItem(PLACE) || "null"); } catch (e) { /* (as new) */ }
    setSize((place && place.w) || PRESET.m[0], (place && place.h) || PRESET.m[1]);
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) { if (!e.target.closest(".ai-menu")) menu(null); return; }
      const d = b.dataset;
      if (b.classList.contains("ai-doc-x")) { const c = b.closest("[data-ctx]").dataset.ctx; if (c === "doc") useDoc = false; else extra.splice(Number(c), 1); return drawFoot(); }
      if (b.classList.contains("ai-send")) { if (talking && talking.talk === cur) { const t = talking; stop(t.id); talking = null; clearTimeout(pending); pending = 0; if (t.text.trim()) cur.messages.push({ role: "assistant", text: t.text }); keep(); drawAll(); } else say(field.value); return; }
      if (d.do === "close") return Ai.chat.close();
      if (d.do === "fresh") { menu(null); cur = fresh(); useDoc = true; extra = []; drawAll(); field.focus(); return; }
      if (d.do === "mode") { editing = !editing; try { localStorage.setItem("mdview:ai-edit", editing ? "1" : "0"); } catch (x) { /* (not kept) */ } menu(null); drawFoot(); field.focus(); return; }
      if (d.undo != null) { const m = cur.messages[Number(d.undo)], A = active(); if (m && undoable(m)) { PM.history.undo(A.view.pm.state, A.view.pm.dispatch); lastMade = null; m.made = { ...m.made, done: 0, undone: true }; keep(); drawAll(); core.toast(T("ai.made.undone")); } return; }
      if (d.do === "more" || d.do === "add" || d.do === "model") return menu(d.do, b);
      if (d.size) { const [w, h] = PRESET[d.size]; setSize(w, Math.min(h, innerHeight - 32)); return menu(null); }
      if (d.talk) { const t = talksAll.find((x) => x.id === d.talk); if (t) { cur = t; menu(null); drawAll(); } return; }
      if (d.model != null) { window.MdPrefs = { ...(window.MdPrefs || {}), aiClaude: d.model }; post("prefs", { prefs: { aiClaude: d.model } }); menu(null); return drawFoot(); }
      if (d.note) { add({ kind: "note", path: d.note, name: d.name }); menu(null); field.focus(); return; }
      if (d.m === "note") { menuFor = null; return menu("note", q('[data-do="add"]')); }
      if (d.m === "folder") { add({ kind: "folder", path: "", name: core.folderName() || T("ai.ctx.folder") }); return menu(null); }
      if (d.m === "file") { post("ai-pick", {}); return menu(null); }
      if (d.m === "copy") { core.copy(cur.messages.map((m) => (m.role === "user" ? "> " + m.text.replace(/\n/g, "\n> ") : m.text.replace(/<\/?insert>/g, ""))).join("\n\n")); core.toast(T("ai.copied")); return menu(null); }
      if (d.m === "delete") { talksAll = talksAll.filter((t) => t !== cur); keep(); cur = fresh(); menu(null); return drawAll(); }
      if (d.m === "title") {
        const m = q(".ai-menu");
        m.innerHTML = `<input class="ai-find" type="text" value="${esc(titleOf(cur).slice(0, 80))}" aria-label="${esc(T("ai.menu.title"))}" spellcheck="false">`;
        const input = m.querySelector("input");
        input.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); cur.title = input.value.trim().slice(0, 80); keep(); menu(null); drawAll(); } else if (ev.key === "Escape") { ev.preventDefault(); menu(null); } });
        setTimeout(() => { input.focus(); input.select(); }, 0);
        return;
      }
      if (d.copyall != null) { const m = cur.messages[Number(d.copyall)]; if (m) { core.copy(m.text.replace(/<\/?insert>/g, "").trim()); core.toast(T("ai.copied")); } return; }
      const which = d.put || d.copy;
      if (which) {
        const [i, n] = which.split(":").map(Number), m = cur.messages[i], piece = m && parts(m.text).filter((p) => p.insert != null && !p.open)[n];
        if (!piece) return;
        if (d.put) put(piece.insert); else { core.copy(piece.insert.trim()); core.toast(T("ai.copied")); }
      }
    });
    field.addEventListener("input", () => { fit(); q(".ai-send").toggleAttribute("data-idle", !field.value.trim() && !(talking && talking.talk === cur)); });
    field.addEventListener("keydown", (e) => {
      e.stopPropagation(); // (what is typed here is not the note's, nor one of its keys)
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); say(field.value); }
      else if (e.key === "Escape") { e.preventDefault(); if (menuFor) menu(null); else Ai.chat.close(); }
    });
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (menuFor) menu(null); else Ai.chat.close(); } });
    // the wheel over the window is the window's: where nothing of it can be scrolled further, the note behind stays where it is
    box.addEventListener("wheel", (e) => {
      if (e.ctrlKey) return;
      for (let n = e.target; n && n !== box.parentNode; n = n.parentNode) {
        if (n.nodeType !== 1) continue;
        const o = getComputedStyle(n).overflowY;
        if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight + 1 && (e.deltaY < 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1)) return;
        if (n === box) break;
      }
      e.preventDefault();
    }, { passive: false });
    // pulled at its left edge, its upper edge or the corner between them: wider, higher (it stands at the lower right)
    for (const grip of box.querySelectorAll(".ai-grip")) {
      grip.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const how = grip.dataset.grip, x0 = e.clientX, y0 = e.clientY, w0 = box.offsetWidth, h0 = box.offsetHeight;
        try { grip.setPointerCapture(e.pointerId); } catch (x) { /* (a pointer made up by a test) */ }
        box.dataset.sizing = "";
        const move = (m) => setSize(how === "top" ? w0 : Math.min(innerWidth - 32, w0 + (x0 - m.clientX)), how === "left" ? h0 : Math.min(innerHeight - 32, h0 + (y0 - m.clientY)));
        const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up); delete box.dataset.sizing; };
        grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
      });
    }
  }
  Ai.chat = {
    get open() { return !!box && !box.hidden && box.dataset.open != null; },
    toggle() { if (Ai.chat.open) Ai.chat.close(); else Ai.chat.show(); },
    show() {
      if (!core.ai.on()) return;
      if (!box) build();
      if (!cur) cur = talksAll.find((t) => t.messages.length && Date.now() - t.at < 6 * 3600e3) || fresh(); // (the talk of a moment ago goes on; an old one is in the list)
      box.hidden = false;
      void box.offsetWidth;
      box.dataset.open = "";
      document.body.dataset.aiChat = "";
      drawAll();
      fit();
      setTimeout(() => field.focus({ preventScroll: true }), 0);
    },
    close() {
      if (!box || box.hidden) return;
      menu(null);
      delete box.dataset.open;
      delete document.body.dataset.aiChat;
      setTimeout(() => { if (box && box.dataset.open == null) box.hidden = true; }, 240);
    },
  };
  /* AI turned off in the settings: whatever was asked is dropped, the chat is shut. */
  Ai.off = () => { for (const id of [...jobs.keys()]) stop(id); talking = null; clearTimeout(pending); pending = 0; if (box) { delete box.dataset.open; delete document.body.dataset.aiChat; box.hidden = true; } };
  // (another note on screen: it is the current document now)
  let shownName = "";
  setInterval(() => { if (!Ai.chat.open) return; const n = noteName(); if (n !== shownName) { shownName = n; drawFoot(); } }, 600);
  /* For the tests: what the chat holds. */
  Ai.state = () => ({ open: Ai.chat.open, width: box ? box.offsetWidth : 0, height: box ? box.offsetHeight : 0, talk: cur ? cur.messages.map((m) => ({ ...m })) : [], title: cur ? titleOf(cur) : "", talks: talksAll.length, talking: !!talking, jobs: jobs.size, doc: useDoc, extra: extra.map((c) => ({ ...c })), menu: menuFor, editing });
})();
