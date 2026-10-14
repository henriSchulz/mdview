/* Development probe (dev/rig.sh navigate): back and forward through notes and All Notes' folders, as a browser has them (Henri,
 * 2026-10-14: "from a note back into the folder I was in, and between folders back and forth") — the arrows beside the house,
 * Alt+← and Alt+→. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 30) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(30); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await until(() => window.MdOverview && MdOverview.isOpen && document.querySelector("#overview .ov-item"), 12000);
    await sleep(900);
    const ov = document.getElementById("overview"), back = document.querySelector('#tabs [data-act="navback"]'), fwd = document.querySelector('#tabs [data-act="navfwd"]');
    const crumbs = () => [...ov.querySelectorAll(".ov-title > *")].map((x) => x.textContent).filter(Boolean).join("/");
    const where = () => (MdOverview.isOpen ? "all:" + crumbs() : "note:" + (MdView.core.current && MdView.core.current.name));
    const tile = (name) => [...ov.querySelectorAll(".ov-item")].find((t) => (t.querySelector(".ov-name") || {}).textContent === name);
    ok("the strip has back and forward beside the house, nowhere to go yet", !!back && !!fwd && back.disabled && fwd.disabled, [!!back, back && back.disabled, fwd && fwd.disabled]);
    ok("the folder opens on All Notes, in itself", where() === "all:notes", where());
    tile("Projects").click();
    ok("into a folder", await until(() => where() === "all:notes/Projects"), where());
    tile("Plan").click();
    ok("a note opened from it", await until(() => where() === "note:Plan.md"), where());
    await sleep(600);
    ok("… back can be pressed now, forward not", !back.disabled && fwd.disabled);
    back.click();
    ok("back: All Notes, in the folder it came from", await until(() => where() === "all:notes/Projects"), where());
    back.click();
    ok("back again: the folder above", await until(() => where() === "all:notes"), where());
    ok("… back pressed out, forward there", await until(() => back.disabled && !fwd.disabled), [back.disabled, fwd.disabled]);
    fwd.click();
    ok("forward: into the folder again", await until(() => where() === "all:notes/Projects"), where());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true }));
    ok("Alt+→: the note again", await until(() => where() === "note:Plan.md"), where());
    await sleep(500);
    // from note to note by a link, and back
    window.MdHost.post(JSON.stringify({ type: "note", path: MdView.core.folder.root + "/Inbox.md" }));
    ok("another note", await until(() => where() === "note:Inbox.md"), where());
    await sleep(500);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true }));
    ok("Alt+←: the note before it", await until(() => where() === "note:Plan.md"), where());
    await sleep(400);
    back.click();
    ok("… and back on, to All Notes in its folder", await until(() => where() === "all:notes/Projects"), where());
  } catch (e) { o.error = String(e && (e.message + " " + e.stack) || e); }
  out("navigate", o);
})();
