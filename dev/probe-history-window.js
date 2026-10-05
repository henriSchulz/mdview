/* Development probe (dev/rig.sh history, second part): the history's window on a note that has
 * three versions — the list, what a version changed, the difference to the note now, and a
 * version put back. Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const say = (o) => window.MdHost.post(JSON.stringify({ type: "probe", name: "history-window", text: JSON.stringify(o) }));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(1200);
    const now = MdView.core.current.raw;
    const btn = document.querySelector('[data-act="historymenu"]');
    btn.click(); await sleep(300);
    const show = document.querySelector('#ctxmenu [data-cmd="history:show"]');
    ok("the clock's menu offers the note's history", show && !show.hidden);
    show.click();
    for (let i = 0; i < 80 && !document.querySelector("#history[data-open] .hi-diff"); i++) await sleep(100);
    await sleep(400);
    const win = document.querySelector("#history");
    const diff = () => [...win.querySelectorAll(".hi-line.add, .hi-line.del")].map((l) => (l.classList.contains("add") ? "+" : "-") + l.querySelector(".hi-text").textContent);
    const rows = [...win.querySelectorAll(".hi-row")], restore = win.querySelector(".hi-tools .pf-link");
    ok("the window is open with the note's three versions", win.hasAttribute("data-open") && rows.length === 3, rows.length);
    ok("each names the device, without its id", rows.every((r) => { const by = r.querySelector(".hi-by").textContent; return by && !/[0-9a-f-]{36}/.test(by); }), rows.map((r) => r.textContent));
    ok("the newest is chosen: what it changed", rows[0].hasAttribute("aria-current") && diff().join("|") === "+ |+second change", diff());
    ok("it is the note as it is: nothing to restore", restore.disabled);
    rows[1].click(); await sleep(600);
    ok("another version: what that one changed", diff().join("|") === "+ |+first change", diff());
    ok("the lines that stayed are counted, not shown", /\d+ lines unchanged/.test((win.querySelector(".hi-gap") || {}).textContent || ""), win.querySelector(".hi-gap")?.textContent);
    const mode = win.querySelector("select"); mode.value = "now"; mode.dispatchEvent(new Event("change", { bubbles: true })); await sleep(400);
    ok("compared to the note now: what was written since", diff().join("|") === "+ |+second change", diff());
    ok("this one can be restored", !restore.disabled);
    win.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); await sleep(500);
    ok("the arrow keys go through the versions", rows[2].hasAttribute("aria-current"));
    rows[1].click(); await sleep(400);
    restore.click(); await sleep(1300);
    ok("restored: the window closes and the note is that version", !win.hasAttribute("data-open") && MdView.core.current.raw === now.replace(/\n\nsecond change\n$/, "\n"), MdView.core.current.raw.slice(-60));
    o.restored = MdView.core.current.raw;
    await sleep(1800); // (quiet: the restored note is kept as a version of its own)
  } catch (e) { o.error = String(e && e.stack || e); }
  o.pass = !o.error && o.steps.every((s) => s.startsWith("ok"));
  say(o);
})();
