/* Development probe (dev/rig.sh colwidth): the line between two columns of a table pulled with a REAL pointer (dev/vptr) in the
 * active mode: the pointer says it can be pulled, the columns follow while it is pulled, and let go the note says how wide they
 * are (<!-- table cols=… -->) — and the reading view shows them so. The probe says where the pointer goes (plan N). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message) + " @" + (e.error && e.error.stack || "").slice(0, 300)));
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(900); MdView.setMode("active");
    await until(() => window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active");
    await sleep(500);
    const view = MdActive.view.pm, md = () => MdActive.view.serialize(false);
    const heard = {}; for (const t of ["pointerdown", "pointerup", "mousedown", "mouseup", "dragstart", "dragend", "pointercancel"]) window.addEventListener(t, () => { heard[t] = (heard[t] || 0) + 1; }, true);
    let seenAt = null, plans = 0;
    addEventListener("mousemove", (e) => { seenAt = [e.clientX, e.clientY]; }, true);
    const run = async (cmd, last, ms) => { out("plan" + ++plans, { cmd }); const t = performance.now(); while (performance.now() - t < ms + 6000) { await sleep(40); if (seenAt && Math.hypot(seenAt[0] - last[0], seenAt[1] - last[1]) < 3 && performance.now() - t > ms) break; } await sleep(400); };
    out("plan" + ++plans, { cmd: "m 200 300 s 80 m 210 310" });
    for (let i = 0; i < 200 && !seenAt; i++) await sleep(50);
    await sleep(300);
    if (!seenAt) throw new Error("the pointer was not heard");
    const off = [210 - seenAt[0], 310 - seenAt[1]], G = (x, y) => `${Math.round(x + off[0])} ${Math.round(y + off[1])}`;
    const cells = () => [...view.dom.querySelector("table").rows[0].cells], wOf = () => cells().map((c) => Math.round(c.getBoundingClientRect().width));
    const w0 = wOf(), r0 = cells()[0].getBoundingClientRect(), edge = [r0.right - 1, r0.top + r0.height / 2];
    await run(`m ${G(edge[0] - 30, edge[1])} s 100 m ${G(...edge)}`, edge, 200);
    ok("at the line between two columns the pointer says it can be pulled", getComputedStyle(cells()[0]).cursor === "col-resize", getComputedStyle(cells()[0]).cursor);
    // (one press, one pull, one release — a pointer of its own each time the rig moves it: the press and the release go together;
    // what the columns do while it is held is looked at in its pause)
    let mid = null, changedWhile = null;
    const watching = (async () => { for (let t = 0; t < 8000 && !mid; t += 40) { await sleep(40); if (document.body.dataset.tblSizing != null && wOf()[0] > w0[0] + 25) { await sleep(120); mid = wOf(); changedWhile = /cols=/.test(md()); } } })();
    await run(`d s 120 g ${G(edge[0] + 40, edge[1])} 8 25 s 900 g ${G(edge[0] + 80, edge[1])} 8 25 s 100 u`, [edge[0] + 80, edge[1]], 1600);
    await watching;
    ok("pulled: the first column wider and the second narrower as it goes — the third as it was", !!mid && mid[0] > w0[0] + 25 && mid[1] < w0[1] - 25 && Math.abs(mid[2] - w0[2]) <= 3, [w0, mid]);
    ok("… and the note not yet changed while it is held", changedWhile === false, changedWhile);
    const after = wOf();
    ok("let go: the note says how wide they are, as shares of the table", /<!-- table cols=\d+,\d+,\d+ -->\n\| Name/.test(md()), [md().slice(0, 60), heard, (() => { let c = "none"; view.state.doc.forEach((n) => { if (n.type.name === "table") c = JSON.stringify(n.attrs.cols) + " mark=" + n.attrs.mark; }); return c; })(), MdActive.view.pm === view]);
    const cols = (/cols=(\d+),(\d+),(\d+)/.exec(md()) || []).slice(1).map(Number);
    ok("… shares that add up to the whole, the first the largest now", cols.reduce((a, b) => a + b, 0) === 100 && cols[0] > cols[1], cols);
    ok("… and it stays as wide as it was pulled, the column beside it no narrower than a little", after[0] >= mid[0] && after[0] > w0[0] + 40 && after[1] >= 36, [w0, mid, after]);
    // Ctrl+Z: as it was
    view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    ok("Ctrl+Z: the widths as they were, in one step", await until(() => !/cols=/.test(md()), 2000) && Math.abs(wOf()[0] - w0[0]) <= 3, [md().slice(0, 60), wOf(), w0]);
    view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await until(() => /cols=/.test(md()), 2000);
    MdView.setMode("read");
    await until(() => (document.body.dataset.view || "read") === "read");
    await sleep(800);
    const rc = [...document.querySelector("#content table").rows[0].cells].map((c) => Math.round(c.getBoundingClientRect().width)), tw = document.querySelector("#content table").getBoundingClientRect().width;
    ok("the reading view: the columns as wide as the note says", Math.abs(rc[0] / tw * 100 - cols[0]) < 2.5 && Math.abs(rc[2] / tw * 100 - cols[2]) < 2.5, [rc, Math.round(tw), cols]);
    if (errs.length) ok("no script errors", false, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("colwidth", o);
})();
