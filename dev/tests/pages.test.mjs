// Pages in a note: the file taken apart into the views that are shown and edited, and a view put
// back — the rest of the file byte for byte as it was.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const w = await loadPage();
const P = w.MdView.core.pages;
const FILE = "# Main\n\ntext\n\n<!-- page: Meeting notes -->\n\n## Agenda\n\n- one\n\n<!-- page: Inner -->\ninner text\n<!-- /page -->\n\nafter inner\n\n<!-- /page -->\n\nmore\n\n<!-- page: Second -->\n\n<!-- /page -->\n\nend\n";

test("a note without pages is its own view", () => {
  for (const text of ["", "# A\n\ntext\n", "no newline at the end", "a\r\nb\r\n", "```\n<!-- page: in code -->\n<!-- /page -->\n```\n", "<!-- page: never closed -->\n\ntext\n", "text\n<!-- /page -->\nmore\n"]) {
    const root = P.parse(text);
    assert.equal(root.byId.size, 0, JSON.stringify(text));
    assert.equal(P.view(root), text);
    assert.equal(P.text(root), text);
    assert.equal(P.put(root, root, text), text);
  }
});

test("the file taken apart: a page is a line on the page it lies on, and a view of its own", () => {
  const root = P.parse(FILE);
  assert.equal(P.text(root), FILE); // (untouched: as it stands)
  assert.equal(P.view(root), "# Main\n\ntext\n\n<!-- page: Meeting notes #p1 -->\n\nmore\n\n<!-- page: Second #p3 -->\n\nend\n");
  const meeting = root.byId.get("p1"), inner = root.byId.get("p2"), second = root.byId.get("p3");
  assert.equal(P.view(meeting), "## Agenda\n\n- one\n\n<!-- page: Inner #p2 -->\n\nafter inner\n");
  assert.equal(P.view(inner), "inner text\n");
  assert.equal(P.view(second), "");
  assert.deepEqual([meeting.title, inner.title, inner.parent === meeting, meeting.parent === root], ["Meeting notes", "Inner", true, true]);
});

test("a view put back changes the file only there", () => {
  let root = P.parse(FILE);
  // typed in a page
  assert.equal(P.put(root, root.byId.get("p2"), "inner text, and more\n\nsecond line\n"), FILE.replace("inner text\n", "inner text, and more\n\nsecond line\n"));
  // … on the main page
  root = P.parse(FILE);
  assert.equal(P.put(root, root, P.view(root).replace("more", "MORE")), FILE.replace("\nmore\n", "\nMORE\n"));
  // a page that had nothing in it gets its text
  root = P.parse(FILE);
  assert.equal(P.put(root, root.byId.get("p3"), "now something\n"), FILE.replace("<!-- page: Second -->\n\n<!-- /page -->", "<!-- page: Second -->\n\nnow something\n<!-- /page -->"));
});

test("pages moved, removed, named anew, made and copied on the page they lie on", () => {
  // the two lines change places: the pages do, with all that is in them
  let root = P.parse(FILE), view = P.view(root);
  const a = "<!-- page: Meeting notes #p1 -->", b = "<!-- page: Second #p3 -->";
  let out = P.put(root, root, view.replace(a, "@").replace(b, a).replace("@", b));
  assert.ok(out.indexOf("<!-- page: Second -->") < out.indexOf("<!-- page: Meeting notes -->"));
  assert.ok(out.includes("<!-- page: Inner -->\ninner text\n<!-- /page -->"));
  assert.equal(P.view(P.parse(out)), view.replace(a, "@").replace(b, "<!-- page: Meeting notes #p2 -->").replace("@", "<!-- page: Second #p1 -->")); // (read anew: numbered as they stand)
  // its line removed: the page is gone from the file, with what was in it
  root = P.parse(FILE);
  out = P.put(root, root, P.view(root).replace(a + "\n\n", ""));
  assert.equal(out, "# Main\n\ntext\n\nmore\n\n<!-- page: Second -->\n\n<!-- /page -->\n\nend\n");
  // another name on its line
  root = P.parse(FILE);
  out = P.put(root, root, P.view(root).replace("Second #p3", "Renamed #p3"));
  assert.equal(out, FILE.replace("<!-- page: Second -->", "<!-- page: Renamed -->"));
  // a line for a page that is not there yet: an empty one is made
  root = P.parse("a\n");
  out = P.put(root, root, "a\n\n<!-- page: New #x9 -->\n");
  assert.equal(out, "a\n\n<!-- page: New -->\n\n\n<!-- /page -->\n");
  assert.equal(P.view(P.parse(out)), "a\n\n<!-- page: New #p1 -->\n");
  // the same line twice: two pages with the same in them
  root = P.parse("<!-- page: A -->\nx\n<!-- /page -->\n");
  out = P.put(root, root, "<!-- page: A #p1 -->\n\n<!-- page: A #p1 -->\n");
  assert.equal(out, "<!-- page: A -->\nx\n<!-- /page -->\n\n<!-- page: A -->\nx\n<!-- /page -->\n");
});

test("line ends as the file has them, and the file's line for a line of a view", () => {
  const crlf = FILE.replace(/\n/g, "\r\n");
  let root = P.parse(crlf);
  assert.equal(P.text(root), crlf);
  assert.equal(P.view(root.byId.get("p2")), "inner text\r\n");
  assert.equal(P.put(root, root.byId.get("p2"), "changed\r\n"), crlf.replace("inner text", "changed"));
  assert.match(P.view(root), /<!-- page: Meeting notes #p1 -->\r\n/);
  root = P.parse(FILE);
  const lines = FILE.split("\n");
  assert.equal(lines[P.fileLine(root, root, 2)], "text");
  assert.equal(lines[P.fileLine(root, root, 6)], "more");
  assert.equal(lines[P.fileLine(root, root.byId.get("p1"), 2)], "- one");
  assert.equal(lines[P.fileLine(root, root.byId.get("p1"), 6)], "after inner");
  assert.equal(lines[P.fileLine(root, root.byId.get("p2"), 0)], "inner text");
});

test("how a page's line looks: a word after \"page\", and a colour", () => {
  const file = "<!-- page card: A -->\na\n<!-- /page -->\n\n<!-- page card blue: B -->\nb\n<!-- /page -->\n\n<!-- page: C -->\nc\n<!-- /page -->\n";
  let root = P.parse(file);
  assert.equal(P.text(root), file);
  assert.equal(P.view(root), "<!-- page card: A #p1 -->\n\n<!-- page card blue: B #p2 -->\n\n<!-- page: C #p3 -->\n");
  assert.equal(JSON.stringify(P.lookOf("<!-- page card blue: B #p2 -->")), '{"style":"card","color":"blue"}');
  assert.equal(JSON.stringify(P.lookOf("<!-- page: C #p3 -->")), '{"style":"row","color":""}');
  // another look chosen for a line: the file says so, and nothing else changes
  const line = P.withLook("<!-- page: C #p3 -->", { style: "card" });
  assert.equal(line, "<!-- page card: C #p3 -->");
  assert.equal(P.put(root, root, P.view(root).replace("<!-- page: C #p3 -->", line)), file.replace("<!-- page: C -->", "<!-- page card: C -->"));
  root = P.parse(file);
  assert.equal(P.put(root, root, P.view(root).replace("page card: A", "page: A")), file.replace("<!-- page card: A -->", "<!-- page: A -->"));
  assert.equal(P.withLook("<!-- page card: A #p1 -->", { color: "red" }), "<!-- page card red: A #p1 -->");
  assert.equal(P.withLook("<!-- page card red: A #p1 -->", { style: "row" }), "<!-- page red: A #p1 -->");
  // the line as the page shows it
  const html = w.MdView.core.md.render("<!-- page card blue: B #p2 -->\n");
  assert.match(html, /^<div class="page-row" data-style="card" data-color="blue" style="--pc: var\(--c-blue\)" data-page="p2"/);
});

test("the looks that show what is on a page: what the page says about itself, and its line drawn", () => {
  const file = "<!-- page widget orange: Sheet 3 -->\n\n# Tasks\n\n- [x] one **done**\n- [ ] two\n- [ ] [[Plan|three]]\n\n```js\nmany words in code are not text\n```\n\n<!-- /page -->\n\n<!-- page sheet: Lecture -->\n\nStates and *systems*. A [link](https://example.org) too.\n\n![[fig.png]]\n\n$$\nE = mc^2\n$$\n\n<!-- page: Inner -->\ninner text here\n<!-- /page -->\n\n<!-- /page -->\n\n<!-- page preview: Nothing -->\n<!-- /page -->\n";
  const root = P.parse(file), tasks = P.facts(root.byId.get("p1")), lecture = P.facts(root.byId.get("p2")), none = P.facts(root.byId.get("p4"));
  assert.equal(P.text(root), file);
  const j = (x) => JSON.parse(JSON.stringify(x)); // (made in the page: another Array than the test's)
  assert.deepEqual(j(tasks.tasks), [{ text: "one done", done: true }, { text: "two", done: false }, { text: "three", done: false }]);
  assert.deepEqual([tasks.done, tasks.excerpt, tasks.shape], [1, "", "hcccf"]);
  assert.deepEqual([lecture.excerpt, j(lecture.subs), lecture.shape, lecture.words], ["States and systems. A link too.", ["Inner"], "tift", 12]);
  assert.deepEqual([none.excerpt, none.words, none.shape, none.subs.length], ["", 0, "", 0]);
  assert.deepEqual(j(P.STYLES), ["row", "card", "sheet", "preview", "widget"]);
  assert.equal(P.withLook("<!-- page card red: A #p1 -->", { style: "widget" }), "<!-- page widget red: A #p1 -->");
  assert.equal(JSON.stringify(P.lookOf("<!-- page preview: A #p1 -->")), '{"style":"preview","color":""}');
  // drawn where the page is not at hand: its name, and nothing made up about it
  const html = w.MdView.core.md.render("<!-- page widget blue: B #p2 -->\n\n<!-- page sheet: <C> #p3 -->\n");
  assert.match(html, /^<div class="page-row" data-style="widget" data-color="blue"[^>]*data-page="p2"[^>]*><span class="page-row-head">.*<span class="page-row-name">B<\/span><\/span>/);
  assert.match(html, /data-style="sheet" data-page="p3"[^>]*><span class="page-sheets" aria-hidden="true"><span class="page-sheet"><i class="h"><\/i><\/span><\/span><span class="page-row-text"><span class="page-row-name">&lt;C&gt;<\/span>/);
  // a link to another note is a row or a card: what is in that note is not at hand
  assert.deepEqual(j(P.link.STYLES), ["row", "card"]);
  assert.match(w.MdView.core.md.render("[[Plan]] <!-- link widget -->\n", { links: { Plan: {} } }), /^<div class="page-row link-row" data-style="card"/);
});
