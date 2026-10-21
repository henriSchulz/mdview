// The window of an app started by itself (desktop): a list of the folders opened last, each one a click away, and the buttons
// that open a folder or a file under it.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const opened = [];
after(() => { for (const w of opened) w.close(); });
async function start(recents) {
  const posted = [];
  const w = await loadPage([], (win) => { win.__TAURI_INTERNALS__ = {}; win.MdHost = { post: (m) => posted.push(JSON.parse(m)) }; });
  opened.push(w);
  w.MdView.clear(recents && { recents });
  return { w, posted, rows: [...w.document.querySelectorAll("#content [data-recent]")] };
}

test("nothing opened: the folders opened last stand in a list, newest first, above Open Folder… and Open File…", async () => {
  const { w, rows } = await start([{ name: "Notes", path: "/home/h/Notes" }, { name: "Uni", path: "/home/h/Docs/Uni" }]);
  assert.deepEqual(rows.map((r) => r.dataset.recent), ["/home/h/Notes", "/home/h/Docs/Uni"]);
  assert.match(rows[0].textContent, /Notes/);
  assert.match(rows[0].textContent, /~\/Notes/, "its place is said with ~ for the home folder");
  assert.deepEqual([...w.document.querySelectorAll("#content [data-empty]")].map((b) => b.dataset.empty), ["folder", "file"]);
});

test("a click on a folder of the list asks the shell to open it", async () => {
  const { posted, rows } = await start([{ name: "Notes", path: "/home/h/Notes" }]);
  rows[0].click();
  assert.deepEqual(posted.filter((m) => m.type === "recent"), [{ type: "recent", path: "/home/h/Notes" }]);
});

test("no folder opened yet: no list, the two buttons stay", async () => {
  const { w, rows } = await start([]);
  assert.equal(rows.length, 0);
  assert.equal(w.document.querySelector("#content .start-recent"), null);
  assert.equal(w.document.querySelectorAll("#content [data-empty]").length, 2);
});
