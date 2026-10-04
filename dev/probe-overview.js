/* Development probe (dev/rig.sh overview): all notes of a folder as tiles — a tile per note with the
 * note's beginning in it, its colour, the folders' headings, the keys, opening a note from a tile.
 * Works on a copy of tests/overview-notes. */
(async () => {
  const out = (name, x) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const post = (type, data = {}) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  window.addEventListener("error", (e) => { o.jsError = String(e.message); });
  try {
    await document.fonts.ready; await sleep(1200);
    const ov = document.getElementById("overview"), btn = document.querySelector('#toolbar [data-act="overview"]');
    ok("the button shows in a folder window", btn && getComputedStyle(btn).display !== "none");
    btn.click();
    await sleep(1500);
    const tiles = [...ov.querySelectorAll(".ov-tile")];
    ok("open, with a tile for every note", ov.hasAttribute("data-open") && tiles.length === 8, tiles.length);
    ok("the notes are rendered into their tiles", tiles.filter((t) => t.querySelector(".ov-prev").children.length).length >= 7, tiles.map((t) => t.querySelector(".ov-prev").children.length));
    ok("a note's colour is its tile's", ov.querySelector('.ov-tile.ov-red .ov-name')?.textContent === "Reading list" && ov.querySelectorAll(".ov-tile[class*=' ov-']").length >= 5);
    ok("folders have their headings", [...ov.querySelectorAll(".ov-dir")].map((h) => h.textContent).join("|") === "Ideen|Projekte", [...ov.querySelectorAll(".ov-dir")].map((h) => h.textContent));
    ok("the note on screen is marked and has the focus", ov.querySelector(".ov-tile[aria-current]") === document.activeElement, document.activeElement && document.activeElement.className);
    ok("no ids from the notes in the page twice", new Set([...document.querySelectorAll("[id]")].map((x) => x.id)).size === document.querySelectorAll("[id]").length);
    const key = (k) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    const first = tiles[0]; first.focus();
    key("ArrowRight");
    ok("→ goes to the next tile", document.activeElement === tiles[1], document.activeElement.dataset.path);
    key("ArrowDown");
    ok("↓ goes a row down (into the next folder's grid)", document.activeElement !== tiles[1] && document.activeElement.classList.contains("ov-tile"), document.activeElement.dataset && document.activeElement.dataset.path);
    o.focusName = document.activeElement.querySelector(".ov-name")?.textContent;
    ok("tasks keep their boxes, links lead nowhere", !!ov.querySelector(".ov-prev input[type=checkbox]") && !ov.querySelector(".ov-prev a[href]"));
    out("shot", {});
    await sleep(1400); // screenshot
    key("Escape");
    await sleep(500);
    ok("Esc closes it", !ov.hasAttribute("data-open") && btn.getAttribute("aria-pressed") === "false");
    btn.click(); await sleep(700);
    const target = [...ov.querySelectorAll(".ov-tile")].find((t) => t.querySelector(".ov-name").textContent === "Decorations");
    target.focus(); target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(1200);
    ok("Enter opens the note and closes the tiles", !ov.hasAttribute("data-open") && document.title === "Decorations.md" && !!document.querySelector("#content blockquote.deco-block.deco-magenta"), document.title);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await sleep(500);
    ok("Ctrl+Alt+G opens it again, the note on screen marked", ov.hasAttribute("data-open") && ov.querySelector(".ov-tile[aria-current] .ov-name")?.textContent === "Decorations");
  } catch (e) { o.error = String(e && e.stack || e); }
  post("probe", { name: "ov", text: JSON.stringify(o) });
})();
