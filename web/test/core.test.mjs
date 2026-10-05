// What the web host works out, checked against what the desktop's shell does with the same input.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vm.runInThisContext(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "public", "host", "core.js"), "utf8"));
const C = globalThis.MdWebCore, B = "/octo/notes";

test("kinds of files, and names", () => {
  assert.deepEqual(["a.md", "b.MARKDOWN", "c.png", "d.pdf", "e.mp4", "f.opus", "g.csv", ".md", "README"].map(C.kindOf), ["md", "md", "image", "pdf", "video", "audio", "file", "file", "file"]);
  assert.deepEqual([C.nameOf("/a/b/Note 1.md"), C.dirOf("/a/b/Note 1.md"), C.stemOf("/a/b/Note 1.md"), C.stemOf("/a/.env")], ["Note 1.md", "/a/b", "Note 1", ".env"]);
  assert.deepEqual(["Note 10", "note 2", "Note 1", "Äpfel", "b"].sort(C.naturalCmp), ["b", "Note 1", "note 2", "Note 10", "Äpfel"]);
});

test("the tree is what the sidebar shows of a repository", () => {
  const files = ["Zeta.md", "alpha.md", "paper.pdf", "pic.png", "data.csv", ".mdview/project.json", ".obsidian/app.json", "sub/Deep.md", "sub/.hidden/x.md", "node_modules/pkg/readme.md", "empty/pic.png", "Lecture 10.md", "Lecture 2.md", "b/a/c.md"];
  const t = C.buildTree(B, files, { opened: { [B + "/alpha.md"]: 77 } });
  assert.deepEqual([t.name, t.path], ["notes", B]);
  assert.deepEqual(t.notes.map((n) => n.name), ["alpha", "Lecture 2", "Lecture 10", "paper.pdf", "Zeta"]); // (by name as a person sorts; a PDF with its ending)
  assert.deepEqual(t.dirs.map((d) => d.name), ["b", "sub"]); // (nothing hidden, nothing of tools, no folder without a note)
  assert.deepEqual(t.dirs[0].dirs[0].notes.map((n) => n.path), [B + "/b/a/c.md"]);
  const [alpha, , , pdf] = t.notes;
  assert.deepEqual([alpha.path, alpha.real, alpha.opened, alpha.pdf, alpha.title], [B + "/alpha.md", B + "/alpha.md", 77, undefined, null]);
  assert.deepEqual([pdf.pdf, pdf.kind], [true, "pdf"]);
  assert.equal(C.notesOf(t).length, 7);
  // what the settings add beside the notes; titles where they are wanted
  const more = C.buildTree(B, files, { show: ["pdf", "image", "other"], titles: new Map([[B + "/alpha.md", "Alpha, the first"]]) });
  assert.deepEqual(more.notes.map((n) => n.name), ["alpha", "data.csv", "Lecture 2", "Lecture 10", "paper.pdf", "pic.png", "Zeta"]);
  assert.equal(more.notes[0].title, "Alpha, the first");
  assert.deepEqual(more.dirs.map((d) => d.name), ["b", "empty", "sub"]);
  assert.deepEqual(C.buildTree(B, []), { name: "notes", path: B, dirs: [], notes: [] });
});

test("a note's title is its first heading, outside properties and code", () => {
  assert.equal(C.noteTitle("---\ntags: [a]\n---\n\n# The *real* title #\n\n# second"), "The real title");
  assert.equal(C.noteTitle("```\n# not this\n```\n~~~~\n# nor this\n~~~\n~~~~\n   # [[Target|Shown]] and [a link](x) ==marked=="), "Shown and a link marked");
  assert.equal(C.noteTitle("## only a second level\ntext"), null);
  assert.equal(C.noteTitle("---\nnever closed\n# Title"), "Title");
  assert.equal(C.noteTitle(""), null);
});

test("wikilinks lead where Obsidian finds them", () => {
  const paths = ["Home.md", "Projects/Plan.md", "Projects/Sub/Plan.md", "Archive/Plan.md", "Projects/paper.pdf", "pics/Photo.PNG", ".obsidian/app.json", "Projects/.trash/Gone.md"].map((p) => B + "/" + p);
  const r = C.resolver(B, paths, B + "/Projects");
  assert.equal(r.vault, B);
  assert.equal(r.resolve("Plan"), B + "/Projects/Plan.md"); // (beside the note)
  assert.equal(r.resolve("Home"), B + "/Home.md"); // (at the vault's root)
  assert.equal(r.resolve("Sub/Plan#Heading"), B + "/Projects/Sub/Plan.md"); // (a path below; the place in it is not part of the name)
  assert.equal(r.resolve("archive/plan"), B + "/Archive/Plan.md"); // (anywhere, by name and the folders named, whatever the case)
  assert.equal(r.resolve("photo.png"), B + "/pics/Photo.PNG");
  assert.equal(r.resolve("paper.pdf#page=3"), B + "/Projects/paper.pdf");
  assert.equal(r.resolve("Gone"), null); // (nothing hidden)
  assert.equal(r.resolve("Nowhere"), null);
  assert.equal(r.resolve("#only a heading"), null);
  assert.equal(r.resolve("../../../etc/passwd"), null); // (never out of the repository)
  // from another folder the nearest of two is the one below it, else the one least deep
  assert.equal(C.resolver(B, paths, B + "/Archive").resolve("Plan"), B + "/Archive/Plan.md");
  assert.equal(C.resolver(B, paths, B + "/pics").resolve("Plan"), B + "/Archive/Plan.md");
  // without a vault only what is below the note's folder is looked through
  const plain = C.resolver(B, paths.filter((p) => !p.includes(".obsidian")), B + "/Projects");
  assert.deepEqual([plain.vault, plain.resolve("Home"), plain.resolve("Sub/Plan")], [null, null, B + "/Projects/Sub/Plan.md"]);
  assert.deepEqual(C.wikiTargets("see [[A]] and [[B c|shown]], ![[pic.png|300]] but not [[\nbroken]]"), [{ target: "A", embed: false }, { target: "B c", embed: false }, { target: "pic.png", embed: true }]);
});

test("an address the page goes to is a file here, or elsewhere", () => {
  const files = "https://app.example/file";
  assert.deepEqual(C.linkPath("https://app.example/file/octo/notes/sub/A%20note.md#Some%20heading", files), { path: "/octo/notes/sub/A note.md", fragment: "Some heading" });
  assert.deepEqual(C.linkPath("https://app.example/file/octo/notes/pic.png", files), { path: "/octo/notes/pic.png", fragment: null });
  assert.equal(C.linkPath("https://example.org/file/octo/notes/a.md", files), null);
  assert.equal(C.linkPath("https://app.example/filex/a.md", files), null);
  assert.equal(C.linkPath("mailto:someone@example.org", files), null);
  assert.equal(C.linkPath("not an address", files), null);
});

test("tabs: each with its own way back, as the desktop keeps them", () => {
  const t = C.tabs({ paths: ["/a.md", "", "/b.md"], active: 2 });
  assert.deepEqual(t.told().tabs.map((x) => x.name), ["a.md", "", "b.md"]);
  assert.equal(t.current.path, "/b.md");
  t.open("/c.md", true); // (a link followed in the tab shown)
  assert.deepEqual(t.go(true), { show: "/b.md", fragment: null });
  assert.deepEqual(t.go(false), { show: "/c.md", fragment: null });
  assert.equal(t.go(false), null);
  const first = t.list[0].id;
  assert.deepEqual(t.select(first), { show: "/a.md", fragment: null });
  assert.equal(t.select(first), null); // (it is shown already)
  assert.equal(t.go(true), null); // (this tab has no way back: that was the other's)
  assert.deepEqual(t.add("/d.md", "Heading"), { show: "/d.md", fragment: "Heading" }); // (beside the one shown)
  assert.deepEqual(t.kept(), { paths: ["/a.md", "/d.md", "", "/c.md"], active: 1 });
  assert.equal(t.find("/c.md"), 3);
  assert.equal(t.find("/d.md"), -1); // (the one shown is not "another tab")
  // closing: the one shown gives its place to its neighbour; the last one is the window's to close
  assert.deepEqual(t.close(t.current.id), { show: null, fragment: null });
  assert.deepEqual(t.close(t.list[0].id), { same: true });
  assert.deepEqual(t.reopen(() => true), { show: "/a.md", fragment: null }); // (the one closed last, where it was)
  assert.deepEqual(t.kept().paths, ["/a.md", "", "/c.md"]);
  assert.deepEqual(t.move(t.list[2].id, 0), { same: true });
  assert.deepEqual([t.kept().paths, t.current.path], [["/c.md", "/a.md", ""], "/a.md"]);
  assert.deepEqual(t.others(t.list[0].id), { show: "/c.md", fragment: null });
  assert.deepEqual(t.close(t.current.id), { last: true });
  assert.equal(t.closed, true);
  t.forget((p) => p !== "/c.md");
  assert.equal(t.current.path, null);
  assert.deepEqual(C.tabs(null).kept(), { paths: [""], active: 0 });
});
