/* Development probe (dev/rig.sh fileundo): what is done to a folder's files from All Notes and the sidebar — moved, renamed,
 * put in the trash, duplicated, hidden — taken back with Ctrl+Z and done again with Ctrl+Shift+Z; several moved together are
 * one step; where text is typed the keys stay the text's. Works on a copy of tests/overview-notes; the folder is read
 * from what the shell sends the page (its tree), after each step. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const until = async (f, ms = 4000) => { for (let t = 0; t < ms; t += 50) { if (f()) return true; await sleep(50); } return !!f(); };
  try {
    await document.fonts.ready;
    await until(() => window.MdOverview && MdOverview.isOpen && MdView.core.folder && MdView.core.folder.tree, 8000);
    await sleep(800);
    const root = MdView.core.folder.root;
    const all = () => { const out = [], walk = (d) => { for (const n of d.notes) out.push(n.path.slice(root.length + 1)); for (const x of d.dirs) { out.push(x.path.slice(root.length + 1) + "/"); walk(x); } }; walk(MdView.core.folder.tree); return out.sort(); };
    const has = (p) => all().includes(p);
    const key = (k, more = {}, at = document.body) => at.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...more }));
    const undo = () => key("z"), redo = () => key("Z", { shiftKey: true });
    const toast = () => document.getElementById("toast")?.textContent || "";
    ok("All Notes is open over the folder", MdOverview.isOpen && has("Reading list.md"), all());

    post("move", { path: root + "/Reading list.md", dir: root + "/Ideen" });
    await until(() => has("Ideen/Reading list.md"));
    undo(); await until(() => has("Reading list.md"));
    ok("Ctrl+Z over All Notes: a note moved into a folder is back where it was", has("Reading list.md") && !has("Ideen/Reading list.md"), all());
    ok("… and the message says what was undone", /Undid Move of “Reading list/.test(toast()), toast());
    redo(); await until(() => has("Ideen/Reading list.md"));
    ok("Ctrl+Shift+Z: moved again", has("Ideen/Reading list.md") && !has("Reading list.md"), all());
    undo(); await until(() => has("Reading list.md"));

    // (several dragged together: one move each, right after each other — one step)
    post("move", { path: root + "/Weekend Trip.md", dir: root + "/Projekte" }); post("move", { path: root + "/Workout routine.md", dir: root + "/Projekte" });
    await until(() => has("Projekte/Weekend Trip.md") && has("Projekte/Workout routine.md"));
    undo(); await until(() => has("Weekend Trip.md") && has("Workout routine.md"));
    ok("several moved together come back with one Ctrl+Z", has("Weekend Trip.md") && has("Workout routine.md") && !has("Projekte/Weekend Trip.md"), all());

    post("rename", { path: root + "/Lecture Notes.md", name: "Lectures" });
    await until(() => has("Lectures.md"));
    undo(); await until(() => has("Lecture Notes.md"));
    ok("a rename is taken back", has("Lecture Notes.md") && !has("Lectures.md"), all());

    post("duplicate", { paths: [root + "/Workout routine.md"] });
    await until(() => all().some((p) => /^Workout routine copy/.test(p)));
    const copy = all().find((p) => /^Workout routine copy/.test(p));
    undo(); await until(() => !has(copy));
    ok("a copy that was made goes again (to the trash)", !!copy && !has(copy) && has("Workout routine.md"), all());
    redo(); await until(() => has(copy));
    ok("… and Ctrl+Shift+Z brings it back", has(copy), all());

    post("trash", { path: root + "/Weekend Trip.md" });
    await until(() => !has("Weekend Trip.md"));
    undo(); await until(() => has("Weekend Trip.md"));
    ok("a note put in the trash is taken out again", has("Weekend Trip.md"), all());

    post("prefs", { prefs: { showHidden: false } }); await sleep(300);
    post("hide", { paths: [root + "/Ideen"], on: true });
    await until(() => !has("Ideen/"));
    undo(); await until(() => has("Ideen/"));
    ok("a folder hidden is shown again", has("Ideen/"), all());

    // (nothing more to take back: it says so, and changes nothing)
    const before = all().join("|");
    for (let i = 0; i < 8; i++) { undo(); await sleep(400); }
    ok("taken back to the start: the folder as it was at the beginning", !has(copy) && has("Lecture Notes.md") && has("Reading list.md"), all());
    undo(); await sleep(500);
    ok("… then Ctrl+Z says there is nothing to undo", /Nothing to undo/.test(toast()), toast());
    void before;

    // (in a field — renaming a tile — the keys are the field's)
    const tile = document.querySelector('#overview .ov-item[data-path$="/Lecture Notes.md"]');
    MdOverview.rename(tile); await sleep(300);
    const field = document.querySelector("#overview .ov-rename");
    const sent = key("z", {}, field);
    ok("Ctrl+Z in a name being typed is the field's own", !!field && sent, [!!field, sent]);
    field && field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  } catch (e) { o.error = String(e && e.stack || e); }
  out("fileundo", o);
})();
