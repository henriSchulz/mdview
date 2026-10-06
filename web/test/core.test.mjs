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
  // the last tab closed: its note goes, an empty tab stays — closed once more, that is the end
  assert.deepEqual(t.close(t.current.id), { show: null, fragment: null });
  assert.deepEqual([t.kept().paths, t.current.path], [[""], null]);
  assert.equal(t.closed, true);
  assert.deepEqual(t.close(t.current.id), { last: true });
  t.forget((p) => p !== "/c.md");
  assert.equal(t.current.path, null);
  assert.deepEqual(C.tabs(null).kept(), { paths: [""], active: 0 });
});

test("names, tasks, and what a commit is called", () => {
  assert.deepEqual([C.cleanName("  ..hidden/na\\me\t "), C.cleanName("A note"), C.cleanName("...")], ["hidden na me", "A note", ""]);
  const text = "# T\n- [ ] one\n> 1. [x] two\nplain\n";
  assert.equal(C.toggleTask(text, 1, true), "# T\n- [x] one\n> 1. [x] two\nplain\n");
  assert.equal(C.toggleTask(text, 2, false), "# T\n- [ ] one\n> 1. [ ] two\nplain\n");
  assert.deepEqual([C.toggleTask(text, 3, true), C.toggleTask(text, 99, true)], [null, null]);
  assert.equal(C.subject(["sub/Note.md"]), "Note.md");
  assert.equal(C.subject(["a.md", "b/c.md", "d.md", "e.md"]), "4 files: a.md, c.md, d.md, …");
});

test("the links to a PDF in the notes, as the viewer's highlights", () => {
  const notes = [
    [B + "/a.md", "intro\n> [!quote] [[docs/Paper.pdf#page=3&selection=4,0,5,20&color=red|p. 3]]\n> what was marked\nsee [[paper.pdf#page=2]] here and [[paper.pdf]] and [[other.pdf#page=1]]\n"],
    [B + "/b.md", "a [link](docs/My%20Paper.pdf#page=7) to another, and [one](<Paper.pdf#page=9>) to this\n"],
    [B + "/c.md", "nothing of it"], [B + "/d.md", null],
  ];
  assert.deepEqual(C.pdfBacklinks(B + "/docs/Paper.pdf", notes), [
    { path: B + "/a.md", name: "a.md", line: 1, frag: "page=3&selection=4,0,5,20&color=red", text: "what was marked" },
    { path: B + "/a.md", name: "a.md", line: 3, frag: "page=2", text: "see here and and" },
    { path: B + "/b.md", name: "b.md", line: 0, frag: "page=9", text: "a [link](docs/My%20Paper.pdf#page=7) to another, and [one](<Paper.pdf#page=9>) to this" },
  ]);
  assert.deepEqual(C.pdfBacklinks(B + "/docs/My Paper.pdf", notes).map((b) => [b.name, b.frag]), [["b.md", "page=7"]]);
});

test("the tree keeps a folder made here, and a renamed or deleted note leaves the tabs right", () => {
  const t = C.buildTree(B, ["a.md"], { keep: [B + "/New Folder", B + "/.hidden"] });
  assert.deepEqual(t.dirs.map((d) => d.name), ["New Folder"]);
  const tabs = C.tabs({ paths: ["/a.md", "/b.md", "/a.md"], active: 1 });
  tabs.open("/a.md", true);
  tabs.rename("/a.md", "/A2.md");
  assert.deepEqual([tabs.kept().paths, tabs.current.back], [["/A2.md", "/A2.md", "/A2.md"], ["/b.md"]]);
  tabs.drop("/A2.md");
  assert.deepEqual([tabs.kept().paths, tabs.current.path, tabs.current.back], [[""], null, ["/b.md"]]); // (only the tab on screen stays, empty)
});

test("three versions of a text are joined where the changes are apart", () => {
  const base = "one\ntwo\nthree\nfour\nfive\n";
  assert.deepEqual(C.merge3(base, "ONE\ntwo\nthree\nfour\nfive\n", "one\ntwo\nthree\nfour\nFIVE\nsix\n"), { text: "ONE\ntwo\nthree\nfour\nFIVE\nsix\n" });
  assert.deepEqual(C.merge3(base, base, "x\n"), { text: "x\n" }); // (only they changed)
  assert.deepEqual(C.merge3(base, "x\n", base), { text: "x\n" }); // (only I did)
  assert.deepEqual(C.merge3(base, "one\n2\nthree\nfour\nfive\n", "one\n2\nthree\nfour\nfive\n"), { text: "one\n2\nthree\nfour\nfive\n" }); // (both the same)
  assert.deepEqual(C.merge3(base, "zero\n" + base, base + "six\n"), { text: "zero\n" + base + "six\n" }); // (added at the two ends)
  assert.deepEqual(C.merge3(base, "one\nthree\nfour\nfive\n", "one\ntwo\nthree\nfour\n"), { text: "one\nthree\nfour\n" }); // (lines taken out, apart)
  assert.deepEqual(C.merge3("", "mine\n", ""), { text: "mine\n" });
  assert.deepEqual(C.merge3("a\nx\nb", "a\nx\nb\nc", "A\nx\nb"), { text: "A\nx\nb\nc" }); // (no line end at the end)
});

test("where both changed the same place it is for the user to say, place by place", () => {
  const base = "first\n\nmiddle\n\nlast\n";
  const out = C.merge3(base, "first, mine\n\nmiddle as I have it\n\nlast\n", "first\n\nmiddle as they have it\n\nlast, theirs\n");
  assert.deepEqual(out.parts, [{ same: "first, mine\n\n" }, { mine: "middle as I have it\n", base: "middle\n", theirs: "middle as they have it\n" }, { same: "\nlast, theirs\n" }]);
  // what the window makes of the picks is the file: mine, theirs, both
  const join = (pick) => out.parts.map((p) => (p.same != null ? p.same : pick === "both" ? p.mine + p.theirs : p[pick])).join("");
  assert.equal(join("theirs"), "first, mine\n\nmiddle as they have it\n\nlast, theirs\n");
  // changes that touch are one place
  const touch = C.merge3("a\nb\nc\n", "A\nb\nc\n", "a\nB\nc\n");
  assert.deepEqual(touch.parts, [{ mine: "A\nb\n", base: "a\nb\n", theirs: "a\nB\n" }, { same: "c\n" }]);
  // one deleted what the other changed; both made a file of the same name
  assert.deepEqual(C.merge3("x\ny\n", "y\n", "X\ny\n").parts[0], { mine: "", base: "x\n", theirs: "X\n" });
  assert.deepEqual(C.merge3("", "mine\n", "theirs\n").parts, [{ mine: "mine\n", base: "", theirs: "theirs\n" }]);
});
