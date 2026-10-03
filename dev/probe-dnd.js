/* Development probe (dev/rig.sh dnd): moving a block by its handle, dropping
 * picture files (copied beside the note or into ./assets, or linked where
 * they are). Works on a copy of tests/fixtures/m5.md; the rig puts a picture
 * at $R/drop.png. */
(async () => {
  const out = (name, o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    const original = MdView.core.current.raw, notePath = MdView.core.current.path;
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm, { TextSelection } = PM.state;
    const md = () => V.serialize(false);
    const para = (text) => [...view.dom.children].find((p) => p.textContent.startsWith(text));
    const key = (k, mods = {}) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }); Object.defineProperty(e, "keyCode", { get: () => k.toUpperCase().charCodeAt(0) }); view.dom.dispatchEvent(e); };
    o.drops = [];
    const drop = (target, x, y, dt) => {
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      const e = new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt });
      target.dispatchEvent(e);
      o.drops.push([e.defaultPrevented, !!view.dragging, dt.getData("text/uri-list").slice(-20), x, y, !!view.posAtCoords({ left: x, top: y })]);
    };
    V.focus();

    // --- a block moved by its handle
    const second = para("Second paragraph");
    second.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: second.getBoundingClientRect().left + 20, clientY: second.getBoundingClientRect().top + 5 }));
    await sleep(250);
    const h = document.querySelector(".blk-h"), hr = h.getBoundingClientRect(), sr = second.getBoundingClientRect();
    ok("pointing at a block shows its handle, left of its first line", h.hasAttribute("data-on") && hr.right <= sr.left && Math.abs(hr.top + hr.height / 2 - (sr.top + 13)) < 10, [hr, sr.top]);
    const dt = new DataTransfer();
    h.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    ok("dragging it carries its Markdown", dt.getData("text/plain") === "Second paragraph for the bar and the menu." && !!view.dragging);
    const target = para("Filler paragraph 2 ");
    const tr = target.getBoundingClientRect();
    drop(view.dom, tr.left + 10, tr.top + 2, dt);
    h.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    await sleep(200);
    const moved = original.replace("Second paragraph for the bar and the menu.\n\n", "").replace("Filler paragraph 2 ", "Second paragraph for the bar and the menu.\n\nFiller paragraph 2 ");
    ok("dropped: the block stands where it was dropped, and nowhere else", md() === moved, md().slice(0, 400));
    key("z", { ctrlKey: true });
    ok("one undo puts it back", md() === original, md().slice(0, 200));

    // --- picture files dropped
    const pic = "file://" + notePath.replace(/\/work\/[^/]+$/, "/drop.png");
    const files = (uris) => { const d = new DataTransfer(); d.setData("text/uri-list", uris.join("\r\n")); return d; };
    // (where the last paragraph is now: the page may have moved since)
    const atLast = (dt) => { const last = para("Last paragraph"); last.scrollIntoView({ block: "center" }); const r = last.getBoundingClientRect(); drop(view.dom, r.right - 2, r.top + r.height / 2, dt); };
    atLast(files([pic]));
    for (let i = 0; i < 40 && !md().includes("drop.png"); i++) await sleep(50);
    ok("a picture file dropped: copied beside the note, embedded where it was dropped", md().includes("Last paragraph.![](drop.png)") || md().includes("Last paragraph![](drop.png)."), md().slice(-60));
    for (let i = 0; i < 40 && !view.dom.querySelector('img[src*="drop.png"]')?.complete; i++) await sleep(50);
    ok("… and shows", view.dom.querySelector('img[src*="drop.png"]')?.naturalWidth === 20);
    key("z", { ctrlKey: true });
    post("prefs", { prefs: { images: "assets" } });
    await sleep(300);
    atLast(files([pic]));
    for (let i = 0; i < 40 && !md().includes("assets/drop.png"); i++) await sleep(50);
    ok("with the setting “./assets”: copied there", md().includes("![](assets/drop.png)"), md().slice(-60));
    key("z", { ctrlKey: true });
    post("prefs", { prefs: { images: "beside" } });
    await sleep(300);
    atLast(files([pic.replace(/drop\.png$/, "work/drop.png")]));
    for (let i = 0; i < 40 && md() === original; i++) await sleep(50);
    ok("a picture already beside the note is linked, not copied again", md().includes("![](drop.png)") && !md().includes("drop-2"), md().slice(-60));
    key("z", { ctrlKey: true });
    atLast(files([pic.replace(/drop\.png$/, "notes.txt")]));
    await sleep(400);
    ok("anything but a picture: nothing is inserted, it is said", md() === original && /Only pictures/.test(document.getElementById("toast")?.textContent || ""), [md() === original, document.getElementById("toast")?.textContent]);
    await sleep(1100);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("dnd", o);
})();
