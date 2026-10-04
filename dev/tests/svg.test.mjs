// A fence of SVG is drawn as its picture; what is not one <svg> stays code,
// and nothing that could run comes through.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const { md } = w.MdView.core;
const render = (text) => { const box = w.document.createElement("div"); box.innerHTML = md.render(text, { lineOffset: 0, links: {}, outline: [], depth: 0 }); return box; };

test("an svg fence is the picture", () => {
  const box = render('```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\n```\n');
  assert.ok(box.querySelector(".svg-block > svg circle"));
  assert.equal(box.querySelector(".code-block"), null);
});

test("blank lines inside it do not end it", () => {
  const box = render('```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n\n  <rect width="4" height="4"/>\n\n</svg>\n```\n');
  assert.ok(box.querySelector(".svg-block > svg rect"));
});

test("what could run is left out", () => {
  const box = render('```svg\n<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>x()</script><a href="javascript:x()"><rect onclick="x()" width="4" height="4"/></a><foreignObject><p>hi</p></foreignObject></svg>\n```\n');
  const svg = box.querySelector(".svg-block > svg");
  assert.ok(svg.querySelector("rect"));
  assert.equal(svg.querySelector("script, foreignObject"), null);
  assert.equal(svg.hasAttribute("onload"), false);
  assert.equal(svg.querySelector("rect").hasAttribute("onclick"), false);
  assert.equal(svg.querySelector("a").hasAttribute("href"), false);
});

test("code that is not one svg stays code", () => {
  for (const code of ["<svg><rect", "just words", "<div>no</div>"]) {
    const box = render("```svg\n" + code + "\n```\n");
    assert.equal(box.querySelector(".svg-block"), null, code);
    assert.ok(box.querySelector(".code-block code"), code);
  }
});
