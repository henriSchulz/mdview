/* Development probe (dev/rig.sh docstyle): the document's style — the ground a note stands on, the width of its column — in
 * every mode (Henri, 2026-10-20): the panel opened with Ctrl+Alt+P beside the source alone and beside the source with its
 * reading, a ground and a width chosen there, written into the source's head as an edit (taken back with Ctrl+Z), shown at
 * once — in the source's sheet and in the reading half's. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    const P = window.MdPage, body = document.body, root = document.documentElement, ed = P.edInput;
    await until(() => MdView.core.current && MdView.core.current.text.includes("# Style"));
    await sleep(600);
    // (the rig's window can be narrower than a window is: the page is told it has room)
    const real = innerWidth;
    if (real < 1200) Object.defineProperty(window, "innerWidth", { configurable: true, get: () => 1200 });
    o.width = real;
    const keyP = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    const panel = () => window.MdActive && MdActive.panel;
    const ground = (bg) => panel().el.querySelector(`.rp-ground[data-bg="${bg}"]`);
    const head = () => (/^---\n[\s\S]*?\n---\n/.exec(ed.value) || [""])[0];

    // --- the source alone
    P.setMode("edit");
    ok("the source alone", await until(() => P.mode === "edit" && body.dataset.view === "edit"), P.mode);
    const at = ed.value.indexOf("caret");
    ed.focus(); ed.setSelectionRange(at, at + 5);
    keyP();
    ok("Ctrl+Alt+P beside the source: the panel opens, at the document's style", await until(() => body.hasAttribute("data-panel") && /style|info/.test(panel().el.dataset.tab)), [body.hasAttribute("data-panel"), panel() && panel().el.dataset.tab]);
    if (panel().el.dataset.tab !== "style") panel().setTab("style");
    await sleep(400);
    const card = panel().el.getBoundingClientRect();
    // (a window narrower than 760 px shows no panel — the rig's can be one: then only what the page says is checked)
    if (real >= 760) ok("… and is seen, at the window's right", getComputedStyle(panel().el).visibility === "visible" && card.width > 200 && card.right <= real + 1, [card.left, card.right, getComputedStyle(panel().el).visibility]);
    else ok(`(the rig's window is ${real} px wide: the panel is not drawn there, as in any window that narrow)`, getComputedStyle(panel().el).display === "none");
    const tabs = [...panel().rail.querySelectorAll(".rp-tab")].filter((b) => b.disabled).map((b) => b.dataset.tab);
    ok("Insert and Format are dimmed, the rail is not there (as beside the reading view)", tabs.join() === "insert,format" && !body.hasAttribute("data-rail"), [tabs, body.hasAttribute("data-rail")]);
    const rest = ed.value.slice(ed.value.indexOf("# Style"));
    ground("blue").click();
    await sleep(300);
    ok("a ground chosen: written into the source's head", /background: blue/.test(head()), head());
    ok("… the rest of the text as it was", ed.value.endsWith(rest) && ed.value.slice(ed.value.indexOf("# Style")) === rest);
    ok("… the caret where it was, and the text still has the keys", ed.value.slice(ed.selectionStart, ed.selectionEnd) === "caret" && document.activeElement === ed, [ed.value.slice(ed.selectionStart, ed.selectionEnd), document.activeElement && document.activeElement.id]);
    ok("… the ground shows at once, the source on its sheet", root.dataset.docBg === "blue" && getComputedStyle(document.getElementById("editor")).borderRadius !== "0px", [root.dataset.docBg, getComputedStyle(document.getElementById("editor")).borderRadius]);
    ok("… the panel says it", ground("blue").getAttribute("aria-checked") === "true");
    // Ctrl+Z in the source: the head as it was (the editor's own undo)
    document.execCommand("undo");
    await sleep(300);
    ok("Ctrl+Z takes it back, as a key typed", !/background:/.test(head()) && ed.value.endsWith(rest), head());
    document.execCommand("redo");
    await sleep(300);
    ok("… and Ctrl+Shift+Z does it again", /background: blue/.test(head()), head());
    const w0 = document.getElementById("editor").getBoundingClientRect().width;
    const box = panel().el.querySelector(".rp-width");
    box.value = "wide"; box.dispatchEvent(new Event("change"));
    await sleep(400);
    const w1 = document.getElementById("editor").getBoundingClientRect().width;
    ok("a width chosen: written, and the column's measure is the note's", /width: wide/.test(head()) && /66%/.test(root.style.getPropertyValue("--measure")), [head(), root.style.getPropertyValue("--measure")]);
    if (real >= 1100) ok("… the source's column is wider", w1 > w0 + 20, [w0, w1]); // (in a narrow window every width is the whole room, 30rem at least)
    await sleep(1200); // (written: the rig reads the file afterwards)

    // --- the source beside its reading
    P.setMode("split");
    ok("the source beside its reading", await until(() => P.mode === "split" && body.hasAttribute("data-twin")), P.mode);
    await sleep(800);
    ok("the panel stays open there", body.hasAttribute("data-panel") && (real < 760 || getComputedStyle(panel().el).visibility === "visible"));
    ground("dots").click();
    await sleep(900);
    const twin = document.getElementById("twin"), sheet = twin.querySelector(".twin-doc"), cs = getComputedStyle(sheet);
    ok("a ground chosen there: written, and shown", /background: dots/.test(head()) && root.dataset.docBg === "dots", [head(), root.dataset.docBg]);
    ok("the reading half lets the ground through — no wall of the window's colour", getComputedStyle(twin).backgroundColor === "rgba(0, 0, 0, 0)", getComputedStyle(twin).backgroundColor);
    ok("… and the note there is a sheet on it, as the source is", cs.backgroundColor !== "rgba(0, 0, 0, 0)" && parseFloat(cs.borderTopLeftRadius) > 0, [cs.backgroundColor, cs.borderTopLeftRadius]);
    scrollTo(0, 0); await sleep(200);
    const tops = [document.getElementById("editor").getBoundingClientRect().top, sheet.getBoundingClientRect().top];
    ok("… both sheets begin at the same height", Math.abs(tops[0] - tops[1]) <= 2, tops);
    ok("… the reading half reads the note", /Style/.test(sheet.textContent));
    out("shown", {});
    await sleep(900);
    ground("").click();
    await sleep(400);
    ok("no ground chosen: the head has none, the window its own colour", !/background:/.test(head()) && !root.dataset.docBg && getComputedStyle(twin).backgroundColor !== "rgba(0, 0, 0, 0)", [head(), root.dataset.docBg]);
    ground("dots").click();
    await sleep(1200);
    keyP();
    ok("Ctrl+Alt+P again: closed", await until(() => !body.hasAttribute("data-panel")));
    // --- the active mode: the rail and all four tabs, as before
    P.setMode("active");
    ok("the active mode: the rail, nothing dimmed", await until(() => body.hasAttribute("data-rail")) && ![...panel().rail.querySelectorAll(".rp-tab")].some((b) => b.disabled));
    P.setMode("read");
    await sleep(400);
    ok("no error on the page", !errs.length, errs);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("docstyle", o);
})();
