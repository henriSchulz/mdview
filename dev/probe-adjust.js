/* Development probe (dev/rig.sh adjust): the region of a PDF embed, adjusted in its dialog — the
 * whole page with a frame, moved and pulled with the real pointer, written back as page= and rect=. */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (type, data = {}) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type, ...data }));
  const at = (kind, x, y) => post("probe-pointer", { kind, x, y });
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const until = async (f, n = 100) => { for (let i = 0; i < n && !f(); i++) await sleep(50); return f(); };
  try {
    await document.fonts.ready;
    await sleep(900);
    // how large pictures and embeds show, in the reading view
    MdView.setMode("read"); await sleep(500);
    {
      const c = document.getElementById("content"), col = c.getBoundingClientRect(), pad = parseFloat(getComputedStyle(c).paddingLeft);
      await until(() => c.querySelector(".pdf-embed.ready"));
      const e = c.querySelector(".pdf-embed").getBoundingClientRect(), small = c.querySelector('img[alt="a photo"]'), full = c.querySelector("img.embed.full");
      ok("an embedded PDF region stands in the middle of the column", Math.abs((e.left + e.right) / 2 - (col.left + col.right) / 2) < 2 && e.width < col.width - 2 * pad - 20, [e.left, e.right, col.left, col.right]);
      ok("![a photo|240](…): 240 wide, the size is not part of its description", !!small && Math.round(small.getBoundingClientRect().width) === 240);
      ok("![[photo.png|full]]: as wide as the text column", !!full && Math.abs(full.getBoundingClientRect().width - (col.width - 2 * pad)) < 2, full && full.getBoundingClientRect().width);
    }
    MdView.setMode("active");
    await until(() => window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active", 300);
    await sleep(600);
    const A = MdActive, view = A.view.pm, dlg = document.getElementById("dlg");
    let pos = -1; view.state.doc.forEach((n, p) => { if (pos < 0 && n.type.name === "island" && /paper\.pdf/.test(n.attrs.raw)) pos = p; });
    ok("an embed on a line of its own is a block with a dialog", pos >= 0);
    A.islands.open(view, pos);
    await until(() => dlg.hasAttribute("data-open") && dlg.querySelector(".dlg-preview .pdf-embed.ready"));
    const ed = dlg.querySelector(".ce-in"), btn = () => [...dlg.querySelectorAll(".dlg-tools .btn")].find((b) => /Adjust|Show Result/.test(b.textContent));
    ok("the dialog of a PDF region has Adjust Region", !!btn() && !btn().hidden && btn().textContent === "Adjust Region", dlg.querySelector(".dlg-tools").textContent);
    // the size, chosen in the dialog
    {
      const sel = dlg.querySelector(".dlg-tools select"), pop = dlg.querySelector(".dlg-tools .pop"), pv = dlg.querySelector(".dlg-preview");
      ok("the dialog offers the size: its own, three widths, the full one", !!sel && !pop.parentNode.hidden && [...sel.options].map((x) => x.value).join() === ",240,400,640,full" && pop.textContent.trim() === "Its own size", sel && [...sel.options].map((x) => x.value).join());
      sel.value = "full"; sel.dispatchEvent(new Event("change"));
      await until(() => pv.querySelector(".pdf-embed.full.ready"));
      const w = pv.querySelector(".pdf-embed.full")?.getBoundingClientRect().width || 0;
      ok("Full width: written as |full, the embed fills the width", /rect=60,600,420,790\|full\]\]/.test(ed.value) && w > pv.clientWidth - 40, [ed.value, w, pv.clientWidth]);
      sel.value = "240"; sel.dispatchEvent(new Event("change"));
      await until(() => /\|240\]\]/.test(ed.value) && pv.querySelector(".pdf-embed.ready") && Math.abs(pv.querySelector(".pdf-embed.ready").getBoundingClientRect().width - 240) < 3);
      ok("Small: |240, 240 wide", /\|240\]\]/.test(ed.value) && Math.abs(pv.querySelector(".pdf-embed").getBoundingClientRect().width - 240) < 3, [ed.value, pv.querySelector(".pdf-embed").getBoundingClientRect().width]);
      sel.value = ""; sel.dispatchEvent(new Event("change"));
      await until(() => !/\|/.test(ed.value) && pv.querySelector(".pdf-embed.ready"));
      ok("its own size again: nothing written", ed.value.trim() === "![[paper.pdf#page=3&rect=60,600,420,790]]", ed.value);
      await sleep(400);
    }
    btn().click();
    await until(() => dlg.querySelector(".pa-sheet img"));
    await sleep(500);
    const sheet = dlg.querySelector(".pa-sheet"), frame = dlg.querySelector(".pa-frame");
    // (the sheet and the frame are asked for anew each time: another page is another sheet)
    const fr = () => { const s = dlg.querySelector(".pa-sheet").getBoundingClientRect(), f = dlg.querySelector(".pa-frame").getBoundingClientRect(); return [(f.left - s.left) / s.width, (f.top - s.top) / s.height, f.width / s.width, f.height / s.height]; };
    const b0 = fr();
    ok("the whole page shows, with a frame where the region is", sheet.getBoundingClientRect().width > 300 && b0[2] > 0.4 && b0[2] < 0.8 && b0[3] > 0.1 && b0[3] < 0.4 && /Page 3 of 6/.test(dlg.querySelector(".pa-page").textContent), [b0, dlg.querySelector(".pa-page").textContent]);
    frame.scrollIntoView({ block: "center" }); await sleep(300); // (on screen, for the pointer)
    const drag = async (x0, y0, x1, y1) => { at("move", x0, y0); await sleep(120); at("down", x0, y0); await sleep(80); at("move", (x0 + x1) / 2, (y0 + y1) / 2); await sleep(80); at("move", x1, y1); await sleep(120); at("up", x1, y1); await sleep(450); };
    const text0 = ed.value;
    let f = frame.getBoundingClientRect();
    await drag(f.right, f.bottom, f.right - 60, f.bottom - 20); // its lower right corner, inwards
    const b1 = fr(), rect = (t) => (/rect=([\d,.-]+)/.exec(t) || [])[1];
    ok("its corner pulled inwards: the frame is smaller, the text has the new region", b1[2] < b0[2] - 0.03 && b1[3] < b0[3] - 0.01 && Math.abs(b1[0] - b0[0]) < 0.005 && rect(ed.value) !== rect(text0) && /page=3&rect=\d+,\d+,\d+,\d+\]\]/.test(ed.value), [b0, b1, ed.value]);
    const r1 = rect(ed.value).split(",").map(Number), r0 = rect(text0).split(",").map(Number);
    ok("in the PDF's points: the left and the top edge stayed, the right and the lower one moved", Math.abs(r1[0] - r0[0]) <= 1 && Math.abs(r1[3] - r0[3]) <= 1 && r1[2] < r0[2] - 10 && r1[1] > r0[1] + 3, [r0, r1]);
    f = frame.getBoundingClientRect();
    await drag(f.left + f.width / 2, f.top + f.height / 2, f.left + f.width / 2 + 30, f.top + f.height / 2 + 40); // the frame itself
    const b2 = fr();
    ok("the frame moved keeps its size", Math.abs(b2[2] - b1[2]) < 0.004 && Math.abs(b2[3] - b1[3]) < 0.004 && b2[0] > b1[0] + 0.02 && b2[1] > b1[1] + 0.02, [b1, b2]);
    dlg.querySelector('.pa-bar .btn[aria-label="Next page"]').click();
    await until(() => /Page 4 of 6/.test(dlg.querySelector(".pa-page")?.textContent || ""));
    await sleep(400);
    ok("the next page: the text says page 4, the frame stays where it was", /page=4&rect=/.test(ed.value) && Math.abs(fr()[0] - b2[0]) < 0.01, ed.value);
    window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name: "shot-adjust", text: "{}" })); await sleep(1500);
    btn().click();
    await until(() => dlg.querySelector(".dlg-preview .pdf-embed.ready"));
    ok("Show Result: the embed as the note will show it", !!dlg.querySelector(".dlg-preview .pdf-embed.ready") && !dlg.querySelector(".pa-sheet") && btn().textContent === "Adjust Region");
    const want = ed.value;
    dlg.querySelector('[data-do="done"]').click(); await sleep(700);
    ok("Done writes it into the note", A.view.serialize(false).includes(want.trim()) && /page=4&rect=/.test(want), A.view.serialize(false).slice(0, 160));
    // a picture in a line: its popover has the size too
    {
      const img = view.dom.querySelector('img[alt="a photo"]');
      ok("the active mode shows the picture at its width as well", !!img && Math.round(img.getBoundingClientRect().width) === 240, img && img.getBoundingClientRect().width);
      let ipos = -1; view.state.doc.descendants((n, p) => { if (ipos < 0 && n.type.name === "image") ipos = p; });
      view.dispatch(view.state.tr.setSelection(PM.state.NodeSelection.create(view.state.doc, ipos)));
      view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await sleep(500);
      const pop = document.getElementById("atompop"), sel = pop.querySelector("select");
      ok("its popover: the description without the size, the size as a choice", pop.hasAttribute("data-open") && pop.querySelector('[data-key="alt"]').value === "a photo" && !!sel && sel.value === "240", pop.textContent);
      sel.value = "full"; sel.dispatchEvent(new Event("change"));
      pop.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await sleep(500);
      ok("Full width chosen there is written into the description's end", A.view.serialize(false).includes("![a photo|full](photo.png)"), A.view.serialize(false));
    }
  } catch (e) { o.error = String(e && e.stack || e); }
  window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name: "adjust", text: JSON.stringify(o) }));
})();
