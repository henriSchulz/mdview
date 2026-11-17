// A picture written as SVG in a fence (viewer/markdown.js svgPicture): a <style> in it holds for it alone — not for the
// window it stands in (review 2026-11-17: "path { stroke: red }" in a figure made every icon of the window red).
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const FIG = '```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40" viewBox="0 0 100 40"><style>path { stroke: red } text { font-size: 30px }</style><path d="M0 0 L100 40"/><text x="5" y="30">A</text></svg>\n```\n';

test("a <style> in an SVG figure holds for that figure alone", async () => {
  const w = await loadPage();
  w.MdView.render({ name: "n.md", path: "/x/n.md", text: "# T\n\n" + FIG, links: {}, base: "file:///x/" });
  await new Promise((r) => setTimeout(r, 50));
  const svg = w.document.querySelector("#content svg[data-fig]");
  assert.ok(svg, "the figure has no name of its own: " + w.document.querySelector("#content").innerHTML.slice(0, 400));
  const styles = [...w.document.querySelectorAll("#content svg style")];
  assert.equal(styles.length, 1);
  assert.match(styles[0].textContent, new RegExp(`^@scope \\(svg\\[data-fig="${svg.getAttribute("data-fig")}"\\]\\) \\{`));
  assert.match(styles[0].textContent, /path \{ stroke: red \}/, "the figure's own rules are kept");
});

test("a figure without a style is as it was", async () => {
  const w = await loadPage();
  w.MdView.render({ name: "n.md", path: "/x/n.md", text: '```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0 L10 10"/></svg>\n```\n', links: {}, base: "file:///x/" });
  await new Promise((r) => setTimeout(r, 50));
  const svg = w.document.querySelector("#content svg");
  assert.ok(svg && !svg.hasAttribute("data-fig"));
});
