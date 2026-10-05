/* Development probe (dev/rig.sh sync, second part): this device and another both changed the
 * note's first line. The clock says so; its menu opens the conflicts' window; one side is
 * picked and the two are joined. Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const say = (name, o) => post({ type: "probe", name, text: JSON.stringify(o) });
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const until = async (f, n = 80) => { for (let i = 0; i < n && !f(); i++) await sleep(100); return !!f(); };
  try {
    await sleep(1200);
    // (the rig wrote this device's change into the note before the app started: kept at opening, then fetched against)
    const btn = document.querySelector('[data-act="historymenu"]');
    ok("the clock turns to say there are conflicts", await until(() => btn.classList.contains("warn")) && /conflicts to resolve/.test(btn.title || btn.dataset.tip || ""), [btn.className, btn.title, btn.dataset.tip]);
    ok("the note is as it was written here: no marks, nothing of theirs", MdView.core.current.raw.startsWith("written right here") && !/<<<<|there/.test(MdView.core.current.raw.slice(0, 60)), MdView.core.current.raw.slice(0, 60));
    btn.click(); await sleep(300);
    const entry = [...document.querySelectorAll("#ctxmenu .menu-item:not([hidden])")].find((e) => e.dataset.cmd === "history:conflicts");
    ok("its menu has Resolve Conflicts…", !!entry);
    entry.click();
    const win = () => document.querySelector("#conflict");
    ok("the window opens with the place", await until(() => win() && win().hasAttribute("data-open") && win().querySelector(".cf-place")));
    const w = win(), join = w.querySelector(".cf-join");
    const sides = () => [...w.querySelectorAll(".cf-side")].map((s) => [s.classList.contains("off"), s.querySelector(".cf-lines").textContent.trim()]);
    ok("one file, one place, both sides shown with what differs marked", w.querySelectorAll(".hi-row").length === 1 && w.querySelectorAll(".cf-place").length === 1 && sides().map((s) => s[1]).join("|") === "written right here|written there" && w.querySelectorAll(".cf-lines mark").length >= 2, [sides(), w.querySelectorAll(".cf-lines mark").length]);
    ok("nothing picked yet: it cannot be joined", join.disabled && /1 place/.test(w.querySelector(".hi-row .hi-by").textContent), w.querySelector(".hi-row .hi-by").textContent);
    ok("what both agree on is counted, not shown", /lines unchanged/.test((w.querySelector(".hi-gap") || {}).textContent || ""));
    say("sync-conflict-open", o); await sleep(1300);
    w.querySelector('.cf-pick[data-pick="both"]').click(); await sleep(200);
    ok("both picked: neither side is dimmed", sides().every((s) => !s[0]) && !join.disabled, sides());
    w.querySelector('.cf-pick[data-pick="theirs"]').click(); await sleep(200);
    ok("theirs picked: mine is dimmed, the file is chosen, Join is ready", sides()[0][0] && !sides()[1][0] && !join.disabled && w.querySelector(".hi-row").classList.contains("cf-done"), sides());
    join.click();
    ok("joined: the window goes", await until(() => !w.hasAttribute("data-open")));
    ok("the note is theirs at that place, and the rest as it was", await until(() => MdView.core.current.raw.startsWith("written there")), MdView.core.current.raw.slice(0, 40));
    ok("the clock is calm again", await until(() => !btn.classList.contains("warn")));
    o.raw = MdView.core.current.raw;
    await sleep(600);
  } catch (e) { o.error = String(e && e.stack || e); }
  o.pass = !o.error && o.steps.every((s) => s.startsWith("ok"));
  say("sync-conflict", o);
})();
