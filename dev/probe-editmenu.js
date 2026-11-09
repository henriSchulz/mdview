/* Development probe (rig.sh editmenu): the edit menu under a held finger (viewer/touch.js) — iPadOS's row of words over the
 * finger, on text that can be edited only: the note in the active mode and a field. Elsewhere (beside the note, a code block,
 * the sidebar, the reading view) a held finger does what it did before, and a mouse's right click keeps its menus.
 * The finger is made up here: a pointer event of type touch, then what WebKitGTK makes of a held finger (a right button
 * pressed where it is, then "contextmenu"), then the lift. That WebKitGTK sends that for a real touch screen's finger is
 * `rig.sh gtktouch`'s; the rig has no touch screen of its own. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const root = document.documentElement;
  const o = { steps: [] };
  const ok = (label, good, detail) => o.steps.push((good ? "ok   " : "FAIL ") + label + (good || detail === undefined ? "" : "  (" + JSON.stringify(detail) + ")"));
  const em = () => document.getElementById("editmenu");
  const open = () => !!em() && em().hasAttribute("data-open");
  const words = () => [...em().querySelectorAll(".em-word")].map((b) => b.textContent).join("|");
  const word = (name) => [...em().querySelectorAll(".em-word")].find((b) => b.textContent === name);
  const otherMenu = () => ["ctxmenu", "textmenu", "ctxsub", "pickmenu"].some((id) => { const m = document.getElementById(id); return m && m.hasAttribute("data-open"); }) || !!(window.MdActive && MdActive.menu && MdActive.menu.isOpen);
  let fid = 20;
  const finger = (el, type, x, y, id) => { const e = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: "touch", pointerId: id, isPrimary: true, button: 0, buttons: type === "pointerdown" ? 1 : 0, clientX: x, clientY: y }); el.dispatchEvent(e); return e; };
  // a finger held at x, y as WebKitGTK tells of it (its long press: a right button where the finger is, then "contextmenu"), then lifted
  async function hold(x, y) {
    const el = document.elementFromPoint(x, y), id = ++fid;
    if (!el) throw new Error(`nothing at ${x}, ${y} to hold`);
    finger(el, "pointerdown", x, y, id);
    await sleep(80);
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerType: "mouse", pointerId: 1, isPrimary: true, button: 2, buttons: 2, clientX: x, clientY: y }));
    const c = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, button: 2, buttons: 2, clientX: x, clientY: y });
    el.dispatchEvent(c);
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerType: "mouse", pointerId: 1, isPrimary: true, button: 2, clientX: x, clientY: y }));
    await sleep(80);
    finger(el, "pointerup", x, y, id);
    await sleep(700); // (what follows the lift is swallowed a moment)
    return { el, held: c.defaultPrevented };
  }
  // a tap of a finger on a word of the menu: its press, its lift, the click (WebKitGTK sends none there: the lift is it)
  async function tap(el) {
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, id = ++fid;
    finger(el, "pointerdown", x, y, id); await sleep(40); finger(el, "pointerup", x, y, id);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  }
  const esc = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  // the middle of a word of a block's text, in the window
  const at = (el, w) => { el.scrollIntoView({ block: "nearest" }); const t = el.firstChild, i = t.data.indexOf(w), r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + w.length); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
  try {
    await document.fonts.ready; await sleep(1200);
    window.MdHost.post(JSON.stringify({ type: "note", path: window.MdView.core.folder.root + "/m5.md" }));
    await sleep(1500);
    window.MdView.setMode("active");
    for (let i = 0; i < 400 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(1000);
    const v = MdActive.view.pm, TS = PM.state.TextSelection, doc = () => v.state.doc;
    const para = (start) => [...v.dom.querySelectorAll(":scope > p")].find((p) => p.textContent.startsWith(start));
    const posOf = (text) => { let at = -1; doc().descendants((n, p) => { if (at < 0 && n.isText && n.text.includes(text)) at = p + n.text.indexOf(text); }); return at; };
    const p1 = para("First paragraph"), p2 = para("Second paragraph");
    v.focus();
    v.dispatch(v.state.tr.setSelection(TS.create(doc(), posOf("for the bar"))));
    await sleep(200);

    // --- held on the note's text, nothing selected
    const a = at(p1, "plain");
    let h = await hold(a.x, a.y);
    ok("a finger held on the note's text: the edit menu, and no other menu", open() && h.held && !otherMenu(), { open: open(), held: h.held, other: otherMenu() });
    ok("the hand is a finger, in a wide window (the bars' layout)", root.hasAttribute("data-finger") && root.hasAttribute("data-tiles"));
    ok("nothing selected: Paste, Select All", words() === "Paste|Select All", words());
    { const sel = v.state.selection, pa = posOf("plain");
      ok("held beside the caret: the caret goes to the finger (as with a right click)", sel.empty && Math.abs(sel.from - pa) <= 6, [sel.from, pa]); }
    ok("the note keeps the focus", document.activeElement === v.dom || v.dom.contains(document.activeElement), document.activeElement && document.activeElement.className);
    { const r = em().getBoundingClientRect(), cs = getComputedStyle(em()), px = (n) => parseFloat(cs.getPropertyValue(n));
      const lift = px("--v-edit-menu-lift"), m = px("--v-edit-menu-margin");
      ok("over the finger: its foot the lift above it, its middle at the finger's", Math.abs(r.bottom - (a.y - lift)) <= 1.5 && (Math.abs(r.left + r.width / 2 - a.x) <= 1.5 || r.left === m), { bottom: r.bottom, want: a.y - lift, mid: r.left + r.width / 2, x: a.x });
      ok("Velum's sizes: as tall as surface.editMenu.height, its corners its radius", Math.abs(r.height - px("--v-edit-menu-height")) < 0.5 && cs.borderTopLeftRadius === cs.getPropertyValue("--v-edit-menu-radius").trim(), [r.height, cs.borderTopLeftRadius]);
      const ws = [...em().querySelectorAll(".em-word")];
      ok("a hairline between the words, none before the first", getComputedStyle(ws[0]).borderLeftWidth === "0px" && ws.slice(1).every((w) => parseFloat(getComputedStyle(w).borderLeftWidth) > 0), ws.map((w) => getComputedStyle(w).borderLeftWidth));
      ok("it opens at once: no movement", cs.transitionDuration.split(",").every((d) => parseFloat(d) === 0) && cs.opacity === "1", [cs.transitionDuration, cs.opacity]); }

    // --- a tap beside it: shut, and nothing else
    { const b = at(p2, "menu"), el = document.elementFromPoint(b.x, b.y), id = ++fid; let clicked = 0;
      const sel = v.state.selection.from, count = () => { clicked++; };
      el.addEventListener("click", count);
      const down = finger(el, "pointerdown", b.x, b.y, id);
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: b.x, clientY: b.y }));
      finger(el, "pointerup", b.x, b.y, id);
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: b.x, clientY: b.y }));
      el.removeEventListener("click", count);
      ok("a tap beside it shuts it and is swallowed: the press held back, no click reaches the note, the caret stays", !open() && down.defaultPrevented && clicked === 0 && v.state.selection.from === sel, { open: open(), prevented: down.defaultPrevented, clicked });
      await sleep(30);
      const mid = +getComputedStyle(em()).opacity;
      await sleep(600);
      ok("… and it fades as a menu closes", mid > 0 && mid < 1 && getComputedStyle(em()).visibility === "hidden", mid); }

    // --- words selected
    const from = posOf("plain"), to = from + "plain".length;
    v.dispatch(v.state.tr.setSelection(TS.create(doc(), from, to)));
    await sleep(150);
    h = await hold(...Object.values(at(p1, "plain")));
    ok("words selected, held on them: Cut, Copy, Paste, Select All", open() && words() === "Cut|Copy|Paste|Select All", words());
    ok("the selection stays while the menu is open", v.state.selection.from === from && v.state.selection.to === to && getSelection().toString() === "plain", [v.state.selection.from, v.state.selection.to, getSelection().toString()]);
    { const fb = document.getElementById("fmtbar");
      ok("one menu over the text: the formatting bar of the selection steps back while it is open", !fb || getComputedStyle(fb).visibility === "hidden", fb && fb.hasAttribute("data-open")); }
    out("editmenu-shot", { look: root.dataset.look, velum: root.dataset.velumLook || "", dark: document.body.dataset.mode || "" });
    await sleep(2600); // (the rig takes its picture)
    ok("still open after a while", open());
    // Copy: the word blinks once, then the menu goes, the text as it was
    { const b = word("Copy"), seen = [];
      const mo = new MutationObserver(() => seen.push(b.classList.contains("hl")));
      mo.observe(b, { attributes: true, attributeFilter: ["class"] });
      await tap(b); await sleep(500); mo.disconnect();
      ok("Copy chosen: lit while pressed, then the word blinks once (off, on), then the menu goes", seen.join() === "true,false,true" && !open(), { seen, open: open() });
      ok("… the selection and the focus as they were", v.state.selection.from === from && v.state.selection.to === to && (document.activeElement === v.dom), [v.state.selection.from, v.state.selection.to]); }
    // Paste what was copied: in the second paragraph, where the finger holds
    { const before = doc().textContent, b = at(p2, "menu");
      await hold(b.x, b.y);
      ok("held on another paragraph: the caret goes there, Paste and Select All", open() && words() === "Paste|Select All", words());
      await tap(word("Paste")); await sleep(900);
      const now = doc().textContent;
      ok("Paste puts in what Copy took", now.length === before.length + 5 && (now.match(/plain/g) || []).length === (before.match(/plain/g) || []).length + 1, now.slice(0, 120));
      v.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true })); await sleep(300);
      ok("… and Ctrl+Z takes it back, as after the keys", doc().textContent === before, doc().textContent.slice(0, 120)); }
    // Cut
    { const before = doc().textContent;
      v.dispatch(v.state.tr.setSelection(TS.create(doc(), from, to))); await sleep(100);
      await hold(...Object.values(at(p1, "plain")));
      await tap(word("Cut")); await sleep(500);
      ok("Cut takes the selected words out", doc().textContent === before.replace("plain", ""), doc().textContent.slice(0, 80));
      v.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true })); await sleep(300);
      ok("… and Ctrl+Z puts them back", doc().textContent === before); }
    // Select All: the note's blocks as wholes, and their bar
    { const b = at(p2, "menu");
      await hold(b.x, b.y);
      await tap(word("Select All")); await sleep(600);
      const sel = MdActive.blocks.selection(v.state);
      ok("Select All chooses the note's blocks as wholes, and their bar comes", !!sel && sel.from <= 1 && sel.to >= doc().content.size - 1 && document.body.hasAttribute("data-ip-blocks"), sel && [sel.from, sel.to, doc().content.size]);
      await hold(b.x, b.y);
      ok("blocks chosen, a finger held on them: no edit menu (their bar has it)", !open() && !otherMenu());
      v.dispatch(v.state.tr.setSelection(TS.create(doc(), posOf("for the bar")))); await sleep(400); }

    // --- not on text: beside the note, a code block, the sidebar
    { const r = v.dom.getBoundingClientRect(), y = at(p1, "plain").y, x = Math.max(4, r.left - 40);
      const el = document.elementFromPoint(x, y);
      h = await hold(x, y);
      ok("held beside the note's text (its margin): no edit menu, no menu at all (as before)", !open() && !otherMenu() && h.held, { open: open(), other: otherMenu(), el: el && (el.id || el.className) }); esc(); await sleep(200); }
    { const code = v.dom.querySelector(".isl, pre"); code && code.scrollIntoView({ block: "center" }); await sleep(200);
      const r = code && code.getBoundingClientRect();
      if (!r) ok("a code block is there", false);
      else { await hold(r.left + 30, r.top + r.height / 2); ok("held on a code block: no edit menu", !open()); esc(); await sleep(300); } }
    { if (MdPage.showSidebar && !document.querySelector("#sidebar .sb-item")?.getClientRects().length) { MdPage.showSidebar(true); await sleep(900); }
      const row = [...document.querySelectorAll("#sidebar .sb-row, #sidebar [data-go], #sidebar [data-smart], #sidebar button")].find((r) => r.getClientRects().length && r.getBoundingClientRect().height > 0 && r.getBoundingClientRect().width > 40);
      if (!row || !row.getClientRects().length) ok("the sidebar is there", false, { row: !!row, sb: document.body.dataset.sidebar, rect: JSON.stringify(document.getElementById("sidebar").getBoundingClientRect()), items: [...document.querySelectorAll("#sidebar .sb-item")].map((i) => i.className + ":" + i.getClientRects().length).join(" "), w: innerWidth });
      else { const r = row.getBoundingClientRect(); await hold(r.left + 30, r.top + r.height / 2);
        ok(`held on a row of the sidebar (${row.textContent.trim().slice(0, 20)}): no edit menu`, !open(), { open: open() });
        esc(); await sleep(300); document.body.click(); await sleep(300); } }
    { const sbf = [...document.querySelectorAll("#sidebar input")].find((i) => i.getClientRects().length && !i.readOnly);
      // (no field shown in the sidebar: the find bar's)
      document.querySelector('#toolbar [data-act="find"]')?.click(); await sleep(900);
      const typed = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) ? document.activeElement : null; // (the find bar's field, as the look has it)
      const f = typed || (document.getElementById("find-input") && document.getElementById("find-input").getClientRects().length ? document.getElementById("find-input") : sbf);
      if (!f) ok("a field to hold", false);
      else {
        f.value = "hello world"; f.focus(); f.setSelectionRange(0, 5); await sleep(300);
        if (document.activeElement !== f) { ok("the field has the focus", false, document.activeElement && (document.activeElement.id || document.activeElement.className || document.activeElement.tagName)); f.focus(); f.setSelectionRange(0, 5); }
        const r = f.getBoundingClientRect();
        await hold(r.left + 20, r.top + r.height / 2);
        ok(`held on a field (${f.id || f.placeholder || f.className}) with words selected: Cut, Copy, Paste, Select All`, open() && words() === "Cut|Copy|Paste|Select All" && document.activeElement === f, [words(), document.activeElement && (document.activeElement.id || document.activeElement.tagName), f.selectionStart, f.selectionEnd, f.getBoundingClientRect().top]);
        if (!word("Cut")) throw new Error("no Cut for the field");
        await tap(word("Select All")); await sleep(700);
        ok("Select All selects the field's text, the field keeps the focus", f.selectionStart === 0 && f.selectionEnd === f.value.length && document.activeElement === f, [f.selectionStart, f.selectionEnd]);
        f.setSelectionRange(0, 5); await hold(r.left + 20, r.top + r.height / 2);
        await tap(word("Cut")); await sleep(700);
        ok("Cut takes the selected text out of the field", f.value === " world", f.value);
        await hold(r.left + 20, r.top + r.height / 2);
        await tap(word("Paste")); await sleep(700);
        ok("Paste puts it back", f.value === "hello world" || f.value === " worldhello" || /hello/.test(f.value), f.value);
        esc(); await sleep(300);
      } }

    // --- a mouse: the right click's menus, as before
    { await sleep(3100); // (a right button where no finger came down a moment before: a mouse's)
      const b = at(para("Filler paragraph 1 "), "words");
      const el = document.elementFromPoint(b.x, b.y);
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse", pointerId: 1, isPrimary: true, button: 2, buttons: 2, clientX: b.x, clientY: b.y }));
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: b.x, clientY: b.y }));
      await sleep(400);
      ok("a mouse's right click on the note's text: its own menu, no edit menu", !open() && !!(MdActive.menu && MdActive.menu.isOpen) && !root.hasAttribute("data-finger"), { open: open(), menu: !!(MdActive.menu && MdActive.menu.isOpen) });
      esc(); await sleep(300); }

    // --- the reading view: as before (no edit menu)
    { window.MdView.setMode("read"); await sleep(900);
      const p = [...document.querySelectorAll("#content p")].find((x) => x.textContent.startsWith("First paragraph"));
      const b = at(p, "plain");
      await hold(b.x, b.y);
      ok("the reading view: a held finger opens no edit menu", !open());
      esc(); await sleep(300); }
  } catch (e) { o.error = String(e) + " " + String(e && e.stack || ""); }
  out("editmenu", o);
})();
