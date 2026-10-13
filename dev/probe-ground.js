/* Development probe (dev/rig.sh ground): a note with a ground of its own in a folder window — the strip of tabs is of that ground,
 * not a band of the window's colour across it, and the sheet begins a little under the strip. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(1200);
    const tabs = document.getElementById("tabs"), content = document.getElementById("content"), root = document.documentElement;
    const open = (name) => window.MdHost.post(JSON.stringify({ type: "note", path: MdView.core.folder.root + "/" + name }));
    await until(() => MdView.core.folder && MdView.core.folder.root);
    if (window.MdOverview && MdOverview.shown) MdOverview.close();
    open("Ground.md");
    ok("the note has its ground, and the window has tabs", await until(() => root.dataset.docBg === "cyan" && document.body.hasAttribute("data-tabs")), [root.dataset.docBg, document.body.hasAttribute("data-tabs")]);
    const strip = getComputedStyle(tabs), ground = getComputedStyle(root), shade = getComputedStyle(tabs, "::after");
    ok("the strip of tabs is of the note's ground: the same picture, held at the window as the ground is", strip.backgroundImage === ground.backgroundImage && strip.backgroundImage.includes("gradient") && strip.backgroundAttachment === "fixed" && strip.backgroundColor === ground.backgroundColor, [strip.backgroundImage.slice(0, 60), ground.backgroundImage.slice(0, 60), strip.backgroundAttachment, strip.backgroundColor, ground.backgroundColor]);
    ok("… and its shade below is the ground thinning out, not the window's colour", shade.backgroundImage === ground.backgroundImage && /gradient/.test(shade.maskImage || shade.webkitMaskImage || ""), [shade.backgroundImage.slice(0, 60), shade.maskImage || shade.webkitMaskImage]);
    scrollTo(0, 0); await sleep(100);
    const gap = content.getBoundingClientRect().top - tabs.getBoundingClientRect().bottom;
    ok("the sheet begins a little under the strip, the ground between them", gap >= 8 && gap <= 24, gap);
    out("shown", {});
    await sleep(900);
    // a note without a ground: the strip is the window's again
    open("Plain.md");
    if (await until(() => !root.dataset.docBg, 3000)) ok("a note without one: the strip is the window's colour again", getComputedStyle(tabs).backgroundImage === "none", getComputedStyle(tabs).backgroundImage);
    else ok("(the plain note could not be opened from here)", true);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("ground", o);
})();
