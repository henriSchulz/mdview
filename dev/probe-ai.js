/* Development probe (dev/rig.sh ai): AI in the app — Transform with AI on selected blocks (the answer
 * replaces them, or stands under them), the chat at the lower right (what is written for the note
 * shows there first and is put in by its button), and all of it gone where it is turned off. Claude
 * is replaced by a fixed answer (MDVIEW_TALK_FAKE). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm, md = () => V.serialize(false);
    const dlg = document.getElementById("dlg"), q = (s) => dlg.querySelector(s);
    const bubble = document.getElementById("ai-bubble");
    ok("AI is on: its bubble stands at the lower right", document.body.hasAttribute("data-ai") && bubble.offsetWidth >= 40 && bubble.getBoundingClientRect().right > innerWidth - 80 && bubble.getBoundingClientRect().bottom > innerHeight - 80, [document.body.hasAttribute("data-ai"), bubble.getBoundingClientRect()]);

    if (window.__aiReal) { // (dev/rig.sh ai real: Claude itself is asked — once to transform, once in the chat)
      const pos = (() => { let at = -1; view.state.doc.forEach((n, p) => { if (at < 0 && n.textContent.includes("First paragraph")) at = p; }); return at; })();
      A.blocks.select(view, pos, false);
      MdView.core.ai.transform(view);
      await until(() => dlg.hasAttribute("data-open") && dlg.dataset.kind === "ai");
      await sleep(300);
      q(".ai-text").value = "Rewrite this sentence so that it mentions the word 'umbrella'. One sentence.";
      q('[data-go="run"]').click();
      const streamed = await until(() => ((q(".ai-stream") || {}).textContent || "").length > 3 || q(".ai-preview"), 120000);
      const done = await until(() => q(".ai-preview") && !q('[data-do="done"]').disabled, 120000);
      o.real = { streamed, transformed: q(".ai-preview") ? q(".ai-preview").textContent.slice(0, 300) : null };
      ok("Claude itself: the answer comes in pieces and is an answer to what was asked", streamed && done && /umbrella/i.test(o.real.transformed), o.real);
      q('[data-do="done"]').click();
      await sleep(400);
      ok("… and stands in the note", /umbrella/i.test(md()), md().slice(0, 200));
      bubble.click();
      const chat = () => document.getElementById("ai-chat");
      await until(() => chat() && chat().hasAttribute("data-open"));
      const field = chat().querySelector(".ai-field");
      field.value = "Which programming language is the code block in this note written in? Then write one closing sentence for the note that I can insert.";
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await until(() => MdAi.state().talking, 3000);
      const answered = await until(() => !MdAi.state().talking, 180000);
      const last = MdAi.state().talk.at(-1) || {};
      o.real.chat = String(last.text || last.error).slice(0, 500);
      ok("the chat: Claude read the note, and wrote a piece for it with its button", answered && /javascript|\bjs\b/i.test(last.text || "") && !!chat().querySelector(".ai-card [data-put]"), o.real.chat);
      out("chat", {});
      await sleep(600);
      out("ai", o);
      return;
    }
    // ---- Transform with AI: a block selected, asked with one press, the answer in its place
    const posOf = (text) => { let at = -1; view.state.doc.forEach((n, pos) => { if (at < 0 && n.textContent.includes(text)) at = pos; }); return at; };
    const first = posOf("First paragraph");
    A.blocks.select(view, first, false);
    const items = A.blocks.menuItems(view).filter(Boolean), entry = items.find((i) => /AI/.test(i.label || ""));
    ok("the menu of selected blocks begins with Transform with AI", !!entry && items[0] === entry && entry.label === "Transform with AI…", items.map((i) => i.label).slice(0, 4));
    entry.run();
    ok("its dialog opens: what to do with the blocks, asked with one press or in words", await until(() => dlg.hasAttribute("data-open") && dlg.dataset.kind === "ai") && dlg.querySelectorAll(".ai-chip").length === 13 && !!q(".ai-text") && q('[data-do="done"]').disabled, dlg.dataset.kind);
    ok("Replace is what is chosen at first; the whole note goes along as context", q('[data-where="replace"]').getAttribute("aria-checked") === "true" && q(".ai-whole").checked && q('[data-do="done"]').textContent === "Replace", q('[data-do="done"]').textContent);
    q('[data-preset="shorter"]').click();
    ok("asked: it says that Claude is writing, and what comes shows as it comes", await until(() => !!q(".ai-wait") && q('[data-go="run"]').textContent === "Stop", 2000) && await until(() => (q(".ai-stream") || {}).textContent || q(".ai-preview"), 3000), q(".ai-out") && q(".ai-out").innerHTML.slice(0, 200));
    ok("the answer shows as it will stand in the note", await until(() => q(".ai-preview") && /Made new by transform/.test(q(".ai-preview").textContent) && !!q(".ai-preview strong"), 5000) && !q('[data-do="done"]').disabled && q('[data-go="run"]').textContent === "Ask again", q(".ai-out") && q(".ai-out").innerHTML.slice(0, 300));
    out("transform", {});
    await sleep(500);
    const before = md();
    q('[data-do="done"]').click();
    await sleep(400);
    ok("Replace: the block is the answer now", !dlg.hasAttribute("data-open") && md().includes("**Made new** by transform.") && !md().includes("First paragraph") && md().includes("Second paragraph"), md().slice(0, 300));
    PM.history.undo(view.state, view.dispatch);
    ok("… one step back: the note is as it was", md() === before, md().slice(0, 200));

    // ---- Insert below, asked in words; and an answer that fails
    A.blocks.select(view, posOf("First paragraph"), false);
    MdView.core.ai.transform(view);
    await until(() => dlg.hasAttribute("data-open") && dlg.dataset.kind === "ai");
    await sleep(200);
    q('[data-where="below"]').click();
    ok("Insert below, chosen before asking: the dialog's button says so", q('[data-do="done"]').textContent === "Insert Below", q('[data-do="done"]').textContent);
    q(".ai-text").value = "please fail";
    q('[data-go="run"]').click();
    ok("what goes wrong is said, and nothing can be put in", await until(() => !!q(".ai-error"), 4000) && q('[data-do="done"]').disabled, q(".ai-out") && q(".ai-out").innerHTML.slice(0, 200));
    q(".ai-text").value = "Say it again, differently.";
    q(".ai-text").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await until(() => q(".ai-preview") && !q('[data-do="done"]').disabled, 5000);
    q('[data-do="done"]').click();
    await sleep(400);
    const at1 = md().indexOf("First paragraph"), at2 = md().indexOf("**Made new** by transform."), at3 = md().indexOf("Second paragraph");
    ok("Insert Below: the answer stands under the block, which stays", at1 >= 0 && at2 > at1 && at3 > at2, [at1, at2, at3]);

    // ---- the chat
    bubble.click();
    const chat = () => document.getElementById("ai-chat"), ai = () => window.MdAi && MdAi.state();
    ok("the bubble opens a small window at the lower right, about this note", await until(() => chat() && !chat().hidden && chat().hasAttribute("data-open")) && /m5/.test(chat().querySelector(".ai-title").textContent) && chat().getBoundingClientRect().right <= innerWidth && chat().getBoundingClientRect().bottom <= innerHeight && !!chat().querySelector(".ai-empty"), chat() && chat().outerHTML.slice(0, 200));
    await sleep(700); // (grown to its size)
    const w0 = chat().getBoundingClientRect().width;
    chat().querySelector('[data-do="size"]').click(); await sleep(500);
    const w1 = chat().getBoundingClientRect().width;
    chat().querySelector('[data-do="size"]').click(); await sleep(500);
    const w2 = chat().getBoundingClientRect().width;
    chat().querySelector('[data-do="size"]').click(); await sleep(1100);
    ok("its size goes through three: medium, large, small — and round again", w1 > w0 + 100 && w2 < w0 - 30 && Math.abs(chat().getBoundingClientRect().width - w0) < 2 && ai().size === "m", [w0, w1, w2]);
    const field = chat().querySelector(".ai-field");
    field.value = "Write a short closing line for this note.";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    ok("asked: the question stands there, and Claude's answer comes", await until(() => chat().querySelectorAll(".ai-user").length === 1 && ai().talking, 2000), ai());
    ok("what it wrote for the note shows as a card, with Insert into Document", await until(() => !ai().talking && chat().querySelector(".ai-card [data-put]"), 5000) && /Here it is/.test(chat().querySelector(".ai-bot .ai-md").textContent) && /Written by chat for the note/.test(chat().querySelector(".ai-card .ai-md").textContent) && !chat().querySelector(".ai-bot").textContent.includes("<insert>"), chat().querySelector(".ai-log").innerHTML.slice(0, 500));
    out("chat", {});
    await sleep(500);
    // nothing chosen in the note: it goes to the note's end
    view.dispatch(view.state.tr.setSelection(PM.state.Selection.atStart(view.state.doc)));
    chat().querySelector(".ai-card [data-put]").click();
    await sleep(500);
    ok("Insert into Document: the piece stands at the note's end", md().trimEnd().endsWith("*Written by chat* for the note."), md().slice(-120));
    // a block selected: under that one
    A.blocks.select(view, posOf("Second paragraph"), false);
    chat().querySelector(".ai-card [data-put]").click();
    await sleep(500);
    const s2 = md().indexOf("Second paragraph"), p2 = md().indexOf("*Written by chat* for the note.");
    ok("… with a block selected: under that block", p2 > s2 && p2 < md().lastIndexOf("*Written by chat* for the note."), [s2, p2]);
    chat().querySelector('[data-do="fresh"]').click();
    ok("New Chat: the talk begins anew", ai().talk.length === 0 && !!chat().querySelector(".ai-empty"), ai());

    ok("while AI is on, the “/” menu offers a graphic by Claude", A.slash.entries(view).flatMap((g) => (!g ? [] : g.items ? g.items.filter(Boolean) : [g])).some((e) => e.key === "menu.graphic"), "");
    // ---- turned off in the settings: nothing of it anywhere
    window.MdPrefs = { ...window.MdPrefs, aiOn: false };
    MdView.core.post("prefs", { prefs: { aiOn: false } });
    MdView.prefsChanged();
    await sleep(400);
    A.blocks.select(view, posOf("Second paragraph"), false);
    const labels = (list) => list.filter(Boolean).flatMap((i) => [i.label, ...(i.items || []).filter(Boolean).map((x) => x.label)]);
    const slash = A.slash.entries(view).flatMap((g) => (!g ? [] : g.items ? g.items.filter(Boolean) : [g])).map((e) => e.key);
    ok("AI off: no bubble, the chat is shut", !document.body.hasAttribute("data-ai") && bubble.offsetWidth === 0 && chat().hidden, [bubble.offsetWidth, chat().hidden]);
    ok("… no Transform with AI in the menus, no graphic by Claude in the “/” menu or a right click", !labels(A.blocks.menuItems(view)).some((l) => /AI|Claude/.test(l || "")) && !labels(A.context.textItems(view, 1)).some((l) => /AI|Claude/.test(l || "")) && !slash.includes("menu.graphic") && slash.includes("menu.board"), [labels(A.blocks.menuItems(view)).slice(0, 3), slash.filter((k) => /graphic|board/.test(k))]);
    ok("… and the panel's tile for it is gone", [...document.querySelectorAll("[data-needs-ai]")].every((e) => e.offsetWidth === 0), document.querySelectorAll("[data-needs-ai]").length);
    let refused = null;
    const was = MdAi.done;
    MdAi.done = (id, text, error) => { refused = [text, error]; };
    MdView.core.post("ai-ask", { id: "x1", channel: "chat", note: "n", messages: [{ role: "user", text: "hello" }] });
    ok("… the application itself answers nothing while it is off", await until(() => refused && refused[0] == null && /turned off/.test(refused[1]), 3000), refused);
    MdAi.done = was;
    window.MdPrefs = { ...window.MdPrefs, aiOn: true };
    MdView.core.post("prefs", { prefs: { aiOn: true } });
    MdView.prefsChanged();
    await sleep(300);
    ok("turned on again: the bubble is back", document.body.hasAttribute("data-ai") && bubble.offsetWidth >= 40, bubble.offsetWidth);
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  out("ai", o);
})();
