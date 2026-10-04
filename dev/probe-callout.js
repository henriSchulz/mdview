/* Development probe (dev/rig.sh callout): callouts in the active mode — made from the / menu's
 * entries, their text typed in place, the title typed in where it stands. */
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
    const entry = (group, key) => A.slash.entries(view).find((e) => e && e.key === group).items.find((e) => e && e.key === key);
    const title = (kind) => view.dom.querySelector(".callout-" + kind + " .callout-title-text");
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    A.view.focus();

    ok("a callout of the file is a block typed in, not an island", !!view.dom.querySelector(".callout-info > .callout-content > p") && !view.dom.querySelector(".isl .callout"));
    caret("An info.");
    view.dispatch(view.state.tr.insertText(" More."));
    ok("typed into", md().includes("> [!info]\n> An info. More.\n"), md());

    caret("Plain text.");
    entry("slash.callout", "callout.warning").act(view);
    await sleep(200);
    ok("the / menu's Warning puts one around the block", md().includes("> [!warning]\n> Plain text.\n") && title("warning")?.textContent === "Warning", md());
    ok("… and the caret stays in its text", view.state.selection.$from.parent.textContent === "Plain text." && view.state.selection.$from.parentOffset === 11);

    // the title
    let t = title("warning");
    t.focus();
    await sleep(100);
    ok("the title takes the caret, all of it selected", document.activeElement === t && String(getSelection()) === "Warning", String(getSelection()));
    t.textContent = "Mind **this**";
    key(t, "Enter");
    await sleep(250);
    t = title("warning");
    ok("Enter writes it", md().includes("> [!warning] Mind **this**\n> Plain text.\n"), md());
    ok("… it shows as Markdown says, and the caret is in the text below", !!t.querySelector("strong") && t.textContent === "Mind this" && view.hasFocus() && view.state.selection.$from.parent.textContent === "Plain text.", [t.innerHTML, view.hasFocus()]);
    t.focus();
    await sleep(100);
    ok("edited again, it shows its Markdown", t.textContent === "Mind **this**", t.textContent);
    t.textContent = "Something else";
    key(t, "Escape");
    await sleep(200);
    ok("Esc leaves it as it was", md().includes("> [!warning] Mind **this**\n") && title("warning").textContent === "Mind this", md());
    t = title("warning");
    t.focus();
    await sleep(100);
    t.textContent = "Left by clicking away";
    view.focus();
    await sleep(250);
    ok("leaving it writes it too", md().includes("> [!warning] Left by clicking away\n"), md());
    t = title("warning");
    t.focus();
    await sleep(100);
    t.textContent = "";
    key(t, "Enter");
    await sleep(250);
    ok("emptied, the callout has its kind's name again", md().includes("> [!warning]\n> Plain text.\n") && title("warning").textContent === "Warning", md());
    key(view.dom, "z"); // (no change by a key that is none)
    caret("Plain text.");
    ok("in a callout the menu offers Edit Title", !!entry("slash.callout", "callout.title"));
    entry("slash.callout", "callout.title").act(view);
    await sleep(150);
    ok("… which puts the caret into the title", document.activeElement === title("warning"));
    key(title("warning"), "Escape");
    await sleep(150);
    entry("slash.callout", "callout.error").act(view);
    await sleep(200);
    ok("another kind", md().includes("> [!error]\n> Plain text.\n") && !!title("danger"), md());
    await sleep(1100);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("callout", o);
})();
