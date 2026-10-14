/* Development probe (dev/rig.sh pastetab): All Notes opens on the folders; its choices are the ways of showing the notes — the
 * pasteboard is no longer among them, but a button that opens it in a tab of its own; the whiteboards are all listed, without a
 * choice among them. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(1400);
    const ov = () => document.getElementById("overview"), opts = () => [...ov().querySelectorAll('.ov-head .ov-seg[data-seg="scope"] .ov-opt')].map((b) => b.dataset.v);
    window.MdPrefs = { ...(window.MdPrefs || {}), ovScope: "all" }; // (what was shown last does not decide)
    if (!(window.MdOverview && MdOverview.isOpen)) document.querySelector('[data-act="overview"]').click();
    ok("All Notes opens on the folders, whatever was shown last", await until(() => MdOverview.isOpen && ov().dataset.scope === "folders"), ov() && ov().dataset.scope);
    ok("its choices are the ways of showing the notes: no pasteboard among them", opts().join() === "all,folders,boards", opts());
    ov().querySelector('.ov-head .ov-opt[data-v="boards"]').click();
    ok("the whiteboards: all of them, without a choice among them", await until(() => ov().dataset.scope === "boards") && !ov().querySelector(".ov-filter") && await until(() => ov().querySelectorAll(".ov-item").length === 2, 4000), [ov().querySelectorAll(".ov-item").length, !!ov().querySelector(".ov-filter")]);
    const tabs = () => [...document.querySelectorAll("#tabs .tab")], label = (t) => t.querySelector(".tab-label").textContent, n0 = tabs().length;
    const btn = ov().querySelector(".ov-pastebtn");
    ok("the pasteboard has a button of its own in All Notes' head", !!btn && btn.getClientRects().length > 0);
    btn.click();
    ok("… pressed: a new tab, named Pasteboard, showing it", await until(() => tabs().length === n0 + 1 && tabs().some((t) => label(t) === "Pasteboard" && t.getAttribute("aria-selected") === "true") && ov().dataset.scope === "paste", 4000), [tabs().map(label), ov().dataset.scope]);
    ok("… with nothing of All Notes about it", [...ov().querySelectorAll(".ov-head .ov-seg, .ov-head .ov-add, .ov-head .ov-more, .ov-head .ov-pastebtn")].every((x) => !x.getClientRects().length) && !!ov().querySelector(".ov-paste textarea"));
    out("paste", {});
    await sleep(900);
    // another tab and back: the pasteboard again; its button once more: the same tab
    const other = tabs().find((t) => label(t) !== "Pasteboard");
    window.MdHost.post(JSON.stringify({ type: "tab", op: "select", id: Number(other.dataset.id) }));
    await until(() => other.getAttribute("aria-selected") === "true", 3000);
    await sleep(300);
    const pt = tabs().find((t) => label(t) === "Pasteboard");
    window.MdHost.post(JSON.stringify({ type: "tab", op: "select", id: Number(pt.dataset.id) }));
    ok("back on its tab: the pasteboard again", await until(() => MdOverview.isOpen && ov().dataset.scope === "paste", 3000), ov().dataset.scope);
    const n1 = tabs().length;
    window.MdHost.post(JSON.stringify({ type: "tab", op: "select", id: Number(other.dataset.id) }));
    await sleep(500);
    if (!MdOverview.isOpen) document.querySelector('[data-act="overview"]').click();
    await until(() => MdOverview.isOpen);
    ov().querySelector(".ov-pastebtn").click();
    ok("its button again: its tab, no second one", await until(() => pt.getAttribute("aria-selected") === "true", 3000) && tabs().length === n1, tabs().map(label));
    if (errs.length) ok("no script errors", false, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("pastetab", o);
})();
