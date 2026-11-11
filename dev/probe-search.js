/* Development probe (dev/rig.sh search): Search in a folder window (viewer/search.js, search.rs) — Ctrl+K opens it, the shell
 * finds the notes with every word among four hundred, the page shows them whole and by their blocks, the note at the right
 * scrolled to the block; Enter opens the note at the block (far down in a long note, under properties), Ctrl+Enter in a new
 * tab, a block of the note on screen only scrolls to it; Esc and a press beside it close it. */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [], times: {} };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 25) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(25); } return false; };
  const P = window.MdPage;
  try {
    await until(() => P.folder && P.current, 10000);
    await sleep(800);
    const box = document.getElementById("search"), input = box.querySelector("input");
    const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const rows = () => [...box.querySelectorAll(".sr-row")].map((r) => [...r.children].map((c) => c.textContent.trim()).filter(Boolean).join(" "));
    const key = (el, k, more = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
    const type = async (q) => {
      const t0 = performance.now(), before = box.querySelector(".sr-list").innerHTML;
      input.value = q; input.dispatchEvent(new Event("input", { bubbles: true }));
      await until(() => box.querySelector(".sr-list").innerHTML !== before && box.querySelector(".sr-h")?.textContent !== "Recent");
      return Math.round(performance.now() - t0);
    };

    // ---- Ctrl+K: Search, not Go to
    key(document.body, "k", { ctrlKey: true });
    await sleep(300);
    ok("Ctrl+K in a folder window opens Search", shown(box) && !shown(document.getElementById("palette")) && document.activeElement === input, [shown(box), document.activeElement && document.activeElement.tagName]);
    ok("… with the notes opened last", box.querySelector(".sr-h")?.textContent === "Recent" && rows().length > 0, rows().slice(0, 3));
    const r = box.getBoundingClientRect();
    ok("… in the middle of the room beside the sidebar, the note at its right", r.width > 600 && r.top > 0 && r.bottom < innerHeight && shown(box.querySelector(".sr-peek")), [r.left, r.width, innerWidth]);

    // ---- typing a letter at a time: each answered, and the window never stands still (#58, Henri: „laggt extrem bei tippen jeder
    // buchstabe kommt mit sekunden langer verzögerung“ — a single letter marked thousands of times in the note at the right)
    {
      const gaps = []; let last = performance.now(), on = true;
      const tick = (t) => { gaps.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      for (const q of ["m", "me", "mem", "memb", "membr"]) { input.value = q; input.dispatchEvent(new Event("input", { bubbles: true })); await sleep(160); }
      await sleep(1500); on = false;
      o.times.typingWorstFrame = Math.round(Math.max(...gaps));
      ok("typing a letter at a time: no frame longer than 600 ms (" + o.times.typingWorstFrame + " ms; #58)", o.times.typingWorstFrame < 600 && /Membrane notes/.test(box.querySelector(".sr-where").textContent), [o.times.typingWorstFrame, box.querySelector(".sr-where").textContent]);
    }

    // ---- a word among four hundred notes
    o.times.uniform = await type("uniform");
    ok("the notes with the word, found among 400 in a moment (" + o.times.uniform + " ms, 90 of them the page's wait for the last key)", o.times.uniform < 600 && rows().some((x) => x.startsWith("Uniform convergence")) && rows().some((x) => x.startsWith("Sheet 8")), [o.times.uniform, rows().slice(0, 6)]);
    const seg = (s) => box.querySelector(`.sr-seg [data-scope="${s}"] i`).textContent;
    ok("… four notes, the blocks counted", seg("notes") === "4" && Number(seg("blocks")) >= 6, [seg("notes"), seg("blocks")]);
    key(input, "Tab"); key(input, "Tab"); await sleep(200);
    ok("Tab twice: the blocks alone", box.querySelector('.sr-seg [aria-selected="true"]')?.dataset.scope === "blocks" && box.querySelector(".sr-h").textContent === "Blocks", box.querySelector(".sr-h")?.textContent);
    ok("… a task, code and a callout among them, each in its note", rows().some((x) => /Uniform convergence.*learn the uniform bound/i.test(x)) && rows().some((x) => /Deep.*uniform_bound/.test(x)) && rows().some((x) => /Sheet 8.*uniform/i.test(x)), rows());
    // the block far down, under properties: at the right, scrolled to it and outlined
    const far = [...box.querySelectorAll(".sr-row")].findIndex((x) => /the far uniform paragraph/i.test(x.textContent));
    ok("the paragraph far down is one of them", far >= 0, rows());
    for (let i = 0; i < 40 && !box.querySelector(".sr-row.hl")?.textContent.match(/far uniform/i); i++) { key(input, "ArrowDown"); await sleep(60); }
    await sleep(200);
    const at = box.querySelector(".sr-doc .sr-at"), doc = box.querySelector(".sr-doc");
    const inView = (el, sc) => { const a = el.getBoundingClientRect(), b = sc.getBoundingClientRect(); return a.top >= b.top - 1 && a.bottom <= b.bottom + 1; };
    ok("↓ to it: the note at the right scrolled to the block, which is outlined", !!at && /far uniform paragraph/i.test(at.textContent) && inView(at, doc) && doc.scrollTop > 200, [at && at.textContent.slice(0, 60), doc.scrollTop]);
    ok("… and the words marked there", doc.querySelectorAll("mark").length >= 3 && [...doc.querySelectorAll("mark")].every((m) => m.textContent.toLowerCase() === "uniform"), doc.querySelectorAll("mark").length);
    out("shot-search", {}); await sleep(2500);

    // ---- Enter: the note at the block
    const was = P.current && P.current.path;
    key(input, "Enter");
    await until(() => P.current && /Uniform convergence/.test(P.current.path), 6000);
    await sleep(900);
    const here = [...document.querySelectorAll("#content [data-line]")].find((x) => /far uniform paragraph/i.test(x.textContent) && x.tagName === "P");
    const hr = here && here.getBoundingClientRect();
    ok("Enter: Search shut, the note opened at the block (under its properties), the block in sight", !shown(box) && !!here && hr.top >= 0 && hr.bottom <= innerHeight, [shown(box), P.current.path, hr && [hr.top, hr.bottom, innerHeight]]);

    // ---- a block of the note on screen: only the way there
    window.scrollTo(0, 0); await sleep(300);
    key(document.body, "k", { ctrlKey: true }); await sleep(200);
    const tabsBefore = document.querySelectorAll("#tabs .tab").length;
    const pathNow = P.current.path;
    // (a word only this note has, further down: a heading)
    await type("closing uniform");
    key(input, "Tab"); key(input, "Tab"); await sleep(200);
    key(input, "Enter"); await sleep(900);
    const closing = [...document.querySelectorAll("#content h2")].find((h) => /closing uniform/i.test(h.textContent));
    ok("a block of the note on screen: the same note, scrolled to it", P.current.path === pathNow && !!closing && closing.getBoundingClientRect().top < innerHeight && window.scrollY > 100, [P.current.path, window.scrollY]);

    // ---- Ctrl+Enter: a new tab
    key(document.body, "k", { ctrlKey: true }); await sleep(200);
    await type("dini");
    key(input, "Enter", { ctrlKey: true });
    await until(() => document.querySelectorAll("#tabs .tab").length > tabsBefore, 5000);
    ok("Ctrl+Enter: the note in a tab of its own", document.querySelectorAll("#tabs .tab").length > tabsBefore, [tabsBefore, document.querySelectorAll("#tabs .tab").length]);
    await sleep(800);

    // ---- Esc, and a press beside it
    key(document.body, "k", { ctrlKey: true }); await sleep(200);
    key(input, "Escape"); await sleep(100);
    ok("Esc shuts it", !shown(box));
    key(document.body, "k", { ctrlKey: true }); await sleep(200);
    const y0 = window.scrollY;
    document.getElementById("content").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 5, clientY: innerHeight - 5 }));
    await sleep(100);
    ok("a press beside it shuts it, and does nothing else", !shown(box) && window.scrollY === y0);
    // ---- nothing found
    key(document.body, "k", { ctrlKey: true }); await sleep(200);
    await type("zzqxv");
    ok("nothing found: said", /No note has/.test(box.querySelector(".sr-none")?.textContent || ""), box.querySelector(".sr-list").textContent.slice(0, 80));
    key(input, "Escape");
  } catch (e) { o.error = String(e && e.stack || e); }
  out("search", o);
})();
