/* Development probe (dev/rig.sh regress): what the reading view and the
 * source editor do, as a report that must come out the same before and after
 * a change — run against the version on `main` and against this checkout.
 * Uses nothing but the page's DOM and MdView.setMode, so it runs on both.
 * Works on a copy of the file (it gets edited). */
(async () => {
  const out = (name, o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16) + ":" + s.length; };
  const r1 = (n) => Math.round(n * 10) / 10;
  const key = (init) => (document.activeElement || window).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  const content = document.getElementById("content");
  const rects = (root, sel) => hash([...root.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return [r1(r.left), r1(r.top + scrollY), r1(r.width), r1(r.height)].join(); }).join(";"));
  const waitView = async (v) => {
    for (let i = 0; i < 100 && ((document.body.dataset.view || "read") !== v || document.body.classList.contains("swapping")); i++) await sleep(30);
    await sleep(400);
  };
  const report = {};
  try {
    await document.fonts.ready;
    // pictures from the network arrive when they arrive; measure once they are all there (or failed)
    for (let i = 0; i < 60 && [...content.querySelectorAll("img")].some((im) => !im.complete); i++) await sleep(150);
    for (let i = 0; i < 40 && content.querySelector("pre.mermaid"); i++) await sleep(150);
    await sleep(600);
    document.getElementById("toolbar").style.visibility = "hidden";
    window.scrollTo(0, 0);
    report.read = {
      html: hash(content.innerHTML), height: r1(content.getBoundingClientRect().height),
      layout: rects(content, "*"), title: document.title,
    };
    out("read", {});
    await sleep(2200); // screenshot of the reading view

    // find and outline while reading
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
    const input = document.getElementById("find-input");
    input.value = "the";
    input.dispatchEvent(new Event("input"));
    await sleep(250);
    report.find = document.getElementById("find-count").textContent;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "O", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await sleep(350);
    report.outline = [...document.querySelectorAll("#outline .menu-item")].map((e) => e.textContent).join("|");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await sleep(300);

    // source editor
    window.scrollTo(0, Math.round(document.documentElement.scrollHeight / 4));
    await sleep(100);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", ctrlKey: true, bubbles: true, cancelable: true }));
    await waitView("edit");
    const ed = document.getElementById("ed-input"), back = document.getElementById("ed-back");
    report.edit = {
      view: document.body.dataset.view, value: hash(ed.value), backdrop: hash(back.innerHTML), lines: back.children.length,
      caret: ed.selectionStart, scroll: r1(window.scrollY), layout: rects(back, ".ln"),
    };
    window.scrollTo(0, 0);
    await sleep(100);
    out("edit", {});
    await sleep(2200); // screenshot of the source editor

    // typing helpers
    const steps = [];
    const snap = (name) => steps.push([name, hash(ed.value), ed.selectionStart, ed.selectionEnd]);
    ed.focus();
    ed.setSelectionRange(0, 0);
    document.execCommand("insertText", false, "New first line\n\n- item one");
    snap("insert");
    key({ key: "Enter" });                          // continues the list
    await sleep(30); snap("enter in list");
    document.execCommand("insertText", false, "two");
    key({ key: "Tab" }); await sleep(30); snap("tab indents");
    key({ key: "Tab", shiftKey: true }); await sleep(30); snap("shift+tab outdents");
    ed.setSelectionRange(0, 3);
    key({ key: "b", ctrlKey: true }); await sleep(30); snap("bold");
    key({ key: "i", ctrlKey: true }); await sleep(30); snap("italic");
    ed.setSelectionRange(6, 11);
    key({ key: "k", ctrlKey: true }); await sleep(30); snap("link");
    report.steps = steps;
    report.afterEdits = { value: hash(ed.value), backdrop: hash(back.innerHTML) };
    await sleep(1100);                              // autosave
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", ctrlKey: true, bubbles: true, cancelable: true }));
    await waitView("read");
    for (let i = 0; i < 60 && [...content.querySelectorAll("img")].some((im) => !im.complete); i++) await sleep(150); // redrawn: its pictures load again
    await sleep(500);
    report.readAgain = { view: document.body.dataset.view || "read", html: hash(content.innerHTML), height: r1(content.getBoundingClientRect().height) };

    // a task ticked while reading
    const box = content.querySelector("input.task[data-line]:not(:checked)");
    if (box) { box.click(); await sleep(700); report.task = { html: hash(content.innerHTML) }; }
    out("report", report);
  } catch (e) {
    out("report", { error: String(e && e.stack || e), report });
  }
})();
