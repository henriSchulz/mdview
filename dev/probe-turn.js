/* Development probe (dev/rig.sh turn): pictures turned by quarters — shown turned in the reading view (a picture of the turned
 * shape, not one turned in the upright one's room), turned from the menu in the active mode (in the text, on a line of its own,
 * an embed), and written so. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const ok = (name, cond, detail) => (post("log", { text: (cond ? "ok " : "FAIL ") + name }), o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail))));
  try {
    await document.fonts.ready; await sleep(600);
    const content = document.getElementById("content"), shape = (img) => [img.naturalWidth, img.naturalHeight, Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)];
    // --- the reading view: wide.png is 120 × 40
    const imgs = () => [...content.querySelectorAll("img")];
    ok("the note's four pictures", imgs().length === 4, imgs().length);
    ok("upright: as it is", await until(() => imgs()[0].naturalWidth === 120 && imgs()[0].naturalHeight === 40), shape(imgs()[0]));
    ok("r90: a picture 40 wide and 120 high, in the room of that shape", await until(() => imgs()[1].dataset.turned === "90" && imgs()[1].naturalWidth === 40 && imgs()[1].naturalHeight === 120) && shape(imgs()[1])[3] > shape(imgs()[1])[2] * 2.5, shape(imgs()[1]));
    ok("… with the address it was written with kept beside it", /wide\.png$/.test(imgs()[1].dataset.src) && imgs()[1].src.startsWith("blob:"), [imgs()[1].dataset.src, imgs()[1].src.slice(0, 20)]);
    ok("r180 with a width: as wide as written, as high as before", await until(() => imgs()[2].dataset.turned === "180" && imgs()[2].naturalWidth === 120) && shape(imgs()[2])[2] === 240 && shape(imgs()[2])[3] === 80, shape(imgs()[2]));
    ok("an embed turned r270", await until(() => imgs()[3].dataset.turned === "270" && imgs()[3].naturalHeight === 120), shape(imgs()[3]));
    out("read", {});
    await sleep(700);
    // --- the active mode: turned from the menu
    MdView.setMode("active");
    await until(() => window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active");
    const view = MdActive.view.pm, pm = () => [...view.dom.querySelectorAll("img")], text = () => MdActive.view.serialize(false);
    ok("active mode: the same pictures, turned the same", await until(() => pm().length === 4 && pm()[1].naturalWidth === 40 && pm()[3].naturalHeight === 120), pm().map(shape));
    const picAt = (i) => { const found = []; view.state.doc.descendants((n, p) => { if (n.type.name === "image" || (n.type.name === "island" && /!\[/.test(String(n.attrs.raw)))) found.push({ n, p }); }); return { ...found[i], pic: MdActive.islands.picture(view, found[i].p, found[i].n) }; };
    picAt(0).pic.turnBy(90);
    ok("a picture in the text, Rotate Right: written |r90", /in the text !\[wide\|r90\]\(wide\.png\)/.test(text()), text());
    ok("… and shown so", await until(() => pm()[0].naturalWidth === 40 && pm()[0].naturalHeight === 120), shape(pm()[0]));
    picAt(0).pic.turnBy(-90);
    ok("Rotate Left: upright again, and nothing written of it", /in the text !\[wide\]\(wide\.png\)/.test(text()) && await until(() => pm()[0].naturalWidth === 120), [text(), shape(pm()[0])]);
    picAt(1).pic.turnBy(90);
    ok("a picture on a line of its own: r90 → r180", /^!\[own\|r180\]\(wide\.png\)$/m.test(text()), text());
    ok("… shown upside down, as large as before", await until(() => pm()[1].dataset.turned === "180" && pm()[1].naturalWidth === 120), shape(pm()[1]));
    picAt(2).pic.turnBy(90);
    ok("with a size: the turn before it, the size kept", /^!\[sized\|r270\|240\]\(wide\.png\)$/m.test(text()), text());
    picAt(3).pic.turnBy(90);
    ok("an embed: r270 and a quarter more is upright", /^!\[\[wide\.png\]\]$/m.test(text()) && await until(() => pm()[3].naturalWidth === 120), text());
    out("active", {});
    await sleep(900);
    if (errs.length) ok("no script errors", false, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("turn", o);
})();
