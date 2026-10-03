/* Development probe (dev/rig.sh modes): switching between the three modes in
 * the running app — shortcuts, the mode control, scroll position, find and
 * outline in the active mode, a task ticked there. Works on a copy of the
 * file (it gets changed). Evaluated by mdview.py (MDVIEW_PROBE). */
(async () => {
  const out = (o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name: "modes", text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const ok = (name, cond, detail) => results.push({ name, ok: !!cond, ...(cond ? {} : { detail }) });
  const view = () => document.body.dataset.view || "read";
  const waitView = async (v) => {
    for (let i = 0; i < 100 && (view() !== v || document.body.classList.contains("swapping")); i++) await sleep(30);
    await sleep(350); // the fade
  };
  const seg = () => [...document.querySelectorAll(".seg-btn")].map((b) => b.getAttribute("aria-checked")).join();
  const key = (init) => window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  const modeKey = (n) => key({ key: String(n), code: "Digit" + n, ctrlKey: true, altKey: true });
  const content = document.getElementById("content");
  const topLine = (root) => {
    for (const el of root.querySelectorAll("[data-line]")) if (el.getBoundingClientRect().bottom > 0) return Number(el.dataset.line);
    return null;
  };
  const topEditLine = () => [...document.getElementById("ed-back").children].findIndex((el) => el.getBoundingClientRect().bottom > 0);
  try {
    await document.fonts.ready;
    await sleep(700);

    // reading -> active with the shortcut, somewhere down the document
    window.scrollTo(0, Math.round(document.documentElement.scrollHeight / 3));
    await sleep(100);
    const y0 = window.scrollY, line0 = topLine(content);
    const first = content.firstElementChild;
    modeKey(2);
    await waitView("active");
    const pm = MdActive.view.dom;
    ok("Ctrl+Alt+2 enters the active mode", view() === "active");
    ok("mode control shows active", seg() === "false,true,false", seg());
    ok("scroll position kept (read -> active)", window.scrollY === y0, [y0, window.scrollY]);
    ok("same block at the top", topLine(pm) === line0, [line0, topLine(pm)]);
    ok("active document is editable", pm.getAttribute("contenteditable") === "true");

    // active -> reading: nothing is redrawn
    modeKey(3);
    await waitView("read");
    ok("Ctrl+Alt+3 back to reading", view() === "read" && seg() === "false,false,true", seg());
    ok("scroll position kept (active -> read)", window.scrollY === y0, [y0, window.scrollY]);
    ok("reading view was not rebuilt", content.firstElementChild === first);

    // active -> source -> active keeps the place by source line
    modeKey(2);
    await waitView("active");
    modeKey(1);
    await waitView("edit");
    ok("Ctrl+Alt+1 enters the source editor", view() === "edit" && seg() === "true,false,false", seg());
    ok("source editor is near the same line", Math.abs(topEditLine() - line0) <= 3, [line0, topEditLine()]);
    modeKey(2);
    await waitView("active");
    ok("source -> active", view() === "active");
    ok("active is near the same line", Math.abs(topLine(MdActive.view.dom) - line0) <= 3, [line0, topLine(MdActive.view.dom)]);

    // Ctrl+E keeps its meaning: into the source editor, and back to reading
    key({ key: "e", code: "KeyE", ctrlKey: true });
    await waitView("edit");
    ok("Ctrl+E from active opens the source editor", view() === "edit");
    key({ key: "e", code: "KeyE", ctrlKey: true });
    await waitView("read");
    ok("Ctrl+E again returns to reading", view() === "read");

    // coming back into the active mode further down: the page stays where it is (the caret, left
    // at the top, does not pull it back) and the caret comes to where one is reading
    {
      const far = Math.round((document.documentElement.scrollHeight - innerHeight) * 0.7);
      if (far > 200) {
        window.scrollTo(0, far); await sleep(150);
        const y = window.scrollY;
        MdView.setMode("active"); await waitView("active"); await sleep(250);
        const pm = MdActive.view.pm, c = pm.coordsAtPos(pm.state.selection.head);
        ok("reading -> active, scrolled down: the page stays where it is", Math.abs(window.scrollY - y) <= 2, [y, window.scrollY]);
        ok("… and the caret is on screen there", pm.hasFocus() && c.bottom > 0 && c.top < innerHeight, [c.top, innerHeight]);
        MdView.setMode("read"); await waitView("read"); await sleep(150);
        ok("active -> reading: still there", Math.abs(window.scrollY - y) <= 2, [y, window.scrollY]);
        window.scrollTo(0, 0); await sleep(100);
      }
    }

    // clicking the mode control
    document.querySelector('.seg-btn[data-mode="active"]').click();
    await waitView("active");
    ok("click on the control enters active", view() === "active" && seg() === "false,true,false");

    // find in the active mode
    key({ key: "f", code: "KeyF", ctrlKey: true });
    const input = document.getElementById("find-input");
    const word = ((MdActive.view.dom.querySelector("p") || MdActive.view.dom).firstChild.textContent.match(/[A-Za-z]{3,}/) || ["a"])[0];
    input.value = word;
    input.dispatchEvent(new Event("input"));
    await sleep(250);
    ok("find works in the active mode", /^\d+ of \d+$/.test(document.getElementById("find-count").textContent), document.getElementById("find-count").textContent);
    key({ key: "Escape", code: "Escape" });

    // outline in the active mode
    key({ key: "O", code: "KeyO", ctrlKey: true, shiftKey: true });
    await sleep(350);
    const items = document.querySelectorAll("#outline .menu-item");
    const heads = MdActive.view.dom.querySelectorAll("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]");
    ok("outline lists the headings", items.length === heads.length && items.length > 0, [items.length, heads.length]);
    if (items.length) {
      const target = heads[heads.length - 1];
      items[items.length - 1].click();
      await sleep(900);
      const top = target.getBoundingClientRect().top;
      ok("outline jumps to the heading in the active view", top > -5 && top < innerHeight / 2, top);
    }

    // a task ticked in the active mode is an edit: saved, and still the active mode
    const box = MdActive.view.dom.querySelector("li.task-item:not(.is-checked) > input.task");
    if (box) {
      box.scrollIntoView({ block: "center" });
      await sleep(100);
      const y = window.scrollY, label = box.closest("li").textContent.trim().split("\n")[0];
      box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      ok("the task shows as done", box.closest("li")?.classList.contains("is-checked") || MdActive.view.dom.querySelector("li.task-item.is-checked"));
      await sleep(1300); // autosave
      const line = MdView.core.current.text.split("\n").find((l) => l.includes(label));
      ok("ticking a task changes the file", /\[x\]/i.test(line || ""), line);
      ok("still in the active mode", view() === "active");
      ok("scroll position kept", Math.abs(window.scrollY - y) < 4, [y, window.scrollY]);
      ok("only that line changed", MdActive.view.serialize() === MdView.core.current.raw);
    } else ok("fixture has an open task", false);

    out({ pass: results.every((r) => r.ok), results });
  } catch (e) {
    out({ pass: false, error: String(e && e.stack || e), results });
  }
})();
