/* Development probe (dev/rig.sh start-page): the app started by itself says what can be opened — a
 * folder, a file — in its window; and a note opened by itself has, in the toolbar, the way to its
 * folder (the sidebar). Started twice by the rig: bare, and with one note. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(900);
    const cur = MdView.core.current, said = [];
    const real = window.MdHost.post;
    window.MdHost.post = (json) => { const m = JSON.parse(json); if (m.type === "folder" || m.type === "open") said.push(m); if (m.type !== "open" && !(m.type === "folder" && !m.here)) real(json); }; // (the system's own windows are not opened here)
    if (!cur) {
      const st = document.querySelector("#content .start-state"), btn = (k) => st && st.querySelector(`[data-empty="${k}"]`);
      ok("started by itself: the window says what can be opened", !!st && st.offsetWidth > 200 && /Open Your Notes/.test(st.textContent), document.querySelector("#content").innerHTML.slice(0, 300));
      ok("a folder and a file: two buttons, the folder first", !!btn("folder") && !!btn("file") && btn("folder").classList.contains("primary") && btn("folder").getBoundingClientRect().left < btn("file").getBoundingClientRect().left, st && st.innerHTML.slice(-300));
      btn("folder").click(); btn("file").click();
      ok("they ask for the system's window of each", said.map((m) => m.type).join() === "folder,open" && !said[0].here, said);
      ok("no sidebar, no note: nothing else pretends to be there", document.body.dataset.folder == null && !document.querySelector("#content h1"), document.body.dataset.folder);
      out("bare", {});
    } else {
      const b = document.querySelector('#toolbar [data-act="notefolder"]');
      ok("a note opened by itself: no sidebar — and the toolbar has the way to its folder", document.body.dataset.folder == null && !!b && b.offsetWidth > 0 && /Folder/.test(b.getAttribute("aria-label") || b.dataset.tip || b.title), [document.body.dataset.folder, b && b.outerHTML.slice(0, 160)]);
      b.click();
      ok("pressed: the note's folder is open beside it, its notes in the sidebar", await until(() => document.body.dataset.folder != null && document.querySelectorAll("#sidebar .sb-row").length >= 2, 8000), [document.body.dataset.folder, document.querySelectorAll("#sidebar .sb-row").length]);
      ok("… the note stays on screen", MdView.core.current && MdView.core.current.name === cur.name && !!document.querySelector("#content h1"), MdView.core.current && MdView.core.current.name);
      ok("… and the button is gone: the sidebar has its own", await until(() => !b.offsetWidth, 3000), b.offsetWidth);
      out("note", {});
    }
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  out("start", o);
})();
