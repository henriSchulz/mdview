/* Development probe (dev/rig.sh folder): the active mode in a folder window —
 * another note from the sidebar, the sidebar itself, back, and leaving a note
 * from the source editor. Evaluated by mdview.py (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(1200);
    ok("folder window with sidebar", document.body.dataset.sidebar === "open", document.body.dataset.sidebar);
    const first = MdView.core.current.name;
    MdView.setMode("active");
    for (let i = 0; i < 200 && document.body.dataset.view !== "active"; i++) await sleep(10);
    window.scrollTo(0, 300);
    const rows = [...document.querySelectorAll(".sb-row[data-real]")];
    const other = rows.find((r) => !r.classList.contains("active"));
    other.click();
    await sleep(900);
    ok("another note opens in the active mode", document.body.dataset.view === "active" && MdView.core.current.name !== first, [document.body.dataset.view, MdView.core.current.name]);
    ok("it starts at the top", window.scrollY === 0, window.scrollY);
    ok("active shows the new note", MdActive.view.serialize() === MdView.core.current.raw);
    ok("sidebar marks it", other.classList.contains("active"));
    const left = MdActive.view.el.getBoundingClientRect().left;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await sleep(900);
    ok("sidebar hides, the active column moves over", document.body.dataset.sidebar === "closed" && MdActive.view.el.getBoundingClientRect().left < left, [left, MdActive.view.el.getBoundingClientRect().left]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await sleep(900);
    // back / forward
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true }));
    await sleep(900);
    ok("Alt+Left goes back, still active", document.body.dataset.view === "active" && MdView.core.current.name === first, MdView.core.current.name);
    // source editor from active, then another note: back to reading as before
    MdView.setMode("edit"); await sleep(700);
    other.click(); await sleep(900);
    ok("leaving a note from the source editor lands in reading", (document.body.dataset.view || "read") === "read", document.body.dataset.view);
    ok("mode control shows reading", [...document.querySelectorAll(".seg-btn")].map((b) => b.getAttribute("aria-checked")).join() === "false,false,true");
  } catch (e) { o.error = String(e.stack || e); }
  window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name: "folder", text: JSON.stringify(o) }));
})();
