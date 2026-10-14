/* Development probe (dev/rig.sh captions): a caption under a picture, a code block, a formula — shown as one figure in both
 * views; given from a block's menu (Add Caption: written in the dialog that opens), taken away there too. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(900);
    const content = document.getElementById("content"), figs = () => [...content.querySelectorAll("figure.fig")];
    ok("the reading view: the picture and the code block with their captions, as figures", figs().length === 2 && figs()[0].querySelector("img") && figs()[0].querySelector("figcaption").textContent === "A gradient" && figs()[1].querySelector(".code-block") && figs()[1].querySelector("figcaption").textContent === "The first line", figs().map((f) => f.outerHTML.slice(0, 80)));
    const cap = figs()[0].querySelector("figcaption"), img = figs()[0].querySelector("img");
    ok("… the caption under the thing, smaller, in the middle", cap.getBoundingClientRect().top >= img.getBoundingClientRect().bottom && getComputedStyle(cap).textAlign === "center" && parseFloat(getComputedStyle(cap).fontSize) < parseFloat(getComputedStyle(content.querySelector("p")).fontSize), [getComputedStyle(cap).textAlign, getComputedStyle(cap).fontSize]);
    out("read", {});
    await sleep(800);
    MdView.setMode("active");
    await until(() => window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active");
    await sleep(300);
    const view = MdActive.view.pm, text = () => MdActive.view.serialize(false);
    ok("the active mode: the same figures", await until(() => view.dom.querySelectorAll("figure.fig figcaption").length === 2), view.dom.querySelectorAll("figure.fig").length);
    const blockOf = (re) => { let at = null; view.state.doc.forEach((n, p) => { if (!at && n.type.name === "island" && re.test(String(n.attrs.raw))) at = { n, p }; }); return at; };
    let b = blockOf(/^\$\$/);
    let c = MdActive.islands.caption(view, b.p, b.n);
    ok("a formula without a caption: its menu offers one", !!c && !c.has);
    c.add();
    ok("Add Caption: a line under it — and the dialog open to write it in", await until(() => /\$\$\n: Caption\n/.test(text()) && document.querySelector("#dlg[data-open]"), 3000), [text().slice(-60), !!document.querySelector("#dlg[data-open]")]);
    document.querySelector("#dlg[data-open]").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(500);
    b = blockOf(/^\$\$/); c = MdActive.islands.caption(view, b.p, b.n);
    ok("… its menu now takes it away", c.has);
    c.remove(); await sleep(300);
    ok("Remove Caption: the formula alone again", /\$\$\n\nEnd\n?$/.test(text()) && !/: Caption/.test(text()), text().slice(-40));
    out("active", {});
    await sleep(600);
    if (errs.length) ok("no script errors", false, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("captions", o);
})();
