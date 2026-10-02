// The active mode has to show what the reading view shows. Layout is compared
// in the real app (dev/rig.sh compare); this compares structure: every word
// and every leaf element with the elements around it, in both DOMs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadPage, ACTIVE, ROOT } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const { md, stripFrontmatter, stripComments, renderProps } = w.MdView.core;
const DEV = path.join(ROOT, "dev");

// what viewer.js draw() puts into #content
function readHtml(text, vault) {
  const fm = stripFrontmatter(text);
  md.set({ breaks: vault });
  const env = { lineOffset: fm.offset, links: {}, outline: [], depth: 0 };
  let html = md.render(stripComments(fm.body), env);
  if (fm.props) html = renderProps(fm.props, { links: env.links, depth: 1 }) + html;
  return html;
}
// Elements the active mode adds or the reading view leaves out, without effect on the look.
function wrapper(el) {
  const tag = el.tagName;
  if (tag === "DIV" && /^(isl|li-body|hid)\b/.test(el.className)) return true; // \b: ProseMirror adds its selection class
  if (tag === "SPAN" && (/^(ia|im)\b/.test(el.className) || !el.attributes.length)) return true;
  if (tag === "P" && el.parentElement.closest("li")) return true; // tight lists have none in the reading view
  return false;
}
const BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TABLE|THEAD|TBODY|TR|TD|TH|HR|DL|DT|DD|DETAILS|SUMMARY|SECTION|BR)$/;
const helper = (node) => node.nodeType === 1 && /^ProseMirror-(trailingBreak|separator)$/.test(node.className); // the editor's caret helpers
// nothing to see inside: no text, and no element but wrappers and helpers
// (white space counts as content inside an inline element: <em> </em> is a styled space)
const empty = (el) => [...el.childNodes].every((c) => (c.nodeType === 3 ? (BLOCK.test(el.tagName) ? !c.data.trim() : !c.data) : c.nodeType !== 1 || helper(c) || (wrapper(c) && empty(c))));
const KEEP = { A: ["href", "title", "class"], IMG: ["src", "alt", "title"], INPUT: ["type", "class", "checked", "disabled"], OL: ["start"], LI: ["class", "data-task"], UL: ["class"] };
function sig(el) {
  const attrs = (KEEP[el.tagName] || (/^H\d$/.test(el.tagName) ? ["id"] : ["class"]))
    .map((a) => [a, a === "class" ? [...new Set((el.getAttribute(a) || "").split(/\s+/))].filter((c) => c && !/^(ProseMirror-selectednode|typing|placeholder)$/.test(c)).join(" ") : el.getAttribute(a) || ""]).filter(([a, v]) => v || (el.hasAttribute(a) && a !== "class"))
    .map(([a, v]) => `${a}=${v}`).join(",");
  return el.tagName.toLowerCase() + (attrs ? `[${attrs}]` : "");
}
function tokens(root) {
  const out = [];
  let glue = false; // no white space and no block boundary since the last word
  const around = (node) => {
    const path = new Set(); // a set: emphasis inside emphasis is one mark in the editor
    for (let el = node.parentElement; el && el !== root; el = el.parentElement) if (!wrapper(el)) path.add(sig(el));
    return [...path].sort().join(" ");
  };
  const walk = (node) => {
    if (node.nodeType === 3) {
      if (node.parentElement.closest("[hidden]")) return;
      const where = around(node);
      for (const part of node.data.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { glue = false; continue; }
        const last = out[out.length - 1];
        if (glue && last && last.where === where && last.word != null) last.word += part; // one word over several text nodes
        else out.push({ word: part, where });
        glue = true;
      }
    } else if (node.nodeType === 1) {
      if (helper(node)) return;
      const block = BLOCK.test(node.tagName);
      if (block) glue = false;
      if (!wrapper(node) && empty(node)) { out.push({ leaf: sig(node), where: around(node) }); glue = false; }
      for (const c of node.childNodes) walk(c);
      if (block) glue = false;
    }
  };
  for (const c of root.childNodes) walk(c);
  return out.map((t) => `${t.word ?? t.leaf} <${t.where}>`);
}
function check(name, text, vault = false) {
  const src = text.replace(/\r\n?/g, "\n");
  if (!src.trim()) return; // an empty file: a notice there, an empty paragraph to write in here
  const read = w.document.createElement("div");
  read.innerHTML = readHtml(src, vault);
  w.MdActive.view.show({ text: src, raw: src, links: {}, vault });
  const a = tokens(read).join("\n"), b = tokens(w.MdActive.view.dom).join("\n");
  if (a !== b) {
    const x = a.split("\n"), y = b.split("\n");
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    assert.fail(`${name}${vault ? " (vault)" : ""}: token ${i}\n  read:   ${x.slice(i, i + 3).join(" | ")}\n  active: ${y.slice(i, i + 3).join(" | ")}`);
  }
}
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((f) => path.join(dir, f)) : []);

test("fixtures show the same in both views", () => {
  for (const f of files(path.join(DEV, "tests/fixtures"))) for (const vault of [false, true]) check(path.basename(f), fs.readFileSync(f, "utf8"), vault);
});

const corpus = path.join(DEV, "corpus");
const skip = fs.existsSync(corpus) ? false : "run dev/fetch-corpus.sh for the external corpus";
test("CommonMark examples show the same in both views", { skip }, () => {
  for (const e of JSON.parse(fs.readFileSync(path.join(corpus, "commonmark.json"), "utf8"))) check(`example ${e.example}`, e.markdown);
});
test("real documents show the same in both views", { skip }, () => {
  for (const f of files(path.join(corpus, "docs"))) check(path.basename(f), fs.readFileSync(f, "utf8"));
});
