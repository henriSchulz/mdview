// The emoji are found as markdown-it-emoji finds them, though a run of text that can hold none is kept from its pattern
// (viewer/markdown.js, emoji_skip — 2026-11-18: the pattern cost 15 ms of a 35 KB note's drawing).
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const w = await loadPage();
const md = w.MdPage.md;

// every name and face the plugin knows: taken from what it is given (its options' defaults)
const E = w.markdownitEmoji, full = E.full || E.default || E; // (as viewer/markdown.js takes it)
let known = null;
const plain = w.markdownit();
full({
  utils: { ...plain.utils, assign: (t, ...o) => { if (!known && o[0] && o[0].defs) known = o[0]; return Object.assign(t, ...o); } },
  renderer: { rules: {} }, core: { ruler: { after() {} } },
});
const names = Object.keys(known.defs);
const faces = Object.values(known.shortcuts).flat();
const ref = w.markdownit({ ...md.options }).use(full); // (the plugin as it is, without the skip; links found as the page finds them)
ref.linkify.set({ fuzzyLink: false });

const emoji = (m, src) => m.parse(src, {}).flatMap((t) => t.children || []).filter((t) => t.type === "emoji").map((t) => t.markup);
const types = (m, src) => m.parse(src, {}).flatMap((t) => t.children || []).map((t) => t.type);

test("every name and every face is an emoji still", () => {
  assert.ok(names.length > 1800 && faces.length > 60, `${names.length} names, ${faces.length} faces`);
  const src = names.map((n) => `:${n}:`).join(" ");
  assert.deepEqual(emoji(md, src), emoji(ref, src));
  assert.equal(emoji(md, src).length, names.length);
  for (const f of faces) assert.deepEqual(emoji(md, `so ${f} then`), emoji(ref, `so ${f} then`), f);
  assert.equal(emoji(md, faces.join(" ")).length, emoji(ref, faces.join(" ")).length);
});

test("prose with colons, times and links: what the plugin finds, and the runs are text again", () => {
  const src = "Ziel: schnell. Um 10:30:45 Uhr :) und ;-) — siehe https://example.com/a:b, <3 und 8-) aber nicht a:b oder x-y.\n\n" +
    "- **fett:** :smile: und *kursiv* :not_an_emoji: und :+1:\n- `code :smile:` [link :smile:](https://x.org) Ende";
  assert.deepEqual(emoji(md, src), emoji(ref, src));
  assert.ok(!types(md, src).includes("text_noemoji"), "a run left with the skip's type");
  const words = (m) => m.parse(src, {}).flatMap((t) => t.children || []).filter((t) => t.type === "text").map((t) => t.content).join("|");
  assert.equal(words(md), words(ref));
});
