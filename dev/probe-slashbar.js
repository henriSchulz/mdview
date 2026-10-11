/* Development probe (dev/rig.sh slashbar): the six buttons over the "/" menu's entries — there when
 * "/" is typed, ↑ from the first entry reaches them, ← → move, Enter and a click choose, typing a
 * letter takes them away (and deleting it brings them back). */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready; await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, view = A.view.pm, { TextSelection } = PM.state;
    const md = () => A.view.serialize(false);
    const at = (text) => { let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + text.length; }); return f; };
    const caret = (text) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at(text))));
    const type = (text) => { for (const ch of text) { const { from, to } = view.state.selection; if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) view.dispatch(view.state.tr.insertText(ch, from, to)); } };
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    const menu = document.getElementById("actmenu");
    const isOpen = () => menu.hasAttribute("data-open");
    const btns = () => [...menu.querySelectorAll(".menu-bar-btn")];
    const items = () => [...menu.querySelectorAll(".menu-item")];
    const hlBtn = () => btns().findIndex((b) => b.classList.contains("hl"));
    A.view.focus();

    caret("Plain text."); type(" /"); await sleep(400);
    ok("typing \"/\" opens the menu with a bar of six buttons over its entries", isOpen() && btns().length === 6 && items().length > 5, [isOpen(), btns().length, items().length]);
    const r = menu.getBoundingClientRect(), br = btns()[0].getBoundingClientRect(), ir = items()[0].getBoundingClientRect();
    ok("the bar is the first line of the menu, in sight", br.bottom <= ir.top + 1 && br.top >= r.top && r.top >= 0 && r.bottom <= innerHeight && br.height >= 24, [r.top, br.top, br.bottom, ir.top]);
    ok("the buttons share the menu's width", btns().every((b) => b.getBoundingClientRect().width > 20) && Math.abs(btns()[5].getBoundingClientRect().right - btns()[0].getBoundingClientRect().left - (r.width - 12)) < 24, btns().map((b) => b.getBoundingClientRect().width));
    ok("what the block is shows: Text is ticked, the others are not", btns().map((b) => +b.classList.contains("on")).join("") === "100000", btns().map((b) => b.className));
    ok("each says what it is (title, label), the headings in letters", btns().every((b) => b.title && b.getAttribute("aria-label") === b.title) && btns()[1].textContent === "H1" && btns()[2].textContent === "H2" && !!btns()[3].querySelector("svg"), btns().map((b) => [b.title, b.textContent]));
    ok("the first entry is the highlighted one (the bar is not)", items()[0].classList.contains("hl") && hlBtn() < 0);
    out("bar", {}); await sleep(4000); // screenshot

    key(view.dom, "ArrowUp"); await sleep(60);
    ok("↑ from the first entry: into the bar, at its first button", hlBtn() === 0 && !items().some((b) => b.classList.contains("hl")), [hlBtn()]);
    key(view.dom, "ArrowRight"); await sleep(60);
    ok("→ moves to the next button", hlBtn() === 1, hlBtn());
    key(view.dom, "ArrowLeft"); key(view.dom, "ArrowLeft"); await sleep(60);
    ok("← stops at the first one", hlBtn() === 0, hlBtn());
    key(view.dom, "ArrowDown"); await sleep(60);
    ok("↓ back to the first entry", hlBtn() < 0 && items()[0].classList.contains("hl"));
    key(view.dom, "ArrowUp"); key(view.dom, "ArrowRight"); key(view.dom, "Enter"); await sleep(500);
    ok("Enter on H1: the block is a heading, the \"/\" is gone, the menu closed", /^# Plain text\.$/m.test(md()) && !md().includes("/") && !isOpen(), md());

    caret("End."); type(" /"); await sleep(400);
    ok("again: the bar says the block is Text, not a heading", btns().map((b) => +b.classList.contains("on")).join("") === "100000", btns().map((b) => b.className));
    btns()[2].dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); await sleep(40);
    ok("the pointer over a button highlights it, the entries are not", hlBtn() === 2 && !items().some((b) => b.classList.contains("hl")), [hlBtn()]);
    btns()[2].click(); await sleep(500);
    ok("a click on H2: the second heading", /^## End\.$/m.test(md()) && !isOpen(), md());

    caret("End."); type(" /"); await sleep(400);
    ok("a heading chosen: its button is ticked in the bar", btns().map((b) => +b.classList.contains("on")).join("") === "001000", btns().map((b) => b.className));
    type("ta"); await sleep(200);
    ok("a letter typed: the entries are what is found, the bar is gone", isOpen() && !menu.querySelector(".menu-bar") && items().some((b) => /Task/i.test(b.textContent)), items().map((b) => b.textContent).slice(0, 4));
    const p = view.state.selection.from; view.dispatch(view.state.tr.delete(p - 2, p)); await sleep(200);
    ok("deleted again: the bar is back", isOpen() && btns().length === 6 && !!menu.querySelector(".menu-bar"));
    key(view.dom, "Escape"); await sleep(300);
    ok("Esc closes it", !isOpen());
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("slashbar", o);
})();
