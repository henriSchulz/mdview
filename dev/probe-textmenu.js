/* Development probe (dev/rig.sh textmenu): the menu for text where no part of the app has one of
 * its own — the reading view, a field. It is the app's menu, never the toolkit's, and its
 * commands run where the focus is. */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(900);
    MdView.setMode("read"); await sleep(600);
    const menu = document.getElementById("textmenu");
    const labels = () => [...menu.querySelectorAll(".menu-item")].map((b) => b.querySelector(".menu-label").textContent + (b.disabled ? " (off)" : "")).join("|");
    const item = (name) => [...menu.querySelectorAll(".menu-item")].find((b) => b.querySelector(".menu-label").textContent === name);
    const ctx = (el, x, y) => { const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }); el.dispatchEvent(e); return e.defaultPrevented; };
    // the reading view: nothing selected, then some words
    const p = document.querySelector("#content p"), pr = p.getBoundingClientRect();
    const held = ctx(p, pr.left + 40, pr.top + 8); await sleep(400);
    ok("a right click on text opens the app's menu at the pointer; the toolkit's is held back", held && menu.hasAttribute("data-open") && Math.abs(menu.getBoundingClientRect().left - (pr.left + 40)) < 2, menu.getBoundingClientRect().left);
    ok("nothing selected: Copy is off, Select All is there", labels() === "Copy (off)|Select All", labels());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await sleep(300);
    ok("Esc closes it", !menu.hasAttribute("data-open"));
    const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 15); getSelection().removeAllRanges(); getSelection().addRange(r);
    ctx(p, pr.left + 40, pr.top + 8); await sleep(400);
    ok("with words selected Copy is on, and the selection stays while the menu is open", labels() === "Copy|Select All" && getSelection().toString() === "First paragraph");
    // a field: cut, then paste what was cut
    document.querySelector('#toolbar [data-act="find"]').click(); await sleep(500);
    const f = document.getElementById("find-input"); f.value = "hello world"; f.focus(); f.setSelectionRange(0, 5);
    const fr = f.getBoundingClientRect();
    ctx(f, fr.left + 20, fr.top + 8); await sleep(400);
    ok("in a field: Cut, Copy, Paste, Select All", labels() === "Cut|Copy|Paste|Select All", labels());
    item("Cut").click(); await sleep(700);
    ok("Cut takes the selected text out of the field", f.value === " world" && !menu.hasAttribute("data-open") && document.activeElement === f, f.value);
    ctx(f, fr.left + 20, fr.top + 8); await sleep(300);
    item("Paste").click(); await sleep(700);
    ok("Paste puts it back", f.value === "hello world", f.value);
    ctx(f, fr.left + 20, fr.top + 8); await sleep(300);
    item("Select All").click(); await sleep(600);
    ok("Select All selects the field's text", f.selectionStart === 0 && f.selectionEnd === f.value.length, [f.selectionStart, f.selectionEnd]);
  } catch (e) { o.error = String(e && e.stack || e); }
  window.MdHost.post(JSON.stringify({ type: "probe", name: "textmenu", text: JSON.stringify(o) }));
})();
