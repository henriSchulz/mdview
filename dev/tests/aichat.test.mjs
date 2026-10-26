// The AI chat (ai.js) closes with a press outside it (Henri, 2026-10-26), as the panel at the right does; a press on it,
// in its menu or on the bubble does not (the bubble's own click shuts it once). The real app: dev/rig.sh ai.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const w = await loadPage(["ai.js"]);
const core = w.MdView.core;
core.ai.on = () => true; // (AI is the desktop's: here it is said to be on)
test.after(() => w.close()); // (the chat looks for another note every 600 ms: the window is shut, or the test never ends)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const press = (el) => {
  const o = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1 };
  el.dispatchEvent(new w.PointerEvent("pointerdown", o));
  el.dispatchEvent(new w.MouseEvent("mousedown", o));
  el.dispatchEvent(new w.MouseEvent("mouseup", o));
  el.dispatchEvent(new w.MouseEvent("click", o));
};
const chat = () => w.document.getElementById("ai-chat");
const open = async () => { if (!w.MdAi.chat.open) w.MdAi.chat.show(); await sleep(20); assert.ok(w.MdAi.chat.open); };

test("a press on the chat or in its menu leaves it open", async () => {
  await open();
  press(chat().querySelector(".ai-log"));
  press(chat().querySelector(".ai-field"));
  assert.ok(w.MdAi.chat.open);
  chat().querySelector('.ai-head .ai-ib[data-do="more"]').click();
  press(chat().querySelector(".ai-menu h6") || chat().querySelector(".ai-menu"));
  assert.ok(w.MdAi.chat.open);
  assert.equal(w.MdAi.state().menu, "more");
});

test("a press outside it closes it as its own close does: it fades, then is hidden", async () => {
  await open();
  press(w.document.getElementById("content"));
  assert.ok(!w.MdAi.chat.open, "closed");
  assert.ok(!chat().hidden, "still there while it fades");
  assert.ok(!w.document.body.hasAttribute("data-ai-chat"));
  await sleep(300);
  assert.ok(chat().hidden, "hidden once faded");
});

test("a press on the bubble is not one outside it (its click toggles it, once)", async () => {
  await open();
  const bubble = w.document.getElementById("ai-bubble");
  bubble.dispatchEvent(new w.PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
  assert.ok(w.MdAi.chat.open);
});
