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
  } catch (e) { o.error = String(e && e.stack || e); }
  window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name: "adjust", text: JSON.stringify(o) }));
})();
