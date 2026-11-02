/* Development probe (dev/rig.sh board-ai): Claude draws on a whiteboard (board/claude.js) — asked from the board's own button,
 * its steps done as they come, all of them one step back; asked about what is chosen; the chat over the board, its keys its
 * own, its steps done on the board too. Run twice by the rig: on a note's new whiteboard, and on a PDF (the board over its
 * pages). The model is a fixed answer (MDVIEW_BOARD_FAKE, MDVIEW_TALK_FAKE); `real`: Claude itself. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] }, errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const REAL = !!window.__boardAiReal;
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const pdf = /\.pdf$/i.test(location.search + (window.MdView?.core?.current?.path || "")) || !!(window.MdPdf && MdPdf.shown);
  const where = pdf ? "pdf" : "note";
  try {
    await document.fonts.ready;
    await sleep(800);
    const B = () => window.MdBoard, st = () => B() && B().shown && B().state(), el = () => document.getElementById("board");
    if (pdf || (window.MdPdf && MdPdf.shown)) {
      ok("the PDF is shown", await until(() => window.MdPdf && MdPdf.shown && MdPdf.shown.pages[0].state === "done"), !!window.MdPdf);
      MdPdf.shown.bar.querySelector('[data-do="draw"]').click();
    } else {
      MdView.setMode("active");
      for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
      await sleep(300);
      MdActive.view.focus();
      MdActive.context.INSERT.board(MdActive.view.pm);
    }
    ok("the board opens", await until(() => st() && el().hasAttribute("data-ready")), st());
    await sleep(900);
    const btn = () => el().querySelector('.bd-actions [data-do="claude"]'), seen = (e) => !!e && e.getClientRects().length > 0;
    ok("the board's bar has Ask Claude, with its sign", seen(btn()) && btn().getAttribute("aria-label") === "Ask Claude" && !!btn().querySelector("svg path"), btn() && btn().outerHTML.slice(0, 120));
    // --- asked from the board's own button
    btn().click();
    const pop = () => el().querySelector(".bd-vpop"), input = () => pop().querySelector(".bd-ask-field");
    ok("its field opens under it, the keys in it", await until(() => pop().hasAttribute("data-open") && input() && document.activeElement === input(), 2000), pop().dataset.kind);
    input().value = REAL ? (pdf ? "Underline the title of the first page in red and write a short note beside it" : "Draw a little house with a tree beside it, as a quick sketch") : "Draw a house";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    ok("typed: the round button may send", !pop().querySelector(".bd-ask-send").hasAttribute("data-idle"));
    out("asking", {}); await sleep(900);
    const before = st();
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    ok("asked: the field goes, the button is Stop, the title says Claude draws", await until(() => !pop().hasAttribute("data-open") && st().claude.busy && btn().getAttribute("aria-label") === "Stop Claude" && /Claude is (thinking|drawing)/.test(st().claude.chip), 3000), st().claude);
    out("drawing", {});
    // (the fake answer comes in two halves, 200 ms apart: what came first is on the board before the rest)
    if (!REAL) ok("its steps are done as they come: the first before the answer is over", await until(() => st().things.length + st().items > before.things.length + before.items && st().claude.busy, 3000), [st().things.length, st().items]);
    // (while it draws: the strokes come one after another, the pen's tip goes with them)
    const counts = new Set(), tipSeen = { on: false };
    ok("the answer is over", await until(() => { counts.add(st().items); if (el().querySelector(".bd-claude-tip[data-on]") && st().items > before.items + 6 && !tipSeen.on) { tipSeen.on = true; out("stroking", {}); } return !st().claude.busy; }, REAL ? 300000 : 20000), st().claude);
    if (!REAL) ok("the strokes came one after another, the pen's tip with them", counts.size >= 5 && tipSeen.on, [counts.size, tipSeen.on]);
    await sleep(900);
    const after = st();
    out("drawn", {});
    o.drawn = { things: after.things.map((t) => [t.k, t.shape || "", t.text || "", t.fill || ""]), inks: after.kinds, chip: after.claude.chip };
    if (!REAL) {
      ok("the house: walls filled, a roof of ink, a sticky note moved, an arrow joined to both, words under it by hand", after.things.length === before.things.length + 3 && after.items > before.items + 10 &&
        after.things.some((t) => t.k === "shape" && t.fill === "#b5dcff") && after.things.some((t) => t.k === "sticky" && t.text === "A house" && t.x === 180) &&
        after.things.some((t) => t.k === "line" && t.from && t.to), o.drawn);
      ok("what Claude said shows in the title — it was shown the window's picture", /Here is a house, with a picture/.test(after.claude.chip), after.claude.chip);
    } else ok("Claude drew something", after.things.length + after.items > before.things.length + before.items, o.drawn);
    ok("all of it is one step back", after.undo === before.undo + 1, [before.undo, after.undo]);
    el().querySelector('[data-do="undo"]').click();
    await sleep(200);
    ok("… Undo takes it all away", st().things.length === before.things.length && st().items === before.items, [st().things.length, st().items]);
    el().querySelector('[data-do="redo"]').click();
    await sleep(200);
    ok("… and Redo brings it back", st().things.length === after.things.length && st().items === after.items, [st().things.length, st().items]);
    ok("what was drawn is kept", await until(() => !st().dirty, 4000), st().dirty);
    // --- what is chosen: the bar over it and the right button's menu ask about it
    const sticky = st().things.find((t) => t.k === "sticky");
    if (sticky) {
      B().pick([sticky.id]);
      await sleep(200);
      const fbar = el().querySelector(".bd-fbar"), ask = fbar.querySelector('[data-f="claude"]');
      ok("a thing chosen: its bar has Ask Claude", !fbar.hidden && !!ask, fbar.innerHTML.slice(0, 200));
      ask.click();
      ok("… its field says it is about what is chosen", await until(() => pop().hasAttribute("data-open") && /thing chosen/.test(pop().querySelector(".bd-ask-about")?.textContent || "") && /do with it/.test(input().placeholder), 2000), pop().innerHTML.slice(0, 300));
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      input() && input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await sleep(200);
      B().pick([]);
    }
    // --- the chat over the board
    btn().click();
    await until(() => pop().hasAttribute("data-open"), 2000);
    pop().querySelector('[data-m="ask-chat"]').click();
    const chat = () => document.getElementById("ai-chat");
    ok("Talk about it in the Chat: the chat opens over the board", await until(() => window.MdAi && MdAi.chat.open && chat() && Number(getComputedStyle(chat()).zIndex) > Number(getComputedStyle(el()).zIndex), 4000), chat() && getComputedStyle(chat()).zIndex);
    await sleep(400);
    const field = chat().querySelector(".ai-field"), kind = st().kind;
    field.focus();
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true, cancelable: true }));
    ok("a key typed in the chat is the chat's, not the board's (E: the eraser)", st().kind === kind && document.activeElement === field, [kind, st().kind, document.activeElement && document.activeElement.className]);
    const r = chat().getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + 40);
    ok("… and the chat is what is under the pointer there", !!hit && !!hit.closest("#ai-chat"), hit && hit.className);
    const had = st();
    field.value = REAL ? "Add a sun in the top right corner of what the window shows" : "Add a sticky note";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    ok("the chat's answer: its steps done on the board", await until(() => !MdAi.state().talking && st().things.length + st().items > had.things.length + had.items, REAL ? 300000 : 12000), [st().things.length, st().items]);
    await sleep(500);
    const last = MdAi.state().talk.at(-1) || {};
    ok("… the chat says so, and shows no steps as text", last.drew >= 1 && /Drawn on the whiteboard/.test(chat().querySelector(".ai-log").textContent) && !/"add"/.test(chat().querySelector(".ai-log").textContent), [last.drew, chat().querySelector(".ai-log").textContent.slice(-200)]);
    out("chat", {});
    // (the star pressed again shuts the chat; so does a press on the empty board — Henri, 2026-11-02)
    const press = (target, x, y) => { for (const type of ["pointerdown", "pointerup"]) target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerdown" ? 1 : 0 })); };
    const click = (b) => { const r = b.getBoundingClientRect(); press(b, r.left + 4, r.top + 4); b.click(); };
    click(btn());
    ok("the star pressed again shuts the chat", await until(() => !MdAi.chat.open, 2000));
    MdAi.chat.toggle();
    await until(() => MdAi.chat.open, 2000);
    press(el().querySelector(".bd-stage"), 200, 300);
    ok("a press on the empty board shuts the chat", await until(() => !MdAi.chat.open, 2000));
    click(btn());
    ok("the star opens the field", await until(() => pop().hasAttribute("data-open") && pop().dataset.kind === "ask", 2000));
    click(btn());
    ok("… and shuts it, pressed again", await until(() => !pop().hasAttribute("data-open"), 2000), pop().dataset.kind);
    click(btn());
    await until(() => pop().hasAttribute("data-open"), 2000);
    press(el().querySelector(".bd-stage"), 200, 300);
    ok("… and so does a press on the empty board", await until(() => !pop().hasAttribute("data-open"), 2000));
    ok("nothing was thrown", !errs.length, errs);
  } catch (e) {
    o.error = String((e && e.stack) || e);
  }
  out("board-ai-" + where, o);
})();
