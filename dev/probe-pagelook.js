/* Development probe (dev/rig.sh pagelook): a page's line turned into a card (and back) from its menu —
 * nothing else gets selected, and the note stays where it was. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(900); MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(400);
    const A = MdActive, view = A.view.pm, md = () => A.view.serialize(false);
    const rows = () => { const r = []; view.state.doc.forEach((n, p) => { if (n.type.name === "island" && MdView.core.pages.isRow(n.attrs.raw)) r.push(p); }); return r; };
    const state = () => { const s = view.state.selection; return { kind: s.node ? "node:" + s.node.type.name : s.empty ? "caret" : "range", from: s.from, to: s.to, blocks: A.blocks.selection(view.state), y: Math.round(scrollY) }; };
    const flat = (items) => items.filter(Boolean).flatMap((i) => [i, ...flat(i.items || [])]);
    const choose = async (pos, label) => { const it = flat(A.context.nodeItems(view, pos, view.state.doc.nodeAt(pos))).find((i) => i.label === label); it.run(); await sleep(500); };
    o.rows = rows().length;
    for (const [which, name] of [[0, "the first page line (text follows)"], [1, "the page line before a picture"], [2, "the last page line, far down"]]) {
      const pos = rows()[which];
      view.nodeDOM(pos).scrollIntoView({ block: "center" }); await sleep(200);
      // the caret stands somewhere else, as after a right click on the line
      const y0 = Math.round(scrollY), top0 = Math.round(view.nodeDOM(pos).getBoundingClientRect().top);
      await choose(pos, "Card");
      const s = state(), dom = view.nodeDOM(rows()[which]), top1 = Math.round(dom.getBoundingClientRect().top);
      o["s" + which] = { s, y0, top0, top1, cls: dom.querySelector(".page-row")?.dataset.style };
      ok(name + " → Card: it is a card", dom.querySelector('.page-row[data-style="card"]') && md().includes("<!-- page"), md().slice(0, 300));
      ok("… the line stays where it was on screen", Math.abs(top1 - top0) <= 2, [top0, top1, y0, s.y]);
      ok("… and nothing else is selected: no other block, no picture, no stretch of text", !s.blocks && s.kind !== "range" && !(s.kind.startsWith("node:") && s.from !== rows()[which]), s);
    }
    // ---- the same asked of Claude in the chat's Edit mode (a fixed answer: one line comes back without its id)
    PM.history.undo(view.state, view.dispatch); PM.history.undo(view.state, view.dispatch); PM.history.undo(view.state, view.dispatch);
    await sleep(300);
    scrollTo(0, 0); await sleep(200);
    const para = (() => { let at = -1; view.state.doc.forEach((n, p) => { if (at < 0 && n.textContent.includes("Text before")) at = p; }); return at; })();
    view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, para + 3)));
    const sel0 = view.state.selection.from;
    document.getElementById("ai-bubble").click();
    const chat = () => document.getElementById("ai-chat");
    for (let i = 0; i < 100 && !(chat() && chat().hasAttribute("data-open")); i++) await sleep(50);
    if (!MdAi.state().editing) chat().querySelector(".ai-mode").click();
    const f = chat().querySelector(".ai-field"); f.value = "Turn the pages into cards"; f.dispatchEvent(new Event("input", { bubbles: true }));
    chat().querySelector(".ai-send").click();
    for (let i = 0; i < 40 && !MdAi.state().talking; i++) await sleep(50);
    for (let i = 0; i < 200 && (MdAi.state().talking || !chat().querySelector(".ai-made")); i++) await sleep(50);
    await sleep(700);
    const s = state(), t = md(), file = () => MdView.core.ai.fileText();
    ok("asked of Claude in the chat: the pages are cards", /<!-- page card: Alpha/.test(t) && /<!-- page card blue: Gamma/.test(t) && /<!-- page: Beta/.test(t) && view.dom.querySelectorAll('.page-row[data-style="card"]').length === 2, t.slice(0, 200));
    ok("… and Claude wrote into a page from outside it: the line stands in Alpha, in the note's file", /<!-- page card: Alpha -->\n\nIn alpha\.\n\nA line \*\*written into the page\*\* by Claude\.\n\n<!-- \/page -->/.test(file()) && /In gamma\./.test(file()) && !/written into the page/.test(t), file().slice(0, 260));
    ok("… the note does not jump, and no text gets selected", s.kind !== "range" && !s.blocks && Math.abs(s.y) <= 2, s);
    ok("the chat says what it did, with Undo", /3 places/.test(chat().querySelector(".ai-made").textContent) && !!chat().querySelector("[data-undo]"), chat().querySelector(".ai-log").innerHTML.slice(-300));
    const changed = file();
    chat().querySelector("[data-undo]").click(); await sleep(700);
    ok("Undo takes all of it back: the file's text is as before", file() !== changed && !/page card/.test(file()) && !/written into the page/.test(file()) && /<!-- page: Alpha -->\n\nIn alpha\.\n\n<!-- \/page -->/.test(file()), file().slice(0, 200));
    // ---- a page's name, typed in the page: it is the page's without leaving the field, and stays in the field when the page is drawn anew
    {
      const v2 = MdActive.view.pm; let betaAt = -1;
      v2.state.doc.forEach((n, p2) => { if (n.type.name === "island" && /page[^:]*:\s*Beta/.test(n.attrs.raw || "")) betaAt = p2; });
      MdActive.islands.open(v2, betaAt); await sleep(700);
      const title = () => document.querySelector("#pagebar .pb-title");
      title().focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(title(), "Beta renamed"); title().dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(900);
      ok("a page's name typed in the page is the page's a moment later — the field not left", /<!-- page: Beta renamed -->/.test(file()) && document.activeElement === title(), [file().match(/<!-- page[^>]*Beta[^>]*-->/), document.activeElement && document.activeElement.className]);
      set.call(title(), "Beta renamed aga"); title().dispatchEvent(new Event("input", { bubbles: true }));
      MdView.core.ai.setFileText(file() + "\n\nA line more.\n"); // (the note drawn anew while the name is being typed)
      await sleep(200);
      ok("… and when the note is drawn anew meanwhile, what is typed stays in the field, the hand on it", title().value === "Beta renamed aga" && document.activeElement === title(), [title().value, document.activeElement && document.activeElement.className]);
      set.call(title(), "Beta renamed again"); title().dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(900);
      ok("… typed on, it is the name", /<!-- page: Beta renamed again -->/.test(file()) && /A line more\./.test(file()), file().match(/<!-- page[^>]*Beta[^>]*-->/));
    }
    if (MdAi.state().editing) chat().querySelector(".ai-mode").click();
  } catch (e) { o.error = String(e && e.stack || e); }
  out("pagelook", o);
})();
