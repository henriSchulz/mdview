/* Development probe (dev/rig.sh history, last part): the history switched off from the clock's
 * menu and on again; then a change, and the window closed at once — the program ends by itself
 * (the rig makes that soon) and must have kept the change. Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(1200);
    const btn = document.querySelector('[data-act="historymenu"]');
    const entries = () => [...document.querySelectorAll("#ctxmenu .menu-item:not([hidden])")];
    const pick = async (cmd) => { btn.click(); await sleep(300); const e = entries().find((x) => x.dataset.cmd === cmd && !x.disabled); if (e) e.click(); else btn.click(); await sleep(900); return !!e; };
    ok("a project's menu has Turn Off History", await pick("history:off"));
    ok("switched off: the clock says so, and that the versions are kept", btn.title === "History: off (its versions are kept)" || btn.dataset.tip === "History: off (its versions are kept)", [btn.title, btn.dataset.tip]);
    btn.click(); await sleep(300);
    ok("the note's history can still be read, and the history switched on again", ["history:show", "history:on"].every((c) => entries().some((e) => e.dataset.cmd === c)), entries().map((e) => e.dataset.cmd));
    btn.click(); await sleep(200);
    ok("switched on again, without a question", await pick("history:on") && (btn.title || btn.dataset.tip) === "History: on", [btn.title, btn.dataset.tip]);
    // Ctrl+S keeps at once, however long the quiet while is (here: a minute)
    post({ type: "save", text: MdView.core.current.raw + "\nkept at once\n" });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true }));
    await sleep(1200);
    post({ type: "probe", name: "history-now", text: "{}" });
    await sleep(600);
    post({ type: "save", text: MdView.core.current.raw + "\nlast words\n" });
    await sleep(150);
    o.pass = o.steps.every((s) => s.startsWith("ok"));
    post({ type: "probe", name: "history-off", text: JSON.stringify(o) });
    post({ type: "close" }); // (not quiet for a long while yet: the closing keeps it — and the program ends)
  } catch (e) { o.error = String(e && e.stack || e); o.pass = false; post({ type: "probe", name: "history-off", text: JSON.stringify(o) }); }
})();
