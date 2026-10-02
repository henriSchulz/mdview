// The clipboard: Markdown pasted keeps its spelling, HTML from elsewhere
// becomes plain Markdown, a copy is Markdown.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState, TextSelection, AllSelection } = PM.state;
const C = A.clip;

function doc(text) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const view = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    dispatch(tr) { this.state = this.state.apply(tr); },
    dom: w.document.createElement("div"),
  };
  const at = (needle, after = true) => {
    let found = -1;
    view.state.doc.descendants((n, pos) => { if (found < 0 && n.isText && n.text.includes(needle)) found = pos + n.text.indexOf(needle) + (after ? needle.length : 0); });
    assert.ok(found >= 0, "not in the document: " + needle);
    return found;
  };
  return {
    view,
    md: () => A.document.serialize(d, view.state.doc, false),
    caretAfter(needle) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at(needle)))); return this; },
    select(a, b) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at(a, false), at(b)))); return this; },
    // HTML from another program, as the editor reads it on paste
    pasteHtml(html) {
      const box = w.document.createElement("div");
      box.innerHTML = C.clean(html);
      const slice = PM.model.DOMParser.fromSchema(A.schema).parseSlice(box, { preserveWhitespace: false, context: view.state.selection.$from });
      view.dispatch(view.state.tr.replaceSelection(slice));
      return this;
    },
    copy() { return C.markdownOf(view.state, view.state.selection.content()); },
  };
}

test("Markdown pasted keeps the way it is written", () => {
  const pasted = "Title\n=====\n\n* one\n* __two__\n\n1) a\n2) b\n\n| x|y |\n|-|-|\n|1|2|\n\n~~~py\ncode\n~~~";
  let e = doc("First.\n\n\n\nLast.\n");
  e.caretAfter("First.");
  e.view.dispatch(e.view.state.tr.split(e.view.state.selection.from));
  C.insertMarkdown(e.view, pasted);
  assert.equal(e.md(), "First.\n\n" + pasted + "\n\nLast.\n");

  e = doc("Some text here.\n").caretAfter("Some ");
  C.insertMarkdown(e.view, "__bold__ and `code`\n");
  assert.equal(e.md(), "Some __bold__ and `code`text here.\n", "a line into a line");

  e = doc("Before\n\nAfter\n").caretAfter("Before");
  C.insertMarkdown(e.view, " more\n\n- item\n\nnew [ref] para\n\n[ref]: http://x.y\n");
  assert.equal(e.md(), "Before more\n\n- item\n\nnew [ref] para\n\n[ref]: http://x.y\n\nAfter\n", "blocks into the middle; a definition comes along");

  e = doc("|a|b|\n|-|-|\n|1|2|\n").caretAfter("1");
  C.insertMarkdown(e.view, "x\n\n- y\n");
  assert.equal(e.md(), "|a|b|\n|-|-|\n|1x - y|2|\n", "blocks into a cell: their text on one line");

  e = doc("a\r\n\r\nb\r\n").caretAfter("a");
  e.view.dispatch(e.view.state.tr.split(e.view.state.selection.from));
  C.insertMarkdown(e.view, "* x\n* y");
  assert.equal(A.document.serialize(A.edit.docOf(e.view.state), e.view.state.doc, true), "a\r\n\r\n* x\r\n* y\r\n\r\nb\r\n", "the file's line endings");
});

test("plain text stays text", () => {
  const e = doc("Start end\n").caretAfter("Start ");
  C.insertPlain(e.view, "*not* [a](b) # x ");
  assert.equal(e.md(), "Start \\*not\\* \\[a\\](b) # x end\n");
});

test("HTML from elsewhere is reduced to Markdown", () => {
  assert.equal(C.clean('<meta charset="utf-8"><b style="font-weight:normal"><p style="color:red" class="x"><span style="font-size:20pt">Hi <b>there</b></span></p></b><script>x</script>'),
    "<p>Hi <strong>there</strong></p>");
  assert.ok(!C.foreign('<div style="color:#000"><span>plain</span></div>'), "only styled text: its plain text is read as Markdown");
  assert.ok(!C.foreign('<p data-pm-slice="1 1 []">own</p>'), "the editor's own HTML: its Markdown is taken");

  let e = doc("x\n").select("x", "x");
  e.pasteHtml(`<h2 class="t">A <i>title</i></h2>
    <p>Text with <b>bold</b>, <em>italic</em>, <del>gone</del>, <code>code</code>, a <a href="https://example.com/a" class="k">link</a> and <u>underline</u> <span style="color:red">colour</span>.</p>
    <ul><li>one</li><li>two<ul><li>inner</li></ul></li></ul>
    <ol start="3"><li>three</li><li>four</li></ol>
    <ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> open</li></ul>
    <blockquote><p>quoted</p></blockquote>
    <div class="highlight highlight-source-js"><pre><span class="k">let</span> a = 1;\n</pre></div>
    <table><thead><tr><th>Name</th><th align="right">Qty</th></tr></thead><tbody><tr><td>pear | fig</td><td>2</td></tr></tbody></table>
    <hr><p><img src="data:image/png;base64,AAAA" alt="no"><img src="https://example.com/p.png" alt="pic"></p>`);
  assert.equal(e.md(), [
    "## A *title*", "",
    "Text with **bold**, *italic*, ~~gone~~, `code`, a [link](https://example.com/a) and underline colour.", "",
    "- one", "- two", "  - inner", "",
    "3. three", "4. four", "",
    "- [x] done", "- [ ] open", "",
    "> quoted", "",
    "```js", "let a = 1;", "```", "",
    "| Name        | Qty |", "| ----------- | --: |", "| pear \\| fig | 2   |", "",
    "---", "",
    "![pic](https://example.com/p.png)", "",
  ].join("\n"));
  assert.ok(!/<[a-z]/i.test(e.md().replace(/```[\s\S]*?```/g, "")), "no HTML in the file");
});

test("copy: Markdown, unchanged blocks as they stand in the file", () => {
  const text = "Title\n=====\n\n* one\n* __two__ and more\n\n~~~py\ncode\n~~~\n\nLast *one*.\n";
  const e = doc(text);
  e.view.dispatch(e.view.state.tr.setSelection(new AllSelection(e.view.state.doc)));
  assert.equal(e.copy(), text.trim());
  e.select("two", "more");
  assert.equal(e.copy(), "__two__ and more", "part of a line");
  e.select("one", "Last");
  assert.equal(e.copy(), "* one\n* __two__ and more\n\n~~~py\ncode\n~~~\n\nLast", "from inside a list to inside a paragraph");
});
