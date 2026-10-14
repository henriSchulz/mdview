/* Development probe (dev/rig.sh blockpaste): a block once more with Ctrl+D — right below it, with the caret in it and with the
 * block selected — and what is pasted while blocks are selected goes below them, not in their place. (Real keys: the rig sends
 * them where the probe says it is ready.) */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(900); MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm, md = () => V.serialize(false);
    const para = (text, nth = 0) => [...view.dom.children].filter((p) => p.textContent.startsWith(text))[nth];
    const posOf = (el) => view.posAtDOM(el, 0), picked = () => [...view.dom.querySelectorAll(".blk-sel")].map((el) => el.textContent.trim());
    const wait = async (name) => { out(name, {}); await sleep(2200); };
    V.focus();
    view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, posOf(para("Bravo")) + 2)));
    await wait("s1"); // Ctrl+D
    ok("Ctrl+D with the caret in a block: the block once more, right below it", md() === "Alpha\n\nBravo\n\nBravo\n\nCharlie\n\n- one\n- two\n", md());
    A.blocks.select(view, posOf(para("Charlie")) - 1, false);
    await wait("s2"); // Ctrl+D
    ok("Ctrl+D on a selected block: its copy right below it, and selected", md() === "Alpha\n\nBravo\n\nBravo\n\nCharlie\n\nCharlie\n\n- one\n- two\n" && picked().join() === "Charlie", [md(), picked()]);
    // --- pasted while a block is selected
    A.blocks.select(view, posOf(para("Bravo")) - 1, false);
    A.clip.pasteFrom(view, "Pasted\n", "");
    await sleep(200);
    ok("pasted on a selected block: below it, the block stays", md() === "Alpha\n\nBravo\n\nPasted\n\nBravo\n\nCharlie\n\nCharlie\n\n- one\n- two\n", md());
    ok("… and what was pasted is selected in its place", picked().join() === "Pasted", picked());
    A.clip.pasteFrom(view, "# A heading\n\nand a line\n", "");
    await sleep(200);
    ok("once more: below that, as the blocks it is", md() === "Alpha\n\nBravo\n\nPasted\n\n# A heading\n\nand a line\n\nBravo\n\nCharlie\n\nCharlie\n\n- one\n- two\n" && picked().length === 2, [md(), picked()]);
    // the clipboard's own events: Alpha copied, pasted on the list (the events as the keys raise them — the rig's session has no clipboard of its own to carry them)
    A.blocks.select(view, posOf(para("Alpha")) - 1, false);
    const data = new DataTransfer();
    view.dom.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    ok("Ctrl+C on a selected block: the block's Markdown", data.getData("text/plain").trim() === "Alpha" && /data-mdview="blocks"/.test(data.getData("text/html")), [data.getData("text/plain"), data.getData("text/html").slice(0, 80)]);
    A.blocks.select(view, view.posAtDOM(view.dom.querySelector("ul"), 0) - 1, false);
    view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    await sleep(200);
    ok("… Ctrl+V on another: its copy below that one, which stays", /- one\n- two\n\nAlpha\n$/.test(md()), md());
    // with the caret in the text, a paste is the caret's as before
    view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, posOf(para("Alpha")) + 5)));
    A.clip.pasteFrom(view, " and more", "");
    await sleep(150);
    ok("with the caret in the text a paste goes where the caret is", md().startsWith("Alpha and more\n"), md().slice(0, 40));
  } catch (e) { o.error = String(e && e.stack || e); }
  out("blockpaste", o);
})();
