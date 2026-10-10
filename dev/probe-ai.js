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
      if (window.__aiEdit) { // (dev/rig.sh ai edit: Claude itself changes the note from the chat)
        dlg.querySelector('[data-do="cancel"]')?.click(); await sleep(300);
        bubble.click();
        const chat = () => document.getElementById("ai-chat");
        await until(() => chat() && chat().hasAttribute("data-open"));
        if (!MdAi.state().editing) chat().querySelector(".ai-mode").click();
        const field = chat().querySelector(".ai-field");
        field.value = "Rename the table column Qty to Quantity, add a row for pears with 7, turn the code block into Python, delete filler paragraphs 2 and 3, and add a short heading 'Summary' with one sentence at the very end.";
        field.dispatchEvent(new Event("input", { bubbles: true }));
        chat().querySelector(".ai-send").click();
        await until(() => MdAi.state().talking, 3000);
        const answered = await until(() => !MdAi.state().talking, 240000);
        await sleep(500);
        const last = MdAi.state().talk.at(-1) || {}, t = md();
        o.real = { made: last.made, said: String(last.text || last.error).slice(0, 300), note: t.slice(0, 500), end: t.slice(-200) };
        ok("Claude itself changes the note: the column, a row, the code, paragraphs gone, a heading at the end", answered && last.made && last.made.done >= 4 && !last.made.missed.length && /Quantity/.test(t) && /pear/i.test(t) && /```python/.test(t) && !/Filler paragraph 2 /.test(t) && !/Filler paragraph 3 /.test(t) && /Filler paragraph 4 /.test(t) && /#+ Summary/.test(t.slice(-300)) && /First paragraph with plain words/.test(t), o.real);
        out("transform", {}); out("chat", {}); out("menu", {}); out("edit", {});
        await sleep(1200);
        out("ai", o);
        return;
      }
      if (window.__aiDraw) { // (dev/rig.sh ai draw: a drawing is asked for, and looked at)
        q(".ai-text").value = "Draw a simple diagram of an RC low-pass filter (resistor, capacitor, input, output, ground) and put a one-line caption under it.";
        q('[data-go="run"]').click();
        const done = await until(() => q(".ai-preview") && !q('[data-do="done"]').disabled, 240000);
        await sleep(1500);
        const pic = q(".ai-preview .svg-block > svg, .ai-preview .mermaid-block svg"), r = pic && pic.getBoundingClientRect();
        o.real = { text: MdAi && q(".ai-preview").innerHTML.slice(0, 400) };
        ok("Claude itself, asked for a drawing: a picture shows in the preview", done && !!pic && r.width > 100 && r.height > 50, [r && [r.width, r.height], o.real.text]);
        out("transform", {});
        await sleep(1500);
        q('[data-do="done"]').click();
        await sleep(600);
        ok("… and stands in the note as an svg fence", /```svg\n<svg/.test(md()) || /```mermaid/.test(md()), md().slice(0, 300));
        out("chat", {}); out("menu", {}); out("edit", {}); out("ai", o);
        return;
      }
      q(".ai-text").value = "Mention the word 'umbrella'.";
      q('[data-preset="longer"]').click();
      const streamed = await until(() => ((q(".ai-stream") || {}).textContent || "").length > 3 || q(".ai-preview"), 120000);
      const done = await until(() => q(".ai-preview") && !q('[data-do="done"]').disabled, 120000);
      o.real = { streamed, transformed: q(".ai-preview") ? q(".ai-preview").textContent.slice(0, 2000) : null };
      ok("Claude itself, asked with Longer and a word of one's own: the answer comes in pieces, is longer, and has the word", streamed && done && /umbrella/i.test(o.real.transformed) && o.real.transformed.length > 80, o.real);
      q('[data-do="done"]').click();
      await sleep(400);
      ok("… and stands in the note", /umbrella/i.test(md()), md().slice(0, 200));
      bubble.click();
      const chat = () => document.getElementById("ai-chat");
      await until(() => chat() && chat().hasAttribute("data-open"));
      const field = chat().querySelector(".ai-field");
      field.value = "Which programming language is the code block in this note written in? Then write one closing sentence for the note that I can insert.";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      chat().querySelector(".ai-send").click();
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
    ok("its dialog opens: what to do with the blocks, asked with one press or in words", await until(() => dlg.hasAttribute("data-open") && dlg.dataset.kind === "ai") && dlg.querySelectorAll(".ai-chip[data-preset]").length === 5 && !!q('.ai-more[data-menu="more"]') && !!q(".ai-text") && q('[data-do="done"]').disabled, dlg.dataset.kind);
    ok("a small sheet, whatever size the dialogs were pulled to; Replace is pale until there is an answer", dlg.offsetWidth <= 540 && getComputedStyle(q('[data-do="done"]')).opacity < 0.6, [dlg.offsetWidth, getComputedStyle(q('[data-do="done"]')).opacity]);
    q('[data-menu="more"]').click();
    ok("More opens the rest of what is asked with one press, under it, inside the window", dlg.querySelector(".ai-tmenu").hasAttribute("data-open") && dlg.querySelectorAll(".ai-tmenu .ai-row[data-preset]").length === 8 && dlg.querySelector(".ai-tmenu").getBoundingClientRect().top >= q('[data-menu="more"]').getBoundingClientRect().bottom && document.activeElement === dlg.querySelector(".ai-tmenu .ai-row"), dlg.querySelector(".ai-tmenu").outerHTML.slice(0, 200));
    dlg.querySelector(".ai-tmenu .ai-row").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    ok("… Esc shuts the menu, not the sheet; shut, its rows are out of the keys' way", !dlg.querySelector(".ai-tmenu").hasAttribute("data-open") && dlg.hasAttribute("data-open") && document.activeElement === q('[data-menu="more"]') && [...dlg.querySelectorAll(".ai-tmenu .ai-row")].every((r) => r.disabled), document.activeElement && document.activeElement.className);
    ok("Replace is what is chosen at first; the whole note goes along as context", q('[data-menu="where"]').dataset.value === "replace" && /replaces the selection/.test(q('[data-menu="where"]').textContent) && q('[data-menu="context"]').dataset.value === "whole" && q('[data-do="done"]').textContent === "Replace", q('[data-do="done"]').textContent);
    q('[data-preset="shorter"]').click();
    ok("a press marks what is asked; the field stays for one's own words", q('[data-preset="shorter"]').getAttribute("aria-pressed") === "true" && q(".ai-text").value === "", q(".ai-text").value);
    ok("asked: it says that Claude is writing, and what comes shows as it comes", await until(() => !!q(".ai-wait") && q('[data-go="run"]').getAttribute("aria-label") === "Stop", 2000) && await until(() => (q(".ai-stream") || {}).textContent || q(".ai-preview"), 3000), q(".ai-out") && q(".ai-out").innerHTML.slice(0, 200));
    ok("the answer shows as it will stand in the note", await until(() => q(".ai-preview") && /Made new by transform/.test(q(".ai-preview").textContent) && !!q(".ai-preview strong"), 5000) && !q('[data-do="done"]').disabled && q('[data-go="run"]').getAttribute("aria-label") === "Ask again", q(".ai-out") && q(".ai-out").innerHTML.slice(0, 300));
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
    q('[data-menu="where"]').click();
    dlg.querySelector('.ai-tmenu [data-where="below"]').click();
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

    { // (what Claude writes is shown as the reading view shows it: a formula in a table too)
      const d = document.createElement("div"); d.innerHTML = MdView.core.mdHtml("| a | b |\n|---|---|\n| $E=mc^2$ | x |\n\nInline $a^2$.\n\n$$\\int_0^1 x\\,dx$$\n");
      ok("formulas are set in the answers — in a table's cell, in a line, on their own", d.querySelectorAll("table .katex").length === 1 && d.querySelectorAll(".katex").length >= 3, d.innerHTML.slice(0, 600));
    }
    { // a drawing: an svg fence is the picture — and so is an <svg> written bare, empty lines in it and all
      const d = document.createElement("div"); d.className = "ai-md"; document.body.appendChild(d);
      MdView.core.mdInto(d, "Text.\n\n```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 100\" width=\"200\"><rect width=\"200\" height=\"100\" fill=\"red\"/></svg>\n```\n\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 100\" width=\"300\">\n\n  <circle cx=\"50\" cy=\"50\" r=\"40\"/>\n\n  <text x=\"120\" y=\"55\">Label</text>\n</svg>\n\nMore text.");
      const pics = [...d.querySelectorAll(".svg-block > svg")].map((x) => Math.round(x.getBoundingClientRect().width));
      ok("drawings show as pictures in what Claude wrote: fenced, and written bare", pics.join() === "200,300" && !!d.querySelector(".svg-block circle") && !!d.querySelector(".svg-block text") && !/&lt;svg|<pre/.test(d.innerHTML), [pics, d.innerHTML.slice(0, 500)]);
      d.remove();
    }
    // ---- the chat
    MdView.core.post("folder", { here: true }); // (the note's folder, as the toolbar's button opens it)
    await until(() => MdView.core.folderNotes().length >= 2, 5000);
    bubble.click();
    const chat = () => document.getElementById("ai-chat"), ai = () => window.MdAi && MdAi.state(), cq = (sel) => chat().querySelector(sel);
    ok("the bubble opens a window at the lower right: a new chat, the note on screen as what it reads", await until(() => chat() && !chat().hidden && chat().hasAttribute("data-open")) && cq(".ai-title-text").textContent === "New Chat" && chat().getBoundingClientRect().right <= innerWidth && chat().getBoundingClientRect().bottom <= innerHeight && cq('.ai-ctx [data-ctx="doc"] b').textContent === "m5" && cq('.ai-ctx [data-ctx="doc"] small').textContent === "Current Document", chat() && cq(".ai-ctx").innerHTML.slice(0, 300));
    await sleep(600);
    // its size: three to choose in its menu, and pulled at its edge
    const pick = async (sel) => { cq('.ai-head .ai-ib[data-do="more"]').click(); await sleep(250); cq(".ai-menu " + sel).click(); await sleep(250); };
    const w0 = ai().width;
    await pick('[data-size="l"]'); const w1 = ai().width;
    await pick('[data-size="s"]'); const w2 = ai().width, h2 = ai().height;
    ok("its size, chosen in its menu: large, small", w1 === 640 && w2 === 340 && h2 === 480 && w0 === 420, [w0, w1, w2, h2]);
    const grip = cq('[data-grip="corner"]'), g = grip.getBoundingClientRect(), pe = (type, x, y) => grip.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y }));
    pe("pointerdown", g.left + 4, g.top + 4); pe("pointermove", g.left - 76, g.top - 56); pe("pointerup", g.left - 76, g.top - 56);
    ok("… and pulled at its corner: wider and higher by as much", ai().width === 420 && ai().height === 540, [ai().width, ai().height]);
    await pick('[data-size="m"]');
    // what it reads: another note of the folder, the whole folder; taken away again
    cq('[data-do="add"]').click(); await sleep(250);
    ok("+ offers a note of the folder, the whole folder, a file of this computer", [...chat().querySelectorAll(".ai-menu .ai-row")].map((b) => b.dataset.m).join() === "note,folder,file", cq(".ai-menu").innerHTML.slice(0, 300));
    cq('.ai-menu [data-m="note"]').click(); await sleep(300);
    const find = cq(".ai-find"); find.value = "other"; find.dispatchEvent(new Event("input", { bubbles: true })); await sleep(100);
    ok("a note of the folder is found by its name", chat().querySelectorAll(".ai-found [data-note]").length === 1 && cq(".ai-found [data-note] b").textContent === "other", cq(".ai-found").innerHTML.slice(0, 300));
    cq(".ai-found [data-note]").click(); await sleep(200);
    cq('[data-do="add"]').click(); await sleep(250); cq('.ai-menu [data-m="folder"]').click(); await sleep(200);
    ok("both stand above the field beside the current document", ai().extra.map((c) => c.kind).join() === "note,folder" && chat().querySelectorAll(".ai-ctx .ai-doc").length === 3, ai().extra);
    cq('.ai-ctx [data-ctx="1"] .ai-doc-x').click(); await sleep(100);
    ok("… and one is taken away by its ×", ai().extra.length === 1 && ai().extra[0].name === "other", ai().extra);
    { // a press into the field is the field's: it is no pull of a rectangle over blocks, and what is typed goes there
      const f = cq(".ai-field"), r = f.getBoundingClientRect(), down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: r.left + 20, clientY: r.top + 8 });
      const kept = f.dispatchEvent(down);
      f.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, clientX: r.left + 20, clientY: r.top + 8 }));
      f.focus();
      const typed = f.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
      ok("a press into the chat's field is the field's own, and so is what is typed there", kept && typed && document.activeElement === f, [kept, typed, document.activeElement && document.activeElement.className]);
    }
    const field = cq(".ai-field");
    field.value = "Write a short closing line for this note.";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    ok("asked: the question stands there with what it was given to read, and Claude is at it", await until(() => chat().querySelectorAll(".ai-user").length === 1 && ai().talking, 2000) && chat().querySelectorAll(".ai-user .ai-doc").length === 2 && cq(".ai-send").title === "Stop", ai());
    const firstMsg = cq(".ai-user");
    ok("what it wrote for the note shows as a card, with Insert into Document", await until(() => !ai().talking && cq(".ai-card [data-put]"), 5000) && /Here it is/.test(cq(".ai-bot .ai-md").textContent) && /Written by chat for the note/.test(cq(".ai-card .ai-md").textContent) && !cq(".ai-bot").textContent.includes("<insert>"), cq(".ai-log").innerHTML.slice(0, 500));
    ok("the other note went to Claude with the question (the application read it)", /Seen: other note text/.test(cq(".ai-bot").textContent), cq(".ai-bot").textContent.slice(0, 200));
    ok("the conversation is named after its first question", cq(".ai-title-text").textContent.startsWith("Write a short closing line") && ai().talks === 1, cq(".ai-title-text").textContent);
    { const pic = cq(".ai-card .svg-block > svg"), r = pic && pic.getBoundingClientRect();
      ok("a drawing in the chat is a picture at its own size, in its own colours (not an icon of the window)", !!pic && Math.round(r.width) === 120 && getComputedStyle(pic.querySelector("rect")).fill !== "none", pic && [r.width, getComputedStyle(pic.querySelector("rect")).fill]); }
    out("chat", {});
    await sleep(600);
    // nothing chosen in the note: it goes to the note's end
    view.dispatch(view.state.tr.setSelection(PM.state.Selection.atStart(view.state.doc)));
    cq(".ai-card [data-put]").click();
    await sleep(500);
    ok("Insert into Document: the piece stands at the note's end", md().trimEnd().endsWith("*Written by chat* for the note."), md().slice(-120));
    // a block selected: under that one
    A.blocks.select(view, posOf("Second paragraph"), false);
    cq(".ai-card [data-put]").click();
    await sleep(500);
    const s2 = md().indexOf("Second paragraph"), p2 = md().indexOf("*Written by chat* for the note.");
    ok("… with a block selected: under that block", p2 > s2 && p2 < md().lastIndexOf("*Written by chat* for the note."), [s2, p2]);
    cq('[data-do="fresh"]').click(); await sleep(150);
    ok("New Chat: a conversation begins anew, the earlier one is kept", ai().talk.length === 0 && cq(".ai-title-text").textContent === "New Chat" && ai().talks === 1 && JSON.parse(localStorage.getItem("mdview:ai-talks")).length === 1, ai());
    cq('.ai-head .ai-ib[data-do="more"]').click(); await sleep(250);
    out("menu", {});
    await sleep(600);
    cq(".ai-menu [data-talk]").click(); await sleep(200);
    ok("… and taken up again from the conversation history", ai().talk.length === 2 && !!cq(".ai-card [data-put]"), ai().talk.length);
    await pick('[data-m="delete"]');
    ok("Delete takes the conversation away", ai().talks === 0 && ai().talk.length === 0, ai().talks);

    { // the wheel over the chat does not move the note behind it
      const y0 = scrollY, w = new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true });
      const went = cq(".ai-compose").dispatchEvent(w), w2 = new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true });
      const went2 = cq(".ai-log").dispatchEvent(w2);
      ok("the wheel over the chat is the chat's: the note behind it is not scrolled", !went && w.defaultPrevented && !went2 && scrollY === y0, [went, went2, y0, scrollY]);
    }
    // ---- the Edit mode: what Claude answers changes the note itself
    ok("the chat asks, at first; its button turns to Edit", cq(".ai-mode").textContent === "Ask" && !ai().editing, cq(".ai-mode").textContent);
    cq(".ai-mode").click(); await sleep(150);
    ok("Edit: the button says so, and the field asks what to change", ai().editing && cq(".ai-mode").textContent === "Edit" && cq(".ai-mode").getAttribute("aria-pressed") === "true" && /change/.test(cq(".ai-field").placeholder), cq(".ai-field").placeholder);
    const beforeEdit = md();
    cq(".ai-field").value = "Shorten the second paragraph and fix the table.";
    cq(".ai-field").dispatchEvent(new Event("input", { bubbles: true }));
    cq(".ai-send").click();
    await until(() => ai().talking, 2000);
    const spin = cq(".ai-pill .ai-spin"), seen = new Set(), redrawn = new Set();
    while (ai().talking) { if (!cq(".ai-pill").hidden) seen.add(cq(".ai-pill-text").textContent.replace(/\d+/, "N")); redrawn.add(cq(".ai-bot[data-live]")); await sleep(20); }
    ok("while a change is written, one sign says so — its circle is the same one all along, turning on", cq(".ai-pill .ai-spin") === spin && seen.has("Writing change N …") && getComputedStyle(spin).animationName === "ai-spin" && cq(".ai-pill").hidden, [...seen]);
    await until(() => !ai().talking && cq(".ai-made"), 6000);
    o.edit = ai().talk.at(-1);
    await sleep(300);
    const after = md();
    ok("its edits are carried out in the note: a paragraph, a row of the table, a line at the end", after.includes("Second paragraph, **edited**.") && !after.includes("Second paragraph for the bar") && /\| pear\s*\|\s*7 \|/.test(after) && !/apple/.test(after) && after.trimEnd().endsWith("Added at the end by edit.") && after.includes("# Polish") && after.includes("let a = 1;"), after.slice(0, 400) + " … " + after.slice(-80));
    ok("the chat says what it did — three places changed, one passage not found — and shows no edit as text", /3 places/.test(cq(".ai-made").textContent) && /Not found/.test(cq(".ai-missed").textContent) && /stands nowhere/.test(cq(".ai-missed code").textContent) && !/<find>|<edit>|Never\./.test(cq(".ai-log").textContent) && /I shorten the second paragraph/.test(cq(".ai-bot .ai-md").textContent), cq(".ai-log").innerHTML.slice(-600));
    out("edit", {});
    await sleep(600);
    cq("[data-undo]").click(); await sleep(300);
    ok("Undo in the chat takes all of them back in one step", md() === beforeEdit && !cq("[data-undo]") && /Nothing in the note/.test(cq(".ai-made").textContent), md().slice(0, 200));
    cq(".ai-mode").click(); await sleep(150);
    ok("turned back to Ask", !ai().editing && localStorage.getItem("mdview:ai-edit") === "0", ai().editing);

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
    // ---- each document has its own conversation
    bubble.click(); await sleep(500);
    cq(".ai-field").value = "A question about this note."; cq(".ai-field").dispatchEvent(new Event("input", { bubbles: true })); cq(".ai-send").click();
    await until(() => ai().talking, 2000); await until(() => !ai().talking, 6000); await sleep(200);
    const mine = ai().talk.length, row = (name) => [...document.querySelectorAll("#sidebar *")].find((e) => !e.children.length && e.textContent.trim() === name);
    row("other").click();
    ok("another document opened: the assistant shows a new chat, about that document", await until(() => ai().talk.length === 0 && cq(".ai-title-text").textContent === "New Chat" && (cq('.ai-ctx [data-ctx="doc"] b') || {}).textContent === "other", 5000) && mine >= 2, [mine, ai().talk.length, cq(".ai-ctx").textContent]);
    row("m5").click();
    ok("back on the first document: its conversation is there again", await until(() => ai().talk.length === mine && (cq('.ai-ctx [data-ctx="doc"] b') || {}).textContent === "m5", 5000), [mine, ai().talk.length]);
    cq('[data-do="close"]').click(); await sleep(400);
    row("other").click(); await sleep(900);
    bubble.click(); await sleep(500);
    ok("the assistant opened on a document: that document's own chat — here the new one", ai().open && ai().talk.length === 0 && (cq('.ai-ctx [data-ctx="doc"] b') || {}).textContent === "other", [ai().talk.length, cq(".ai-ctx").textContent]);
    row("m5").click(); await sleep(900); // (the report is named after the note on screen)
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  out("ai", o);
})();
