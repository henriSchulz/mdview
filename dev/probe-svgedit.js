/* Development probe (dev/rig.sh svgedit): the code of a picture of svg, edited in its dialog — there is room to
 * write in, the picture follows what is written, and what is written is kept. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(900); MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(400);
    window.MdPrefs = { ...(window.MdPrefs || {}), dialogWidth: 697, dialogHeight: 200 }; // (a height no dialog can be pulled to, kept once — Henri's settings on 2026-10-10: it is no size, the dialog has its own)
    const A = MdActive, view = A.view.pm, md = () => A.view.serialize(false), dlg = document.getElementById("dlg");
    const isl = (n) => { let at = -1, k = 0; view.state.doc.forEach((x, p) => { if (x.type.name === "island" && /^```svg/.test(x.attrs.raw || "") && k++ === n) at = p; }); return at; };
    let before1 = "";
    for (const [n, name] of [[0, "a tall picture, written on many lines"], [1, "a picture written on one long line"]]) {
      before1 = md();
      A.islands.open(view, isl(n));
      for (let i = 0; i < 100 && !dlg.hasAttribute("data-open"); i++) await sleep(30);
      await sleep(500);
      const ce = dlg.querySelector(".ce"), input = dlg.querySelector(".ce-in"), pv = dlg.querySelector(".dlg-preview"), d = dlg.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(input).lineHeight) || 20, lines = Math.floor((ce.clientHeight - 28) / lh);
      o["m" + n] = { ce: [ce.clientWidth, ce.clientHeight], lines, pv: pv && [Math.round(pv.getBoundingClientRect().width), Math.round(pv.getBoundingClientRect().height)], dlg: [Math.round(d.width), Math.round(d.height)], win: [innerWidth, innerHeight], wrap: getComputedStyle(input).whiteSpace };
      ok(name + ": at least ten lines of its code are in sight", lines >= 10, o["m" + n]);
      ok("… the picture is in sight beside it, whole", !!pv && !!pv.querySelector("svg") && pv.getBoundingClientRect().bottom <= d.bottom + 1 && pv.querySelector("svg").getBoundingClientRect().height <= pv.clientHeight + 1 && pv.querySelector("svg").getBoundingClientRect().height > 40, o["m" + n]);
      ok("… and the dialog is within the window", d.top >= 0 && d.bottom <= innerHeight && d.left >= 0 && d.right <= innerWidth, [d.top, d.bottom, innerHeight]);
      if (n === 1) ok("code written on one endless line is shown a line for each part: hardly anything to scroll sideways for", ce.scrollWidth < ce.clientWidth * 1.5 && input.value.split("\n").length > 30, [ce.scrollWidth, ce.clientWidth, input.value.slice(0, 200)]);
      if (n === 1) { // looked at and left: the note's code is as it was
        dlg.querySelector('[data-do="done"]').click(); await sleep(400);
        ok("… looked at and shut with Done, nothing typed: the note's code stays as it was written", md() === before1, md().slice(-400));
        A.islands.open(view, isl(n));
        for (let i = 0; i < 100 && !dlg.hasAttribute("data-open"); i++) await sleep(30);
        await sleep(400);
      }
      out("dlg" + n, {});
      await sleep(700);
      // typed: the picture follows, and Done keeps it
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set, field = dlg.querySelector(".ce-in");
      set.call(field, field.value.replace("teal", "crimson")); field.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(500);
      ok("what is typed shows in the picture", /crimson/.test(dlg.querySelector(".dlg-preview").innerHTML), dlg.querySelector(".dlg-preview").innerHTML.slice(0, 200));
      dlg.querySelector('[data-do="done"]').click(); await sleep(500);
      ok("Done keeps it: the note has the new code, and shows the new picture", /crimson/.test(view.state.doc.nodeAt(isl(n)).attrs.raw) && !dlg.hasAttribute("data-open") && /crimson/.test(view.nodeDOM(isl(n)).innerHTML), md().slice(0, 300));
    }
    // a dialog pulled small elsewhere (a formula's, say): the size kept is the one for all dialogs — code beside its picture keeps room all the same
    window.MdPrefs = { ...(window.MdPrefs || {}), dialogWidth: 697, dialogHeight: 240 }; // (240: a height the corner can be pulled to — 200, which Henri's settings held, is no size at all any more, see the top)
    A.islands.open(view, isl(0));
    for (let i = 0; i < 100 && !dlg.hasAttribute("data-open"); i++) await sleep(30);
    await sleep(500);
    {
      const ce = dlg.querySelector(".ce"), input = dlg.querySelector(".ce-in"), pv = dlg.querySelector(".dlg-preview"), d = dlg.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(input).lineHeight) || 20, lines = Math.floor((ce.clientHeight - 28) / lh);
      ok("opened with a small size kept (697 × 240): still at least ten lines of code in sight, and the picture no stamp", lines >= 10 && pv.clientHeight >= 300 && d.bottom <= innerHeight, { lines, dlg: [Math.round(d.width), Math.round(d.height)], pv: [pv.clientWidth, pv.clientHeight] });
    }
    window.MdPrefs = { ...window.MdPrefs, dialogWidth: 0, dialogHeight: 0 };
    dlg.querySelector('[data-do="cancel"]').click(); await sleep(300);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("svgedit", o);
})();
