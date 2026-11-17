// The page's menus as the system's own, where the host has them (MdHost.menu — the macOS shell's NSMenu, viewer/base.js
// hostMenu; Henri, 2026-11-17: „nativer … mehr Apple-like“). What is handed over is the menu as it would stand — every row
// with its sign (docs/BUGS.md 117), its key, its tick, its menu beside it — and what the host answers is what is done; a
// menu with more than rows (a search, a bar, typing) stays the page's.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

let asked = null, answer = null;
const posts = [];
const w = await loadPage(ACTIVE, (win) => {
  win.__TAURI_INTERNALS__ = {}; // (a desktop, as the macOS shell says it is: FilesWeb.swift)
  win.MdHost = { post: (m) => posts.push(typeof m === "string" ? JSON.parse(m) : m), menu: (spec) => { asked = JSON.parse(JSON.stringify(spec)); return new Promise((r) => setTimeout(() => r(answer), 5)); } };
});
after(() => w.close());
const P = w.MdPage, A = w.MdActive;
const settle = () => new Promise((r) => setTimeout(r, 30));

test("a menu at a point: its rows go to the host — name as text, key, whether it can be chosen, danger, sign — and the row chosen runs", async () => {
  const ran = [];
  asked = null; answer = [2];
  P.menuAt(40, 50, [["<b>Copy</b>", "Ctrl+C", true, () => ran.push("copy"), "", P.sign("menu.copy")], null,
    ["Delete", "Del", true, () => ran.push("delete"), "danger", P.sign("menu.delete")], ["Paste", "Ctrl+V", false, () => ran.push("paste"), "", P.sign("menu.paste")]]);
  await settle();
  assert.ok(asked, "the host was not asked");
  assert.equal(asked.x, 40); assert.equal(asked.y, 50);
  assert.deepEqual(asked.rows.map((r) => r && [r.label, r.key, r.on, r.danger, r.sign]),
    [["Copy", "Ctrl+C", true, false, "copy"], null, ["Delete", "Del", true, true, "trash"], ["Paste", "Ctrl+V", false, false, "clip"]]);
  assert.deepEqual(ran, ["delete"]);
  assert.ok(!w.document.getElementById("textmenu").hasAttribute("data-open"), "the page drew its own menu too");
});

test("the file menu of a folder: the entries as they stand, each with its sign, Show › with its ticks; a choice is done", async () => {
  w.MdView.setFolder({ root: "/n", name: "n", tree: { name: "n", path: "/n", dirs: [{ name: "Sub", path: "/n/Sub", dirs: [], notes: [{ name: "a", path: "/n/Sub/a.md", real: "/n/Sub/a.md", title: null, mtime: 1, opened: 0 }] }],
    notes: [{ name: "b", path: "/n/b.md", real: "/n/b.md", title: null, mtime: 2, opened: 0 }] }, visible: true, width: 260, history: { state: "none" }, shared: [], looks: {} });
  await settle();
  const row = w.document.querySelector('#sidebar [data-key="/n/Sub"]');
  assert.ok(row, "no row for the folder");
  asked = null; answer = null;
  P.openCtx(row, 30, 60, "dir");
  assert.ok(P.ctxOpen(), "the menu is not held open while the host shows it (the sidebar would slide away under it)");
  await settle();
  assert.ok(asked && asked.rows.length > 5, "the host was not asked");
  const labels = asked.rows.map((r) => r && r.label);
  assert.ok(labels.includes("Copy Path") && labels.includes("Rename"), labels.join());
  assert.ok(asked.rows[0] && asked.rows.at(-1), "a rule at an end");
  assert.deepEqual(asked.rows.filter((r) => r && !r.sub && !r.sign && !r.svg).map((r) => r.label), [], "rows without a sign");
  const show = asked.rows.find((r) => r && r.sub);
  assert.ok(show && show.sub.some((r) => r && r.check === true), "Show › has no ticks");
  assert.ok(!P.ctxOpen(), "the menu stays open once the host has answered nothing");
  // a choice: the path of the folder copied
  posts.length = 0;
  answer = [labels.indexOf("Copy Path")];
  P.openCtx(w.document.querySelector('#sidebar [data-key="/n/Sub"]'), 30, 60, "dir");
  await settle();
  assert.deepEqual(posts.filter((m) => m.type === "copy").map((m) => m.text), ["/n/Sub"]);
  // … and one in the menu beside it: a kind of file listed or not, a setting said to the application
  posts.length = 0;
  answer = [asked.rows.indexOf(show), 0];
  P.openCtx(w.document.querySelector('#sidebar [data-key="/n/Sub"]'), 30, 60, "dir");
  await settle();
  assert.equal(posts.filter((m) => m.type === "prefs").length, 1, JSON.stringify(posts));
});

test("a note's menu of rows (the active mode): the host shows it, open meanwhile; the row chosen runs, none chosen is said", async () => {
  const ran = [];
  asked = null; answer = [2, 0];
  A.menu.open({ x: 10, y: 20, items: [{ label: "Bold", id: "menu.copy", key: "Ctrl+B", run: () => ran.push("bold") }, null,
    { label: "Turn Into", items: [{ label: "Heading", run: () => ran.push("heading") }, { label: "Quote", checked: true, run: () => ran.push("quote") }] }], closed: () => ran.push("closed") });
  assert.ok(A.menu.isOpen, "not open while the host shows it (the table's handles would go)");
  await settle();
  assert.deepEqual(asked.rows.map((r) => r && r.label), ["Bold", null, "Turn Into"]);
  assert.deepEqual(asked.rows[2].sub.map((r) => [r.label, r.check]), [["Heading", false], ["Quote", true]]);
  assert.ok(asked.rows[0].svg, "the row has no sign");
  assert.deepEqual(ran, ["heading"]);
  assert.ok(!A.menu.isOpen);
  answer = null;
  A.menu.open({ x: 10, y: 20, items: [{ label: "Bold", run: () => ran.push("bold") }], closed: () => ran.push("closed") });
  await settle();
  assert.deepEqual(ran, ["heading", "closed"]);
});

test("a menu with more than rows — searched, or with a bar — stays the page's", async () => {
  asked = null;
  A.menu.open({ x: 10, y: 20, find: () => [{ label: "Heading", run() {} }] });
  await settle();
  assert.equal(asked, null);
  assert.ok(A.menu.isOpen && !A.menu.el.hasAttribute("data-hosted"));
  A.menu.close();
});
