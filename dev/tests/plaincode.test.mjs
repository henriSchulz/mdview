// A code block without a language (or with one highlight.js does not know) has the colours the
// others have — Henri, 2026-10-26: "Code boxen haben kein design" (fences of shell commands with no
// language were drawn grey on grey). Commands, flags, strings, numbers, comments and variables
// get the theme's code colours; a block that says it is text stays plain.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const { md } = w.MdView.core;
const render = (text) => { const box = w.document.createElement("div"); box.innerHTML = md.render(text, { lineOffset: 0, links: {}, outline: [], depth: 0 }); return box; };
const spans = (box, cls) => [...box.querySelectorAll(".code-block code ." + cls)].map((s) => s.textContent);

test("a fence without a language is coloured (Henri's note)", () => {
  const box = render("```\n-y /cad/xilinx/Vivado/2023.2/data/verilog/src/unisims\n+libext+.v\n\n```\n\n```\nsimake ultraclean\nrunsda ultraclean\nsimake compile\n```\n");
  assert.deepEqual(spans(box, "hljs-attr"), ["-y", "+libext+.v"]);
  assert.deepEqual(spans(box, "hljs-built_in"), ["simake", "runsda", "simake"]);
  // the text is the code, unchanged
  assert.equal(box.querySelectorAll(".code-block code")[1].textContent, "simake ultraclean\nrunsda ultraclean\nsimake compile\n");
  assert.equal(box.querySelectorAll(".code-block .code-copy").length, 2);
});

test("strings, numbers, comments, variables, pipes and continued lines", () => {
  const box = render("```\n# build it\ncd $M/syn && make -j 8 \\\n  TARGET=\"top level\" | tee log # done\n```\n");
  assert.deepEqual(spans(box, "hljs-comment"), ["# build it", "# done"]);
  assert.deepEqual(spans(box, "hljs-built_in"), ["cd", "make", "tee"]);
  assert.deepEqual(spans(box, "hljs-attr"), ["-j"]);
  assert.deepEqual(spans(box, "hljs-number"), ["8"]);
  assert.deepEqual(spans(box, "hljs-string"), ['"top level"']);
  assert.deepEqual(spans(box, "hljs-template-variable"), ["$M"]);
});

test("an unknown language and an indented block are coloured too; text stays text", () => {
  assert.deepEqual(spans(render("```xrun\nxrun -f args\n```\n"), "hljs-built_in"), ["xrun"]);
  assert.deepEqual(spans(render("Text\n\n    simake compile\n"), "hljs-built_in"), ["simake"]);
  assert.equal(render("```text\nsimake compile\n```\n").querySelector(".code-block code span"), null);
});

test("what is in it is escaped", () => {
  const box = render("```\necho \"<b>\" > <i>x</i>\n```\n");
  assert.equal(box.querySelector(".code-block b, .code-block i"), null);
  assert.equal(box.querySelector(".code-block code").textContent, "echo \"<b>\" > <i>x</i>\n");
});

test("the active mode's code dialog colours such code as the note does", () => {
  assert.match(w.MdView.core.plainCode("simake compile"), /hljs-built_in">simake</);
});
