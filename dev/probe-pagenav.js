/* Development probe (dev/rig.sh pagenav): back and forward among the pages of a note — the two
 * buttons before the way over a page, and Alt+← / Alt+→. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(900);
    const bar = () => document.getElementById("pagebar"), title = () => (bar() && bar().isConnected && bar().querySelector(".pb-title") ? bar().querySelector(".pb-title").value : null);
    const step = (by) => bar().querySelector(`.pb-step[data-step="${by}"]`), off = (by) => step(by).disabled;
    const open = async (name) => { [...document.querySelectorAll(".page-row[data-page]")].find((r) => r.textContent.includes(name)).click(); await sleep(350); };
    const key = async (k) => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, altKey: true, bubbles: true, cancelable: true })); await sleep(350); };
    const where = () => (bar() && bar().isConnected ? title() ?? "note" : "note");
    ok("on the note itself there is no bar", !bar() || !bar().isConnected, "");
    await open("Alpha");
    ok("in a page: back is there, forward has nowhere to go", title() === "Alpha" && !off(-1) && off(1) && step(-1).getBoundingClientRect().left < bar().querySelector(".pb-crumb").getBoundingClientRect().left, [title(), off(-1), off(1)]);
    await open("Inner");
    out("deep", {});
    await sleep(700);
    step(-1).click(); await sleep(350);
    ok("back: the page one was on before, and forward leads to where one came from", title() === "Alpha" && !off(1), title());
    step(-1).click(); await sleep(350);
    ok("back again: the note — its bar stays for the way forward", where() === "note" && bar().isConnected && off(-1) && !off(1), where());
    out("root", {});
    await sleep(700);
    step(1).click(); await sleep(350);
    step(1).click(); await sleep(350);
    ok("forward twice: in the inner page again", title() === "Inner" && off(1), title());
    await key("ArrowLeft");
    ok("Alt+← goes back as the button does", title() === "Alpha", title());
    await key("ArrowRight");
    ok("… and Alt+→ forward", title() === "Inner", title());
    // by the way above: a jump two up; back returns to where it was made
    bar().querySelector('.pb-crumb[data-depth="0"]').click(); await sleep(350);
    await open("Beta");
    ok("going elsewhere cuts off what lay ahead", title() === "Beta" && off(1), [title(), off(1)]);
    step(-1).click(); await sleep(350);
    step(-1).click(); await sleep(350);
    ok("back, back: the note, then the inner page the jump was made from", title() === "Inner", where());
  } catch (e) { o.error = String(e && e.stack || e); }
  out("pagenav", o);
})();
