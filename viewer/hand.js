/* mdview, the page — the hand: a finger, where the system does not say the screen is touched (Henri, 2026-10-24: the
 * application on Linux, with the fingers of a tablet that shows the Mac — mac-cast — on a touch screen of its own).
 * WebKitGTK, the web view of the application on Linux, tells of fingers as pointers of their own (pointerType "touch"), but
 * - says the pointer is a fine one (`pointer: coarse` does not hold): what a finger presses is a mouse's size. While the hand
 *   is a finger, `<html data-finger>` says so, and what is pressed on a whiteboard and over a PDF is a finger's size
 *   (board.css, pdfview.css), and the note has the iPad's bars instead of menus (viewer/touch.js). A finger sets it; a wheel
 *   turned or a touchpad's two fingers moved (no finger on the screen, none a moment before: WebKitGTK scrolls under a finger
 *   with wheels of its own), or a mouse's press, take it away.
 * - makes up a mouse after every tap: a mouse that moves to where the finger was, comes down and goes up — after it, as
 *   pointer events of a mouse (WebKitGTK alone: Chromium and Safari send only the older mouse events, which stay). Taken
 *   for a mouse's, the whiteboard would have done the tap a second time and the page would think the hand a mouse. They are
 *   not passed on; the click after them is.
 * - makes the whole page larger under two fingers (its own gesture) where the page does not take them: they are taken
 *   (a whiteboard, a PDF move and size what they show themselves: board/pointer.js, pdfview.js).
 * dev/rig.sh gtktouch tries it in WebKitGTK with a touch screen. */
"use strict";
(() => {
  const root = document.documentElement;
  // the engine, not the host: the application on Linux, and the web app in a WebKitGTK browser (Epiphany)
  const GTK = /\bLinux\b/.test(navigator.userAgent) && /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Android/.test(navigator.userAgent);

  const down = new Set(); // fingers on the screen
  let lifted = null; // where and when the last finger left it
  const finger = (on) => { if (on !== root.hasAttribute("data-finger")) root.toggleAttribute("data-finger", on); };
  addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") { down.add(e.pointerId); finger(true); } }, true);
  for (const type of ["pointerup", "pointercancel"]) addEventListener(type, (e) => { if (e.pointerType === "touch" && down.delete(e.pointerId)) lifted = { t: e.timeStamp, x: e.clientX, y: e.clientY }; }, true);
  addEventListener("wheel", (e) => { if (!e.ctrlKey && !down.size && (!lifted || e.timeStamp - lifted.t > 1500)) finger(false); }, { capture: true, passive: true });
  // the mouse made up after a tap (WebKitGTK): where the finger left, at once after it
  const madeUp = (e) => e.pointerType === "mouse" && !!lifted && e.timeStamp - lifted.t < 600 && Math.hypot(e.clientX - lifted.x, e.clientY - lifted.y) < 24;
  // a mouse's own press (or a touchpad's) takes it away too: the menus are back (viewer/touch.js)
  addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" && !down.size && !(GTK && madeUp(e))) finger(false); }, true);

  window.MdHand = { GTK, down: () => down.size };
  if (!GTK) return;
  for (const type of ["pointerover", "pointerenter", "pointermove", "pointerdown", "pointerup", "pointerout", "pointerleave"]) addEventListener(type, (e) => { if (madeUp(e)) e.stopImmediatePropagation(); }, true);
  // two fingers: the page's, never the web view's zoom of the whole
  for (const type of ["touchstart", "touchmove"]) addEventListener(type, (e) => { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { capture: true, passive: false });
})();
