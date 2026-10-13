/* Development probe (dev/rig.sh paste): a project's pasteboard in the application, against the
 * rig's own GitHub and a server of the rig's that keeps the pasteboard — none without a sign-in,
 * then what is typed goes there and what is written there comes here. Evaluated by the shell
 * (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const until = async (f, n = 80) => { for (let i = 0; i < n && !f(); i++) await sleep(100); return !!f(); };
  try {
    await until(() => window.MdView && MdView.core.folder && MdView.core.current, 100);
    document.querySelector('[data-act="overview"]').click();
    await until(() => window.MdOverview && MdOverview.isOpen);
    const opt = (v) => document.querySelector(`#overview [data-seg="scope"] .ov-opt[data-v="${v}"]`);
    const box = () => document.querySelector(".ov-paste"), field = () => document.querySelector(".ov-paste-text"), state = () => box() && box().dataset.state;
    ok("All Notes has the pasteboard as a fourth choice", !!opt("paste"), document.querySelector('#overview [data-seg="scope"]').textContent);
    opt("paste").click();
    ok("nobody signed in: it says so, and there is no field to type in", await until(() => state() === "signin") && getComputedStyle(field()).display === "none" && /Sign In/.test(box().querySelector(".ov-paste-none b").textContent), [state(), box() && box().textContent]);
    post({ type: "github-signin" });
    // (signed in once the code is confirmed at the rig's GitHub: shown again, the pasteboard is asked for again)
    ok("signed in, it is there: empty, and ready to be typed into", await (async () => { for (let i = 0; i < 25 && state() !== "ok"; i++) { opt("all").click(); opt("paste").click(); await until(() => state() === "ok", 10); } return state() === "ok"; })() && field().value === "" && !field().readOnly && document.activeElement === field(), [state(), document.activeElement && document.activeElement.className]);
    if (state() !== "ok") throw new Error("no pasteboard: " + state());
    field().focus(); field().setRangeText("typed at the desk", 0, 0, "end"); field().dispatchEvent(new Event("input", { bubbles: true }));
    const said = () => box().querySelector(".ov-paste-said").textContent;
    ok("typed: sent, and said so", await until(() => said() === "On every device"), said());
    post({ type: "probe", name: "paste-typed", text: "{}" });
    ok("what another device wrote is in the field, without anything done", await until(() => field().value === "typed at the desk\nand on the laptop", 150), field().value);
    ok("the caret stayed where it was", field().selectionStart === "typed at the desk".length, field().selectionStart);
    box().querySelector('[data-do="clear"]').click();
    ok("Clear empties the field", field().value === "", field().value);
    await until(() => said() === "On every device");
    o.cleared = said() === "On every device" && field().value === "";
    post({ type: "prefs", prefs: { ovScope: "all" } }); // (the choice is remembered: left as the other cases expect it)
    // Esc in the field closes All Notes, as anywhere in it
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    ok("Esc leaves All Notes", await until(() => !MdOverview.isOpen));
  } catch (e) { o.error = String(e && e.stack || e); }
  o.pass = !o.error && o.steps.every((s) => s.startsWith("ok"));
  post({ type: "probe", name: "paste", text: JSON.stringify(o) });
})();
