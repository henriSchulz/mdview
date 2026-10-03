/* LaTeX Suite (active/latexsuite.js): the machinery, against the examples of
 * the plugin's README and documentation. Typing is played key by key. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../", import.meta.url));
const window = { MdActive: {}, MdPrefs: {} };
const ctx = vm.createContext({ window, console });
for (const f of ["active/latex-snippets.js", "active/latexsuite.js"]) vm.runInContext(readFileSync(root + f, "utf8"), ctx, { filename: f });
const LS = window.MdActive.latexsuite, C = LS.core, list = LS.snippets();

/* A formula editor in miniature: text with the caret as "|" (a selection as "[…]"). */
function editor(block = true) {
  const s = { text: "", from: 0, to: 0, stops: [], cur: -1 };
  const put = (r) => {
    s.text = s.text.slice(0, r.from) + r.text + s.text.slice(r.to);
    const d = r.text.length - (r.to - r.from);
    for (const g of s.stops) for (const x of g) { if (x.from >= r.to) x.from += d; if (x.to >= r.to) x.to += d; }
    const stops = r.stops.length ? r.stops : [{ n: 0, from: r.text.length, to: r.text.length }];
    const groups = [...new Set(stops.map((t) => t.n))].sort((a, b) => a - b).map((n) => stops.filter((t) => t.n === n).map((t) => ({ from: r.from + t.from, to: r.from + t.to })));
    s.stops = [...groups, ...s.stops.slice(s.cur + 1)];
    if (r.enlarge) for (const e of C.enlarge(s.text)) {
      s.text = s.text.slice(0, e.from) + e.insert + s.text.slice(e.to);
      const dd = e.insert.length - (e.to - e.from);
      for (const g of s.stops) for (const x of g) { if (x.from >= e.to) x.from += dd; if (x.to >= e.to) x.to += dd; }
    }
    go(0);
  };
  const go = (i) => { s.cur = i; s.from = s.stops[i][0].from; s.to = s.stops[i][0].to; };
  const insert = (t) => {
    const d = t.length - (s.to - s.from);
    for (const g of s.stops) for (const x of g) { if (x.from > s.from) x.from += d; if (x.to >= s.to) x.to += d; }
    s.text = s.text.slice(0, s.from) + t + s.text.slice(s.to);
    s.from = s.to = s.from + t.length;
  };
  const state = () => ({ text: s.text, from: s.from, to: s.to, block });
  const key = (k) => {
    if (k === "\t") {
      const r = C.run(list, state(), "", false);
      if (r && !r.pass) return put(r);
      if (s.stops.length && s.cur < s.stops.length - 1) return go(s.cur + 1);
      s.stops = []; s.cur = -1;
      const c = C.contextAt(s.text, s.to, block);
      if (C.inMatrix(c)) {
        const nl = s.text.indexOf("\n", s.to), end = C.closingIn(s.text.slice(s.to, nl < 0 ? s.text.length : nl));
        if (end != null) { s.from = s.to = s.to + end; return; }
        return insert(" & ");
      }
      const t = C.tabout(s.text, s.to);
      if (t && t.pos != null) { s.from = s.to = t.pos; return; }
      if (t && t.exit) { s.exited = true; return; }
      return insert("\t");
    }
    const r = C.run(list, state(), k, true);
    if (r && !r.pass) return put(r);
    if (!r && ")]}".includes(k) && s.from === s.to && s.text[s.to] === k) { s.from = s.to = s.to + 1; return; } // (the editor types over a bracket closed for you)
    if (!r && k === "/") { const f = C.autofraction(state()); if (f) return put(f); }
    insert(k);
  };
  return { s, type(str) { for (const ch of str) key(ch); return this; }, get text() { return s.text; }, get shown() { return s.text.slice(0, s.from) + (s.from === s.to ? "|" : "[" + s.text.slice(s.from, s.to) + "]") + s.text.slice(s.to); },
    select(a, b) { s.from = a; s.to = b; s.stops = []; s.cur = -1; return this; } };
}
const typed = (str, block) => editor(block).type(str);

test("the README's first examples", () => {
  assert.equal(typed("xsr").text, "x^{2}");
  assert.equal(typed("x/y\t").shown, "\\frac{x}{y}|");
  assert.equal(typed("sin @t").text, "\\sin \\theta");
  assert.equal(typed("sqx").shown, "\\sqrt{ x| }");
  assert.equal(typed("a/b").shown, "\\frac{a}{b|}");
});
test("par, dint: tabstops and placeholders", () => {
  assert.equal(typed("par\t").shown, "\\frac{ \\partial [y] }{ \\partial x } ");
  assert.equal(typed("par\tf\tx\t").text, "\\frac{ \\partial f }{ \\partial x } ");
  assert.equal(typed("dint").shown, "\\int_{[0]}^{1}  \\, dx ");
  assert.equal(typed("dint\t2pi\tsin @t\t@t\t").text, "\\int_{0}^{2\\pi} \\sin \\theta \\, d\\theta ");
});
test("the cheatsheet", () => {
  const cases = { cb: "^{3}", "xrd": "x^{}", "x_": "x_{}", "//": "\\frac{}{}", 'x"': "x\\text{}", x1: "x_{1}", "x,.": "\\mathbf{x}", "x.,": "\\mathbf{x}", xdot: "\\dot{x}", xhat: "\\hat{x}", xbar: "\\bar{x}", xvec: "\\vec{x}", xtilde: "\\tilde{x}", xund: "\\underline{x}", ee: "e^{  }", ainvs: "a^{-1}" };
  for (const [k, v] of Object.entries(cases)) assert.equal(typed(k).text, v, k);
});
test("Greek letters, symbols, arrows", () => {
  const cases = { "@a": "\\alpha", "@G": "\\Gamma", ":e": "\\varepsilon", "@l": "\\lambda", ome: "\\omega", pi: "\\pi", Phi: "\\Phi", ooo: "\\infty", "->": "\\to", "!=": "\\neq", "<=": "\\leq", ">=": "\\geq", "=>": "\\implies", "+-": "\\pm", xx: "\\times", "**": "\\cdot", "...": "\\dots", RR: "\\mathbb{R}", "sum": "\\sum", nabl: "\\nabla", "x22": "x_{22}", "pi2": "\\pi_{2}" };
  for (const [k, v] of Object.entries(cases)) assert.equal(typed(k).text, v, k);
  assert.equal(typed("@a sr").text, "\\alpha^{2}");
  assert.equal(typed("\\sum\t").shown, "\\sum_{[i]=1}^{N} ");
});
test("typing a macro by hand is not disturbed", () => {
  assert.equal(typed("\\inft").text, "\\inft");
  assert.equal(typed("\\infty").text, "\\infty");
  assert.equal(typed("\\tox").text, "\\to x");
  assert.equal(typed("\\top").text, "\\top");
});
test("auto-fraction", () => {
  assert.equal(typed("(a + b(c + d))/").shown, "\\frac{a + b(c + d)}{|}");
  assert.equal(typed("1 + x/").text, "1 + \\frac{x}{}");
  assert.equal(typed("@a b/").text, "\\frac{\\alpha b}{}");
  assert.equal(typed("x^{a/").text, "x^{a/}", "not in an exponent");
  assert.equal(typed("\\text{a/").text, "\\text{a/}", "not in text");
});
test("brackets grow around sums, integrals and fractions", () => {
  assert.equal(typed("(a/").text, "\\left( \\frac{a}{} \\right)");
  assert.equal(typed("(sum").text, "\\left( \\sum \\right)");
  assert.equal(typed("(xsr").text, "(x^{2})");
  assert.equal(typed("lr(a/b").text, "\\left( \\frac{a}{b} \\right) ");
});
test("matrices: the environments, Tab and the cells", () => {
  const e = typed("pmat");
  assert.equal(e.shown, "\\begin{pmatrix}\n|\n\\end{pmatrix}");
  e.type("a\tb");
  assert.equal(e.text, "\\begin{pmatrix}\na & b\n\\end{pmatrix}");
  assert.equal(typed("pmat", false).shown, "\\begin{pmatrix}|\\end{pmatrix}");
  assert.equal(typed("iden3").text, "\\begin{pmatrix}\n1 & 0 & 0 \\\\\n0 & 1 & 0 \\\\\n0 & 0 & 1\n\\end{pmatrix}");
  const m = typed("pmat(a\t");
  assert.equal(m.shown, "\\begin{pmatrix}\n(a)|\n\\end{pmatrix}", "Tab leaves a bracket before it makes a cell");
});
test("tabout", () => {
  assert.equal(typed("sqx\t").shown, "\\sqrt{ x }|");
  assert.equal(typed("lr(x\t").shown, "\\left( x \\right) |", "the next tabstop comes first");
  assert.equal(typed("(x\t\t").shown, "(x)|");
  assert.equal(typed("\\left( x").select(8, 8).type("\t").shown, "\\left( x)|");
  const e = typed("x\t");
  assert.equal(e.s.exited, true, "at the end: out of the formula");
});
test("visual snippets", () => {
  const e = editor(); e.type("a+b"); e.select(0, 3); e.type("U");
  assert.equal(e.shown, "\\underbrace{ a+b }_{ | }");
  const c = editor(); c.type("a+b"); c.select(0, 3); c.type("C");
  assert.equal(c.text, "\\cancel{ a+b }");
  const p = editor(); p.type("a+b"); p.select(0, 3); p.type("(");
  assert.equal(p.text, "(a+b)");
  const f = editor(); f.type("a+b"); f.select(0, 3); f.type("/");
  assert.equal(f.shown, "\\frac{a+b}{|}");
});
test("in \\text{…} math snippets rest; mk makes \\( \\)", () => {
  assert.equal(typed("\\text{sr pi").text, "\\text{sr pi}");
  assert.equal(typed('x"sum').text, "x\\text{sum}");
  assert.equal(typed('"sum').text, "\\text{sum } ", "at the start of a line: the text with room after it");
  assert.equal(typed("\\text{mk").shown, "\\text{\\(|\\)}");
});
test("a mirrored tabstop, and beg", () => {
  assert.equal(typed(" beg").shown, " \\begin{|}\n\n\\end{}");
  assert.equal(typed("tayl").shown.startsWith("[f](x + h) = f(x)"), true);
});
test("a snippets file of one's own", () => {
  const own = C.parseUser('export default [\n {trigger: "foo", replacement: "\\\\bar{$0}", options: "mA"},\n {trigger: /q(\\d)/, replacement: "Q_{[[0]]}", options: "mA"}\n]');
  assert.equal(own.length, 2);
  const l = C.compile(own);
  assert.equal(C.run(l, { text: "fo", from: 2, to: 2, block: true }, "o", true).text, "\\bar{}");
  assert.equal(C.run(l, { text: "q", from: 1, to: 1, block: true }, "7", true).text, "Q_{7}");
  assert.equal(C.parseUser('[{trigger: "a", replacement: "b", options: "mA"}]').length, 1);
});
