// A formula as LaTeX writes it and KaTeX would not draw (viewer/markdown.js texHtml): a function of KaTeX's own as a sub-
// or superscript without braces — "s_\max", "a_\min", "e^\sin x" (Henri, 2026-11-17: those formulas were shown red).
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const NOTE = "Mit $s_\\max$ liegen $n = \\max\\left(2, \\lceil (T-2e)/s_\\max \\rceil + 1\\right)$ Linien. Diele S: $s_\\max = 900$ mm, $a_\\min$ und $e^\\sin x$.\n\n$$s_\\max = 2300$$\n\nFalsch: $\\frac{a$\n";

test("a function as a sub- or superscript without braces is drawn, as LaTeX reads it", async () => {
  const w = await loadPage();
  w.MdView.render({ name: "n.md", path: "/x/n.md", text: NOTE, links: {}, base: "file:///x/" });
  await new Promise((r) => setTimeout(r, 50));
  const shown = [...w.document.querySelectorAll("#content .katex, #content .katex-error")];
  const red = shown.filter((e) => e.classList.contains("katex-error")).map((e) => e.textContent);
  assert.deepEqual(red, ["\\frac{a"], "drawn red: " + JSON.stringify(red));
  // (the braces go where LaTeX puts them: the same as written with them)
  const C = w.MdView.core;
  assert.equal(C.texHtml("s_\\max", false, true), C.texHtml("s_{\\max}", false, true));
  assert.equal(C.texHtml("x^\\mathrm{T}", false, true), w.katex.renderToString("x^\\mathrm{T}", { throwOnError: true, strict: "ignore", output: "html" }), "a formula KaTeX draws is drawn as it was");
  assert.throws(() => C.texHtml("\\frac{a", false, true));
});
