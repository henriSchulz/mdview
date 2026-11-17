// A formula typed in the text (active/mathtext.js): LaTeX Suite's snippets work between dollars that were typed —
// and nowhere else: a "$" that stood in the paragraph before ("$HOME", "a$b") does not make what follows a formula.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState, TextSelection } = PM.state;

function doc(raw) {
  const d = A.document.open({ text: raw, raw, links: {}, vault: false });
  const view = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    composing: false,
    dispatch(tr) { this.state = this.state.apply(tr); },
    // (as the editor's own: the plugins' props in turn, the first that takes it)
    someProp(name, f) { for (const p of this.state.plugins) { const v = p.props[name]; if (v && f(v)) return true; } return false; },
    dom: w.document.createElement("div"),
  };
  return {
    view,
    md: () => A.document.serialize(d, view.state.doc, false),
    end(needle) {
      let at = -1;
      view.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) + needle.length; });
      assert.ok(at >= 0, "not in the document: " + needle);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
      return this;
    },
    // typed key by key, as the editor takes a key: the plugins first, else the character goes in
    type(text) {
      for (const ch of text) {
        const { from, to } = view.state.selection;
        if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) view.dispatch(view.state.tr.insertText(ch, from, to));
      }
      return this;
    },
  };
}

// Review of 2026-11-17: a lone dollar earlier in the paragraph made everything typed after it LaTeX.
test("a dollar that stood in the text opens no formula: what is typed after it stays text", () => {
  assert.equal(doc("Set $HOME then\n").end("then").type(" different").md(), "Set $HOME then different\n");
  assert.equal(doc("Run a$b now\n").end("now").type(" iff").md(), "Run a$b now iff\n");
});

test("… and the rules for what is typed work after it", () => {
  const e = doc("Set $HOME then\n").end("then").type(" **bold** ");
  let bold = false;
  e.view.state.doc.descendants((n) => { if (n.isText && n.text === "bold" && n.marks.some((m) => m.type.name === "strong")) bold = true; });
  assert.ok(bold, "no bold: " + e.md());
});

test("a formula typed in the text still has the snippets, and becomes a formula when closed", () => {
  const e = doc("Hello\n").end("Hello").type(" $a iff");
  assert.match(e.md(), /\$a \\iff/);
  e.type(" b$").type(" different");
  assert.match(e.md(), /\$a \\iff b\$ different/);
});

test("a formula typed after a dollar that stood in the text is one", () => {
  assert.match(doc("Costs $5 and\n").end("and").type(" $x iff").md(), /Costs \$5 and \$x \\iff/);
});
