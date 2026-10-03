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
    // a file's menu in the sidebar
    {
      const row = document.querySelector(".sb-row[data-real]"), r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 8 }));
      await sleep(200);
      const menu = document.getElementById("ctxmenu");
      const shown = () => [...menu.querySelectorAll(".menu-item:not([hidden])")];
      const cmds = () => shown().map((b) => b.dataset.cmd).join();
      ok("right click on a file: open in the default app, with another one, show in Finder, rename, trash", menu.hasAttribute("data-open") && cmds() === "default,openwith,reveal,rename,trash", cmds());
      ok("every entry has its icon", shown().every((b) => { const i = b.querySelector(".menu-icon svg"); return i && i.getBoundingClientRect().width > 10; }));
      const shut = async () => { menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await sleep(250); if (menu.hasAttribute("data-open")) { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); await sleep(250); } };
      await shut();
      // the + button: a note or a folder
      document.querySelector('#sidebar [data-act="newmenu"]').click();
      await sleep(200);
      ok("the + button offers a note or a folder, and the sidebar's settings", menu.hasAttribute("data-open") && cmds() === "newnote,newfolder,settings", cmds());
      shown()[1].click();
      await sleep(400);
      const input = document.getElementById("sb-new-input");
      ok("New Folder: the name field asks for a folder's name", document.activeElement === input && input.placeholder === "Folder name", input.placeholder);
      const enter = async (name) => { input.value = name; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await sleep(900); };
      await enter("Drafts");
      const dirRow = () => [...document.querySelectorAll(".sb-item.is-dir > .sb-in > .sb-row")].find((x) => x.textContent.trim() === "Drafts");
      ok("the new folder is in the sidebar, though it is empty", !!dirRow(), [...document.querySelectorAll(".sb-item.is-dir > .sb-in > .sb-row")].map((x) => x.textContent.trim()));
      // a folder's menu: a note inside it
      const dr = dirRow().getBoundingClientRect();
      dirRow().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: dr.left + 30, clientY: dr.top + 8 }));
      await sleep(200);
      ok("right click on a folder: new note, new folder, show in Finder", menu.hasAttribute("data-open") && cmds() === "newnote,newfolder,reveal", cmds());
      shown()[0].click();
      await sleep(400);
      ok("New Note there: the field asks for a note's name", document.activeElement === input && input.placeholder === "Note name", input.placeholder);
      await enter("Idea");
      await sleep(600);
      ok("the note is made inside that folder and opens", MdView.core.current.name === "Idea.md" && /\/Drafts\/Idea\.md$/.test(MdView.core.current.path), MdView.core.current.path);
      MdView.setMode("read"); await sleep(500);
    }
    // which kinds of files the sidebar lists: the settings
    {
      const names = () => [...document.querySelectorAll(".sb-row[data-real]")].map((r) => r.textContent.trim());
      const set = async (o) => { window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "prefs", prefs: o })); await sleep(900); };
      ok("as it comes: notes and PDFs, no pictures or other files", names().includes("paper.pdf") && !names().includes("photo.png") && !names().includes("data.csv"), names());
      await set({ sidebarImages: true, sidebarOther: true, sidebarPdf: false });
      ok("pictures and other files on, PDFs off: the list follows at once", !names().includes("paper.pdf") && names().includes("photo.png") && names().includes("data.csv") && names().includes("basics"), names());
      await set({ sidebarImages: false, sidebarOther: false, sidebarPdf: true });
      ok("and back", names().includes("paper.pdf") && !names().includes("photo.png") && !names().includes("data.csv"), names());
      // the dialog itself, from the reading mode
      MdView.setMode("read"); await sleep(400);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", code: "Comma", ctrlKey: true, bubbles: true, cancelable: true }));
      let dlg = null;
      for (let i = 0; i < 100 && !(dlg && dlg.hasAttribute("data-open")); i++) { await sleep(50); dlg = document.getElementById("dlg"); }
      const labels = dlg ? [...dlg.querySelectorAll(".pf-name")].map((x) => x.textContent) : [];
      ok("Ctrl+, opens the settings from any mode; the sidebar's switches are there", !!dlg && dlg.hasAttribute("data-open") && ["PDFs", "Pictures", "Sound and video", "All other files"].every((l) => labels.includes(l)), labels);
      if (dlg) { dlg.querySelector('[data-do="cancel"]').click(); await sleep(400); }
    }
    // the sidebar's edge, pulled with the real pointer
    {
      const at = (kind, x, y) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe-pointer", kind, x, y }));
      const w = () => Math.round(document.getElementById("sidebar").getBoundingClientRect().width), open = () => document.body.dataset.sidebar === "open";
      if (!open()) { window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, altKey: true, bubbles: true, cancelable: true })); await sleep(900); }
      const w0 = w();
      const pull = async (from, to) => { at("move", from, 300); await sleep(80); at("down", from, 300); await sleep(60); for (let i = 1; i <= 6; i++) { at("move", from + ((to - from) * i) / 6, 300); await sleep(30); } at("up", to, 300); await sleep(350); };
      await pull(w0 - 1, 380);
      ok("the sidebar's edge pulled to the right: it is wider, the text makes room", open() && Math.abs(w() - 380) <= 3 && Math.abs(parseFloat(getComputedStyle(document.body).paddingLeft) - w()) <= 1, [w0, w(), getComputedStyle(document.body).paddingLeft]);
      await pull(w() - 1, 210);
      ok("… and to the left: narrower", open() && Math.abs(w() - 210) <= 3, w());
      await pull(w() - 1, 40);
      ok("pulled far to the left: it goes away", !open(), document.body.dataset.sidebar);
      await pull(2, 300);
      ok("pulled from the window's edge: it comes out again, at the width it is pulled to", open() && Math.abs(w() - 300) <= 3, [document.body.dataset.sidebar, w()]);
    }
    // a PDF in the folder: listed with its ending, and it opens in the window
    const pdfRow = [...document.querySelectorAll(".sb-row[data-real]")].find((r) => r.textContent.trim() === "paper.pdf");
    ok("a PDF in the folder is listed in the sidebar", !!pdfRow, [...document.querySelectorAll(".sb-row[data-real]")].map((r) => r.textContent.trim()));
    if (pdfRow) {
      pdfRow.click();
      let shown = false;
      for (let i = 0; i < 160 && !shown; i++) { await sleep(50); shown = !!(window.MdPdf && MdPdf.shown && MdPdf.shown.pages.length === 3 && MdView.core.current.kind === "pdf"); }
      ok("a click on it opens the PDF in the window", shown, MdView.core.current && MdView.core.current.name);
      // (back to a note: the folder's last document is where the next run starts)
      const note = [...document.querySelectorAll(".sb-row[data-real]")].find((r) => r.textContent.trim() === "footnotes");
      note.click();
      for (let i = 0; i < 100 && MdView.core.current.kind === "pdf"; i++) await sleep(50);
      ok("and a click on a note shows the note again", MdView.core.current.name === "footnotes.md" && !document.querySelector(".pdfv") && /\S/.test(document.getElementById("content").textContent), MdView.core.current.name);
      await sleep(300);
    }
  } catch (e) { o.error = String(e.stack || e); }
  window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name: "folder", text: JSON.stringify(o) }));
})();
