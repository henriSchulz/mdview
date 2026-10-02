// Tests B and C of the spec: an edit changes the file only where it was made
// (locality), and the file then says what the editor shows (semantics).
// The edit: one word typed into a text block, at a random place.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadPage, ACTIVE, ROOT } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const DEV = path.join(ROOT, "dev");
const WORD = "Zq9x";
const lf = (s) => s.replace(/\r\n?/g, "\n");
function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const blocksOf = (doc) => { const out = []; doc.forEach((n) => { if (!(n.type.name === "island" && n.attrs.virtual)) out.push(n); }); return out; };

/* -> { edits, failures: [{ kind, where, … }] } */
function probe(name, src, perDoc, random) {
  const text = lf(src);
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const spots = []; // positions inside text nodes
  d.doc.descendants((node, pos) => {
    if (node.isText && !node.marks.some((m) => m.type.name === "code")) spots.push([pos, node.text.length]);
  });
  const failures = [];
  const base = PM.state.EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) });
  let edits = 0, loose = 0, impossible = 0;
  for (let k = 0; k < perDoc && spots.length; k++) {
    const [start, len] = spots[Math.floor(random() * spots.length)];
    const pos = start + Math.floor(random() * (len + 1));
    // typed as in the editor: with its plugins, which keep a bare address linking to what its text says
    const state = base.apply(base.tr.insert(pos, d.doc.type.schema.text(WORD, d.doc.resolve(pos).marks())));
    const tr = { doc: state.doc };
    const out = A.document.serialize(d, tr.doc, false);
    edits++;
    const where = `${name} @${pos} ${JSON.stringify(d.doc.textBetween(Math.max(0, pos - 12), Math.min(d.doc.content.size, pos + 12), "¶"))}`;
    // B: the lines the word did not land on are untouched. (The line after it
    // may change with it: the underline of a heading grows.) Strictly local
    // means more: take the word out and the old file is back. An edit can
    // rightly do more than that on its own line — a reference link whose text
    // changes needs its label written out, `__bold__` right after a letter
    // has to become `**bold**` — so that is counted, not required.
    if (out.split(WORD).join("") !== text) {
      loose++;
      const a = text.split("\n"), b = out.split("\n");
      // (A table with padded columns is padded again when a cell outgrows its column: its
      // other lines change in their spaces and dashes, nothing else.)
      const padding = (l) => /^\s*\|.*\|\s*$/.test(l) ? l.replace(/ +|-+/g, " ") : l;
      const bad = a.length !== b.length ? 0 : a.findIndex((l, i) => l !== b[i] && !b[i].includes(WORD) && !(i > 0 && b[i - 1].includes(WORD)) && padding(l) !== padding(b[i]));
      if (bad !== -1) {
        let i = 0; while (i < a.length && a[i] === b[i]) i++;
        let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
        failures.push({ kind: "locality", where, was: a.slice(i, a.length - j).join("\n").slice(0, 400), now: b.slice(i, b.length - j).join("\n").slice(0, 400) });
        continue;
      }
      if (process.env.MDVIEW_LOOSE) {
        const a2 = text.split("\n"), b2 = out.split("\n"), i = b2.findIndex((l, k) => l !== a2[k]);
        console.log(`loose ${where}\n   was: ${JSON.stringify(a2[i])}\n   now: ${JSON.stringify(b2[i])}`);
      }
    }
    // C: read again, the file gives the document the editor holds
    const again = blocksOf(A.document.open({ text: out, raw: out, links: {}, vault: false }).doc), now = blocksOf(tr.doc);
    const bad = again.length !== now.length ? -2 : now.findIndex((n, i) => !A.markdown.same(n, again[i]));
    // (what Markdown cannot say at all is not the serializer's failure: "x*(y)*" is no emphasis)
    if (bad >= 0 && !A.markdown.expressible(now[bad], d)) { impossible++; continue; }
    if (bad !== -1) failures.push({ kind: "semantics", where, block: bad });
  }
  return { edits, loose, impossible, failures };
}
function run(docs, perDoc, seed) {
  const random = rng(seed);
  let edits = 0, loose = 0, impossible = 0;
  const failures = [];
  for (const [name, src] of docs) {
    const r = probe(name, src, perDoc, random);
    edits += r.edits;
    loose += r.loose;
    impossible += r.impossible;
    failures.push(...r.failures);
  }
  return { edits, loose, impossible, failures };
}
function report(t, { edits, loose, impossible, failures }, allowed = 0) {
  t.diagnostic(`${edits} edits: ${edits - loose} strictly local, ${loose - failures.filter((f) => f.kind === "locality").length} changed more on their own line, ` +
    `${impossible} that Markdown cannot write, ${failures.length} failed`);
  if (process.env.MDVIEW_SHOW) for (const f of failures.slice(0, Number(process.env.MDVIEW_SHOW))) console.log(`${f.kind} ${f.where}\n   was: ${JSON.stringify(f.was)}\n   now: ${JSON.stringify(f.now)}`);
  if (failures.length > allowed) {
    const f = failures[0];
    assert.fail(`${failures.length} of ${edits} edits failed, e.g. ${f.kind}: ${f.where}` + (f.was != null ? `\n  was: ${JSON.stringify(f.was)}\n  now: ${JSON.stringify(f.now)}` : ""));
  }
}
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]) : []);
const corpus = path.join(DEV, "corpus");
const skip = fs.existsSync(corpus) ? false : "run dev/fetch-corpus.sh for the external corpus";

test("a word typed into a fixture changes only that place", (t) => {
  report(t, run(files(path.join(DEV, "tests/fixtures")), 60, 1));
});
test("… into a CommonMark example", { skip }, (t) => {
  const examples = JSON.parse(fs.readFileSync(path.join(corpus, "commonmark.json"), "utf8"));
  report(t, run(examples.map((e) => [`example ${e.example}`, e.markdown]), 4, 2));
});
test("… into a real document", { skip }, (t) => {
  report(t, run(files(path.join(corpus, "docs")), 40, 3));
});

export { probe, run, rng };
