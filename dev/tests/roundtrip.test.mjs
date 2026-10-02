// Round trip, test A of the spec: load -> active mode -> serialize gives the
// file back byte for byte — for every document of the corpus, in every
// line-ending variant, in and outside a vault.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadPage, ACTIVE, ROOT } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive;
const lf = (s) => s.replace(/\r\n?/g, "\n");

function roundtrip(original, vault) {
  const d = A.document.open({ text: lf(original), raw: original, links: {}, vault });
  d.doc.check();
  return A.document.serialize(d);
}
function variants(src) {
  const body = lf(src);
  let i = 0;
  return {
    plain: body,
    crlf: body.replace(/\n/g, "\r\n"),
    cr: body.replace(/\n/g, "\r"),
    mixed: body.replace(/\n/g, () => ["\n", "\r\n", "\r"][i++ % 3]),
    bom: "﻿" + body,
    "no final newline": body.replace(/\n+$/, ""),
    "extra final newlines": body + "\n\n\n",
    "leading blank lines": "\n\n" + body,
  };
}
function check(name, src) {
  for (const [variant, text] of Object.entries(variants(src))) {
    for (const vault of [false, true]) {
      const out = roundtrip(text, vault);
      if (out === text) continue;
      let at = 0;
      while (at < out.length && out[at] === text[at]) at++;
      assert.fail(`${name} (${variant}${vault ? ", vault" : ""}) differs at offset ${at}: ` +
        `expected ${JSON.stringify(text.slice(at - 20, at + 40))}, got ${JSON.stringify(out.slice(at - 20, at + 40))}`);
    }
  }
}
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((f) => path.join(dir, f)) : []);
const DEV = path.join(ROOT, "dev");

test("fixtures", () => {
  const list = files(path.join(DEV, "tests/fixtures"));
  assert.ok(list.length > 5);
  for (const f of list) check(path.basename(f), fs.readFileSync(f, "utf8"));
});

const corpus = path.join(DEV, "corpus");
const skip = fs.existsSync(corpus) ? false : "run dev/fetch-corpus.sh for the external corpus";

test("CommonMark spec examples", { skip }, () => {
  const examples = JSON.parse(fs.readFileSync(path.join(corpus, "commonmark.json"), "utf8"));
  assert.ok(examples.length > 600);
  for (const e of examples) check(`example ${e.example} (${e.section})`, e.markdown);
});

// cmark-gfm's spec files: "```…``` example" blocks, "→" stands for a tab
function specExamples(file) {
  const out = [];
  const re = /^`{32} example[^\n]*\n([\s\S]*?)^\.\n[\s\S]*?^`{32}$/gm;
  for (const m of fs.readFileSync(file, "utf8").matchAll(re)) out.push(m[1].replace(/→/g, "\t"));
  return out;
}
test("GFM spec examples", { skip }, () => {
  for (const name of ["gfm-spec.txt", "gfm-extensions.txt"]) {
    const examples = specExamples(path.join(corpus, name));
    assert.ok(examples.length > 20, name);
    examples.forEach((src, i) => check(`${name} #${i + 1}`, src));
  }
});

test("real documents", { skip }, () => {
  const list = files(path.join(corpus, "docs"));
  assert.ok(list.length >= 20);
  for (const f of list) check(path.basename(f), fs.readFileSync(f, "utf8"));
});

// Local notes that must not be committed: MDVIEW_CORPUS=dir[:dir…]
test("local documents", { skip: process.env.MDVIEW_CORPUS ? false : "MDVIEW_CORPUS not set" }, () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : /\.md$/i.test(e.name) ? [path.join(dir, e.name)] : []);
  for (const dir of process.env.MDVIEW_CORPUS.split(":")) for (const f of walk(dir)) check(f, fs.readFileSync(f, "utf8"));
});

test("the view serializes what it shows", () => {
  for (const f of files(path.join(DEV, "tests/fixtures"))) {
    const text = fs.readFileSync(f, "utf8");
    A.view.show({ text: lf(text), raw: text, links: {}, vault: false });
    assert.equal(A.view.serialize(), text, path.basename(f));
  }
});
