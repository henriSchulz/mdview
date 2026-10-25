// The share window: a shared note that cannot get to GitHub because both sides changed the same
// place says so, and offers to resolve it (2026-10-25: the link was a 404 for hours while the
// window only said that it works "once this is sent to GitHub").
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage([...ACTIVE, "active/share.js"]);
const A = w.MdActive, q = (s) => w.document.querySelector(s);
let resolving = 0;
A.conflict = { open: () => { resolving++; return true; }, isOpen: false };
const path = "/notes/Ethernet.md", told = { path, can: true, why: null, link: "https://notes.example/7", password: false, pending: true };
const fix = () => [...w.document.querySelectorAll("#share .share-foot .btn.primary")].find((b) => !b.hidden);

test("on its way to GitHub: said so, nothing to do", () => {
  assert.ok(A.share.open(path));
  A.share.got({ ...told, conflict: [] });
  assert.match(q("#share .share-text").textContent, /once this is sent to GitHub/);
  assert.equal(fix(), undefined);
  A.share.close();
});

test("held back by a conflict: which file, and the way to resolve it", () => {
  assert.ok(A.share.open(path));
  A.share.got({ ...told, conflict: ["mac-cast Stand.md"] });
  assert.match(q("#share .share-text").textContent, /until the conflict in mac-cast Stand\.md is resolved/);
  assert.equal(q("#share .share-link").value, told.link); // (the link is there all the same)
  assert.equal(fix()?.textContent, "Resolve Conflicts…");
  fix().click();
  assert.equal(resolving, 1);
  assert.equal(A.share.isOpen, false);
});

test("an older shell that does not say: as before", () => {
  assert.ok(A.share.open(path));
  A.share.got(told);
  assert.match(q("#share .share-text").textContent, /once this is sent to GitHub/);
  assert.equal(fix(), undefined);
  A.share.close();
});
