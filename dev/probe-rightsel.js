/* Development probe (dev/rig.sh rightsel): a right click on selected text, with a REAL pointer (dev/vptr). The text is
 * selected by a held left button, as a hand does it — in one block and over two —, then the right button is pressed on it.
 * What was selected stays selected as text (not the blocks it reaches, as wholes), and the menu is the one for text. The
 * probe says where the pointer is to go (plan N), the rig moves it, the probe looks at what happened. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(900); MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(400);
    const A = MdActive, view = A.view.pm, menu = document.getElementById("actmenu");
    const posOf = (text) => { let at = -1; view.state.doc.forEach((n, p) => { if (at < 0 && n.textContent.includes(text)) at = p; }); return at; };
    let seenAt = null, plans = 0;
    addEventListener("mousemove", (e) => { seenAt = [e.clientX, e.clientY, performance.now()]; }, true);
    // (the rig cannot call in: it is done when the pointer has been heard at the plan's last place, or after its time)
    const run = async (cmd, last, ms) => { out("plan" + ++plans, { cmd }); const t = performance.now(); while (performance.now() - t < ms + 6000) { await sleep(40); if (seenAt && Math.hypot(seenAt[0] - last[0], seenAt[1] - last[1]) < 3 && performance.now() - t > ms) break; } await sleep(500); };
    const heard = {}; for (const t of ["mousedown", "mouseup", "contextmenu"]) document.addEventListener(t, (e) => { heard[t] = (heard[t] || 0) + 1; }, true);
    out("plan" + ++plans, { cmd: "m 200 300 s 80 m 210 310" });
    for (let i = 0; i < 200 && !seenAt; i++) await sleep(50);
    await sleep(300);
    if (!seenAt) throw new Error("the pointer was not heard");
    const off = [210 - seenAt[0], 310 - seenAt[1]];
    o.off = off;
    const G = (x, y) => `${Math.round(x + off[0])} ${Math.round(y + off[1])}`;
    const state = () => { const s = view.state.selection, b = A.blocks.selection(view.state); return { kind: s.node ? "node" : s.empty ? "caret" : "range", from: s.from, to: s.to, blocks: b && [b.from, b.to], text: String(getSelection()) }; };
    const labels = () => [...menu.querySelectorAll(".menu-item .menu-label")].map((x) => x.textContent);
    // a point in a block's text, `at` of the way along its first line
    const spot = (text, at) => { const el = view.nodeDOM(posOf(text)), r = document.createRange(); r.selectNodeContents(el); const b = r.getClientRects()[0]; return [b.left + b.width * at, b.top + b.height / 2]; };
    // the middle of a word in a block (a double click on it selects the word)
    const wordIn = (text, word) => { const t = view.nodeDOM(posOf(text)).firstChild, i = t.textContent.indexOf(word), r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + word.length); const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
    const close = async () => { if (menu.hasAttribute("data-open")) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300); } };

    // how the text is selected: pulled with the button held, a word by a double click, the block's line by three clicks
    const pulled = (a, b) => `g ${G(...a)} 6 20 s 150 d s 120 g ${G((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)} 6 25 g ${G(...b)} 6 25 s 150 u s 200`;
    const clicks = (n) => (a) => `g ${G(...a)} 6 20 s 150` + " d s 30 u s 60".repeat(n) + " s 400";
    for (const [name, from, to, how] of [
      ["in one block", ["Filler paragraph 4 ", 0.15], ["Filler paragraph 4 ", 0.7], pulled],
      ["over two blocks", ["Filler paragraph 6 ", 0.4], ["Filler paragraph 7 ", 0.5], pulled],
      ["a word by a double click", ["Filler paragraph 8 ", "words"], ["Filler paragraph 8 ", "words"], clicks(2)],
      ["a line by three clicks", ["Filler paragraph 9 ", "words"], ["Filler paragraph 9 ", "words"], clicks(3)],
    ]) {
      view.dispatch(view.state.tr.setSelection(PM.state.Selection.atStart(view.state.doc)));
      view.nodeDOM(posOf(from[0])).scrollIntoView({ block: "center" }); await sleep(500);
      const a = typeof from[1] === "string" ? wordIn(...from) : spot(...from), b = typeof to[1] === "string" ? wordIn(...to) : spot(...to);
      await run(how(a, b), b, 600);
      const before = state();
      o[name] = { before };
      ok(`text selected ${name} with the pointer (the check's start)`, before.kind === "range" && !before.blocks && before.text.length > 2, before);
      // the right button on it, a little inside the selection
      const c = [a[0] + (b[0] - a[0]) * 0.5, a[1] + (b[1] - a[1]) * 0.5];
      const inside = from[0] === to[0] ? (a[0] === b[0] ? a : c) : spot(from[0], Math.min(0.95, from[1] + 0.2)); // (on what is selected)
      await run(`g ${G(...inside)} 4 20 s 150 rd s 80 ru s 400`, inside, 500);
      const after = state(), shown = labels();
      o[name].after = after; o[name].menu = shown;
      ok(`… a right click on it: the text stays selected, as text`, after.kind === "range" && after.from === before.from && after.to === before.to, [before, after]);
      ok(`… no block is selected as a whole`, !after.blocks && !document.querySelector(".blk-fields > *"), after);
      ok(`… the menu is the one for text`, menu.hasAttribute("data-open") && shown.includes(MdStrings.t("menu.pastePlain")) && !shown.includes(MdStrings.t("slash.duplicate")), shown);
      await close();
    }
    o.heard = heard;
  } catch (e) { o.error = String(e && e.stack || e); }
  out("rightsel", o);
})();
