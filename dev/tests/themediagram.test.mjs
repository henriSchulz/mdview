// The colours changed (light ↔ dark, viewer/render.js setTheme): a note with a Mermaid diagram is drawn anew in the
// reading view, so the diagram takes them (review 2026-11-17: a parameter named mode hid the view's mode, and it never was).
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

test("a note with a diagram is drawn anew when the colours change", async () => {
  let drawn = 0;
  // (Mermaid itself, which reads the page's colours, stands in by one that counts what it is asked to draw)
  const w = await loadPage([], (win) => {
    const add = win.Node.prototype.appendChild;
    win.Node.prototype.appendChild = function (el) {
      if (el && el.tagName === "SCRIPT" && /mermaid/.test(el.src || "")) {
        win.mermaid = { initialize() {}, render: async () => { drawn++; return { svg: "<svg></svg>" }; } };
        setTimeout(() => el.onload && el.onload(), 0);
        return el;
      }
      return add.call(this, el);
    };
  });
  const settle = () => new Promise((r) => setTimeout(r, 100));
  w.MdView.render({ name: "n.md", path: "/x/n.md", text: "# T\n\n```mermaid\ngraph TD\nA-->B\n```\n", links: {}, base: "file:///x/" });
  await settle();
  assert.ok(drawn >= 1, "the diagram was not drawn at all");
  const once = drawn;
  w.MdView.setTheme(":root{}", "dark", false);
  await settle();
  assert.equal(w.document.body.dataset.mode, "dark");
  assert.ok(drawn > once, "the diagram was not drawn anew in the new colours");
});
