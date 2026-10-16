/* Development probe (dev/rig.sh backspace): Backspace sent from outside as a key (`wtype -k BackSpace`, the virtual keyboard of a phone's
 * screen mirror) takes a letter away in the note — in the active mode and in the source (Henri, 2026-10-16: typing worked, Backspace did
 * nothing). Real keys: the rig sends them where the probe says it is ready. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  // what the page is told of each key from outside: keydown, then what the editor makes of it
  o.keys = [];
  for (const t of ["keydown", "beforeinput", "input"]) addEventListener(t, (e) => o.keys.push([t, e.key || e.inputType, e.code || "", e.keyCode || 0, e.defaultPrevented, (e.target.id || e.target.className || e.target.tagName).toString().slice(0, 20)]), true);
  try {
    await sleep(900);
    // the active mode: the caret at the end of "abc"
    MdView.setMode("active");
    await until(() => window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active");
    await sleep(400);
    const V = MdActive.view, view = V.pm;
    V.focus();
    const end = () => { let at = 0; view.state.doc.descendants((n, pos) => { if (n.isText && n.text.startsWith("abc")) at = pos + n.text.length; }); return at; };
    view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, end())));
    out("s1", {}); await sleep(2200); // Backspace
    ok("active mode: a Backspace from outside takes the last letter away", /^abc?\b|ab\n/.test(V.serialize(false)) && !/abc/.test(V.serialize(false)), V.serialize(false));
    out("s2", {}); await sleep(2200); // Backspace again
    ok("… and again", /^ab?\n|^a\n/.test(V.serialize(false)) && !/ab\b/.test(V.serialize(false).split("\n")[0]), V.serialize(false));
    // the source: the caret at the end of the first line
    MdView.setMode("edit");
    await until(() => document.body.dataset.view === "edit");
    await sleep(500);
    const ta = document.querySelector("#ed-input");
    ta.focus(); ta.setSelectionRange(ta.value.indexOf("\n"), ta.value.indexOf("\n"));
    const before = ta.value.split("\n")[0];
    out("s3", {}); await sleep(2200); // Backspace
    ok("the source: a Backspace from outside takes the letter before the caret away", ta.value.split("\n")[0] === before.slice(0, -1), [before, ta.value.split("\n")[0]]);
    // the other keys that are no text: the arrows, Delete, Home and End — in the source, on a line of its own
    ta.value = "abcdef\n"; ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus(); ta.setSelectionRange(3, 3);
    const step = async (n) => { out("s" + n, {}); await sleep(1800); return [ta.selectionStart, ta.selectionEnd, ta.value.split("\n")[0]]; };
    ok("Left moves the caret one letter", JSON.stringify(await step(4)) === JSON.stringify([2, 2, "abcdef"]), ta.value);
    ok("Delete takes the letter after the caret away", JSON.stringify(await step(5)) === JSON.stringify([2, 2, "abdef"]), ta.value);
    ok("Home takes the caret to the line's start, Shift+End selects to its end", JSON.stringify(await step(6)) === JSON.stringify([0, 0, "abdef"]) && JSON.stringify(await step(7)) === JSON.stringify([0, 5, "abdef"]), ta.value);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("backspace", o);
})();
