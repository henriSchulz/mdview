// Writing in the browser: what is typed is a draft at once and a commit after a while; what
// another device wrote meanwhile is joined in, and what both changed in the same place is asked
// about. The built app, a real Chromium, a GitHub of the test's own.
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const gh = fakeGitHub();
let app, base, browser, context, page, cookie;
const problems = [];
const MARKER = ".mdview/project.json";
const text = (p) => gh.repo.files.get(p)?.toString();
const put = (p, t) => gh.repo.files.set(p, Buffer.from(t));

before(async () => {
  put("Alpha.md", "# Alpha\n\nfirst paragraph\n\n- [ ] a task\n\nlast paragraph\n");
  put("Beta.md", "# Beta\n\ntext\n");
  put(MARKER, '{"id":"x","version":1}\n');
  const at = await gh.listen(), port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", APP_ORIGIN: base }, stdio: "pipe" });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/signin")).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const sent = await fetch(base + "/auth/login", { redirect: "manual" });
  const to = new URL(sent.headers.get("location")), pending = sent.headers.getSetCookie()[0].split(";")[0];
  gh.challenge = to.searchParams.get("code_challenge");
  const back = await fetch(`${base}/auth/callback?code=the-code&state=${to.searchParams.get("state")}`, { redirect: "manual", headers: { cookie: pending } });
  cookie = back.headers.getSetCookie().find((c) => c.startsWith("mdview=")).split(";")[0];
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "mdview", value: cookie.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript(() => { if (!localStorage.getItem("mdview:prefs")) localStorage.setItem("mdview:prefs", JSON.stringify({ historyQuiet: 1 })); }); // (a commit a second after the last change)
  page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("dialog", (d) => d.accept());
  if (process.env.DEBUG_WEB) { page.on("console", (m) => console.log("  [page]", m.text())); page.on("response", (r) => { if (/\/api\//.test(r.url())) console.log("  [api]", r.status(), r.url().replace(base, "")); }); }
});

after(async () => { await browser?.close(); app?.kill(); gh.close(); });

const untilNote = (name) => page.waitForFunction((n) => window.MdView && MdView.core.current && MdView.core.current.name === n && document.querySelector("#content").innerText.length > 0, name, { timeout: 15000 });
const post = (m) => page.evaluate((m) => MdHost.post(JSON.stringify(m)), m);
const until = async (f, what, ms = 8000) => { for (let t = 0; t < ms; t += 50) { if (await f()) return; await new Promise((r) => setTimeout(r, 50)); } assert.fail(`not within ${ms} ms: ${what}`); };
const raw = () => page.evaluate(() => MdView.core.current.raw);
const open = async (note) => {
  if (page.url().startsWith(base)) await page.evaluate(() => localStorage.setItem("mdview:mode", '"read"')); // (whatever mode the test before left: a note opens in the one used last)
  await page.goto(`${base}/r/octo/notes?n=${encodeURIComponent(note)}`);
  await untilNote(note);
};

test("typed in the active mode: a draft at once, a commit a little later, by this browser", async () => {
  await open("Alpha.md");
  assert.equal(await page.evaluate(() => MdView.core.current.readonly), null);
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm, null, { timeout: 15000 });
  await page.click("#active p");
  await page.keyboard.press("End");
  await page.keyboard.type(", typed here");
  await until(() => /first paragraph, typed here/.test(text("Alpha.md")), "the commit");
  const made = gh.commits.at(-1);
  assert.equal(made.headline, "Alpha.md");
  assert.match(made.body, /^Device: Chrome on \w+ \([0-9a-f-]{36}\)\nClient: web$/);
  assert.deepEqual([made.added, made.deleted], [["Alpha.md"], []]);
  assert.equal(text("Alpha.md"), "# Alpha\n\nfirst paragraph, typed here\n\n- [ ] a task\n\nlast paragraph\n"); // (nothing else of the note touched)
  assert.equal(gh.commits.length, 1);
});

test("what is written and no commit yet survives the tab", async () => {
  await page.evaluate(() => localStorage.setItem("mdview:prefs", JSON.stringify({ historyQuiet: 30 })));
  await open("Beta.md");
  const before = gh.commits.length;
  await post({ type: "save", text: "# Beta\n\ntext, not kept yet\n" });
  await page.waitForTimeout(400);
  await page.reload(); // (leaving the page tries to keep it; whether that got through or not, nothing is lost)
  await untilNote("Beta.md");
  assert.match(await raw(), /not kept yet/);
  await page.keyboard.press("Control+s"); // (and Ctrl+S keeps it now, whatever the quiet while)
  await until(() => /not kept yet/.test(text("Beta.md")), "the commit after Ctrl+S");
  assert.ok(gh.commits.length <= before + 1);
  await page.evaluate(() => localStorage.setItem("mdview:prefs", JSON.stringify({ historyQuiet: 1 })));
});

test("a task ticked, a note made, renamed and deleted", async () => {
  await open("Alpha.md");
  await page.click("#content input.task[data-line]");
  await until(() => /- \[x\] a task/.test(text("Alpha.md")), "the ticked task");
  await post({ type: "newnote", name: "Brand new" });
  await untilNote("Brand new.md");
  await until(() => text("Brand new.md") !== undefined, "the new note");
  assert.match(text("Brand new.md"), /^# Brand new\n/);
  await post({ type: "rename", path: "/octo/notes/Brand new.md", name: "Renamed" });
  await until(() => text("Renamed.md") !== undefined && text("Brand new.md") === undefined, "the renaming");
  assert.deepEqual([gh.commits.at(-1).added, gh.commits.at(-1).deleted], [["Renamed.md"], ["Brand new.md"]]);
  assert.equal(await page.evaluate(() => MdView.core.current.name), "Renamed.md"); // (the note on screen stays, under its new name)
  await post({ type: "trash", path: "/octo/notes/Renamed.md" });
  await until(() => text("Renamed.md") === undefined, "the deleting");
  assert.deepEqual(gh.commits.at(-1).deleted, ["Renamed.md"]);
  assert.ok(await page.evaluate(() => ![...document.querySelectorAll(".sb-row[data-real]")].some((r) => /Renamed/.test(r.textContent))));
});

test("another device wrote elsewhere in the note meanwhile: both are in the commit", async () => {
  await open("Alpha.md");
  const here = await raw();
  put("Alpha.md", here.replace("last paragraph", "last paragraph, from the other device"));
  await post({ type: "save", text: here.replace("# Alpha", "# Alpha, renamed here") });
  await until(() => /Alpha, renamed here/.test(text("Alpha.md") || ""), "the joined commit");
  assert.match(text("Alpha.md"), /^# Alpha, renamed here\n[\s\S]*last paragraph, from the other device\n$/);
  await page.waitForFunction(() => /from the other device/.test(MdView.core.current.raw), null, { timeout: 8000 }); // (and on the page)
});

test("both changed the same line: nothing is written until it is said how", async () => {
  await open("Beta.md");
  const here = await raw(), before = gh.commits.length;
  put("Beta.md", here.replace("# Beta", "# Beta, as they have it"));
  await post({ type: "save", text: here.replace("# Beta", "# Beta, as I have it") });
  const clock = () => page.evaluate(() => { const b = document.querySelector('[data-act="historymenu"]'); return [b.classList.contains("warn"), b.title || b.dataset.tip || ""]; });
  await until(async () => (await clock())[0], "the clock turning red");
  assert.match((await clock())[1], /conflicts to resolve/);
  assert.equal(gh.commits.length, before);
  assert.match(text("Beta.md"), /as they have it/); // (theirs is untouched)
  assert.match(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("mdview:octo/notes:drafts:")).map((k) => localStorage.getItem(k)).join("")), /as I have it/); // (and mine is kept, in this browser)
  await page.click('[data-act="historymenu"]');
  await page.click('#ctxmenu [data-cmd="history:conflicts"]');
  await page.waitForFunction(() => { const w = document.querySelector("#conflict"); return w && w.hasAttribute("data-open") && w.querySelector(".cf-place"); }, null, { timeout: 10000 });
  const sides = await page.evaluate(() => [...document.querySelectorAll("#conflict .cf-side .cf-lines")].map((s) => s.textContent.trim()));
  assert.deepEqual(sides, ["# Beta, as I have it", "# Beta, as they have it"]);
  assert.ok(await page.evaluate(() => document.querySelector("#conflict .cf-join").disabled));
  await page.screenshot({ path: join(web, ".next", "write-conflict.png") });
  await page.click('#conflict .cf-pick[data-pick="both"]');
  await page.click("#conflict .cf-join");
  await until(() => /as I have it\n# Beta, as they have it/.test(text("Beta.md") || ""), "the joined commit");
  await page.waitForFunction(() => !document.querySelector("#conflict").hasAttribute("data-open") && !document.querySelector('[data-act="historymenu"]').classList.contains("warn"), null, { timeout: 8000 });
  assert.equal(gh.commits.length, before + 1);
});

test("a note is in the mode it was in after a tab with no note in it", async () => {
  await open("Beta.md");
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable, null, { timeout: 15000 });
  const tabs = () => page.evaluate(() => document.querySelectorAll("#tabs .tab:not(.leaving)").length), had = await tabs();
  await page.keyboard.press("Control+t"); // (an empty tab: All Notes)
  await page.waitForFunction((n) => document.querySelectorAll("#tabs .tab:not(.leaving)").length === n + 1 && !MdView.core.current, had, { timeout: 8000 });
  await post({ type: "tab", op: "close" });
  await untilNote("Beta.md");
  await page.waitForFunction(() => document.body.dataset.view === "active" && MdActive.view.pm.editable, null, { timeout: 8000 }); // (not the reading view: what is typed next is typed into the note)
  assert.equal(await tabs(), had);
});

test("a callout that folds: folded at first in the active mode too, unfolded by its title's bar, and typed in", async () => {
  put("Fold.md", "# Fold\n\n> [!note]- Folded at first\n> inside it\n\nafter\n\n```systemverilog\nmodule top; endmodule\n```\n");
  await open("Fold.md");
  // read: the reader's own <details>; SystemVerilog is coloured
  assert.deepEqual(await page.evaluate(() => [document.querySelector("#content details.callout").open, !!document.querySelector("#content code.language-systemverilog .hljs-keyword")]), [false, true]);
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable && document.querySelector("#active details.callout"), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.querySelector("#active details.callout").open), false);
  await page.click("#active details.callout .callout-fold");
  await page.waitForFunction(() => document.querySelector("#active details.callout").open, null, { timeout: 8000 });
  await page.click("#active details.callout .callout-content p");
  await page.keyboard.press("End");
  await page.keyboard.type(", typed");
  await until(() => /> \[!note\]- Folded at first\n> inside it, typed\n/.test(text("Fold.md") || ""), "typed inside, written as a callout that folds");
  await page.click("#active details.callout .callout-fold"); // (folded again: how it is looked at, nothing written)
  await page.waitForFunction(() => !document.querySelector("#active details.callout").open, null, { timeout: 8000 });
  assert.match(text("Fold.md"), /\[!note\]- Folded at first/);
});

test("a commit whose answer never came, and the note written on: no conflict of the note with itself", async () => {
  put("Lost.md", "# Lost\n\na line\n");
  await open("Lost.md");
  const before = gh.commits.length;
  // the commit arrives at GitHub, its answer does not arrive here
  await page.route("**/api/r/octo/notes/commit", async (route) => { await route.fetch().catch(() => {}); await route.abort(); }, { times: 1 });
  await post({ type: "save", text: "# Lost\n\na line, written on\n" });
  await until(() => text("Lost.md") === "# Lost\n\na line, written on\n", "the commit, at GitHub");
  assert.equal(gh.commits.length, before + 1);
  await page.waitForTimeout(300);
  // written on in the same line — as one does — and kept: on top of the commit, not against it
  await post({ type: "save", text: "# Lost\n\na line, written on and on\n" });
  await post({ type: "history-now" });
  await until(() => text("Lost.md") === "# Lost\n\na line, written on and on\n", "the second commit, on the first");
  assert.equal(gh.commits.length, before + 2);
  assert.equal(await page.evaluate(() => document.querySelector('[data-act="historymenu"]').classList.contains("warn")), false);
  // the same over a reload: the draft knows the commit it was sent as
  await page.route("**/api/r/octo/notes/commit", async (route) => { await route.fetch().catch(() => {}); await route.abort(); }, { times: 1 });
  await post({ type: "save", text: "# Lost\n\na line, a third time\n" });
  await until(() => text("Lost.md") === "# Lost\n\na line, a third time\n", "the third commit, at GitHub");
  await page.evaluate(() => localStorage.setItem("mdview:prefs", JSON.stringify({ historyQuiet: 30 })));
  await page.reload();
  await untilNote("Lost.md");
  await post({ type: "save", text: "# Lost\n\na line, a third time and a fourth\n" });
  await post({ type: "history-now" });
  await until(() => text("Lost.md") === "# Lost\n\na line, a third time and a fourth\n", "the fourth, after the reload");
  assert.equal(await page.evaluate(() => document.querySelector('[data-act="historymenu"]').classList.contains("warn")), false);
  await page.evaluate(() => localStorage.setItem("mdview:prefs", JSON.stringify({ historyQuiet: 1 })));
});

test("two tabs on one repository: each keeps what was typed in it, and what a closed one left is taken over", async () => {
  await page.evaluate(() => localStorage.setItem("mdview:prefs", JSON.stringify({ historyQuiet: 30 })));
  put("Twice.md", "# Twice\n\nline one\n\nline two\n");
  await open("Twice.md");
  const before = gh.commits.length, drafts = (p) => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("mdview:octo/notes:drafts")).length);
  await post({ type: "save", text: "# Twice\n\nline one, typed in the first tab\n\nline two\n" }); // (a draft: no commit for half a minute)
  const second = await context.newPage(), said = [];
  second.on("console", (m) => { if (m.type() === "error") said.push(m.text()); });
  await second.goto(`${base}/r/octo/notes?n=Twice.md`);
  await second.waitForFunction(() => window.MdView && MdView.core.current && MdView.core.current.name === "Twice.md", null, { timeout: 15000 });
  // the second tab shows the note as the branch has it, and has no draft of its own
  assert.equal(await second.evaluate(() => MdView.core.current.raw), "# Twice\n\nline one\n\nline two\n");
  await second.evaluate(() => MdHost.post(JSON.stringify({ type: "history-now" })));
  await page.waitForTimeout(600);
  assert.equal(gh.commits.length, before); // (nothing of the first tab's was committed by the second)
  await second.evaluate(() => MdHost.post(JSON.stringify({ type: "save", text: "# Twice\n\nline one\n\nline two, typed in the second tab\n" })));
  await post({ type: "history-now" });
  await until(() => /typed in the first tab/.test(text("Twice.md") || ""), "the first tab's commit");
  await second.evaluate(() => MdHost.post(JSON.stringify({ type: "history-now" })));
  await until(() => /typed in the first tab\n\nline two, typed in the second tab/.test(text("Twice.md") || ""), "the second tab's, joined with it");
  assert.equal(await second.evaluate(() => document.querySelector('[data-act="historymenu"]').classList.contains("warn")), false);
  // a tab closed over a draft that could not be sent: the next tab opened takes it over
  await second.route("**/api/r/octo/notes/commit", (route) => route.abort());
  await second.evaluate(() => MdHost.post(JSON.stringify({ type: "save", text: "# Twice\n\nline one, typed in the first tab\n\nline two, typed in the second tab\n\nleft behind\n" })));
  await second.waitForTimeout(200);
  await second.close();
  assert.ok(!/left behind/.test(text("Twice.md")));
  assert.equal(await drafts(page), 1); // (still the closed tab's)
  const third = await context.newPage();
  await third.goto(`${base}/r/octo/notes?n=Twice.md`);
  await third.waitForFunction(() => window.MdView && MdView.core.current && /left behind/.test(MdView.core.current.raw || ""), null, { timeout: 15000 });
  await third.evaluate(() => MdHost.post(JSON.stringify({ type: "history-now" })));
  await until(() => /left behind/.test(text("Twice.md") || ""), "what the closed tab left, as a commit");
  await third.close();
  await page.evaluate(() => localStorage.setItem("mdview:prefs", JSON.stringify({ historyQuiet: 1 })));
});

test("a note's history: its versions, what each changed, one put back", async () => {
  await open("Alpha.md");
  await page.keyboard.press("Control+Alt+h");
  await page.waitForFunction(() => { const w = document.querySelector("#history"); return w && w.hasAttribute("data-open") && w.querySelectorAll(".hi-row").length >= 3 && w.querySelector(".hi-diff"); }, null, { timeout: 15000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll("#history .hi-row")].map((r) => r.querySelector(".hi-by").textContent));
  assert.ok(rows.length >= 3, String(rows.length));
  assert.match(rows[0], /^Chrome on \w+/); // (the newest was made here: by this browser, without its id)
  assert.ok(!/[0-9a-f-]{36}/.test(rows.join(" ")));
  assert.equal(rows.at(-1).split(" · ")[0], "Other"); // (the first was there before: by who made it)
  // the oldest version: what it was then; put back, it is the note again — as a new commit
  const first = "# Alpha\n\nfirst paragraph\n\n- [ ] a task\n\nlast paragraph\n", before = gh.commits.length;
  await page.evaluate(() => { const r = [...document.querySelectorAll("#history .hi-row")]; r[r.length - 1].click(); });
  await page.waitForFunction(() => /first paragraph/.test((document.querySelector("#history .hi-diff") || {}).textContent || ""), null, { timeout: 8000 });
  await page.click("#history .hi-tools .pf-link");
  await until(() => text("Alpha.md") === first, "the restored version as a commit");
  assert.equal(gh.commits.length, before + 1);
  await page.waitForFunction(() => !document.querySelector("#history").hasAttribute("data-open") && /^# Alpha\n\nfirst paragraph\n/.test(MdView.core.current.raw), null, { timeout: 8000 });
});

test("a note's history goes on behind the commit that gave it its name", async () => {
  const count = () => page.evaluate(() => document.querySelectorAll("#history .hi-row").length);
  await open("Alpha.md");
  await page.keyboard.press("Control+Alt+h");
  await page.waitForFunction(() => { const w = document.querySelector("#history"); return w && w.hasAttribute("data-open") && w.querySelectorAll(".hi-row").length >= 3; }, null, { timeout: 15000 });
  const had = await count();
  await page.keyboard.press("Escape");
  await post({ type: "rename", path: "/octo/notes/Alpha.md", name: "Alpha, later" });
  await until(() => text("Alpha, later.md") !== undefined && text("Alpha.md") === undefined, "the renaming");
  await untilNote("Alpha, later.md");
  await page.keyboard.press("Control+Alt+h");
  await page.waitForFunction((n) => { const w = document.querySelector("#history"); return w && w.hasAttribute("data-open") && w.querySelectorAll(".hi-row").length >= n; }, had + 1, { timeout: 15000 }); // (the renaming, and all there was before it)
  assert.equal(await count(), had + 1);
  // the oldest: read under the name the note had then
  await page.evaluate(() => { const r = [...document.querySelectorAll("#history .hi-row")]; r[r.length - 1].click(); });
  await page.waitForFunction(() => /first paragraph/.test((document.querySelector("#history .hi-diff") || {}).textContent || ""), null, { timeout: 8000 });
  await page.keyboard.press("Escape");
});

test("a picture pasted is kept beside the note, and in it", async () => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await open("Beta.md");
  await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = c.height = 4; c.getContext("2d").fillRect(0, 0, 4, 4);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": await new Promise((r) => c.toBlob(r, "image/png")) })]);
  });
  const before = gh.commits.length;
  await post({ type: "pasteimage", path: "/octo/notes/Beta.md", append: true });
  await until(() => /!\[\]\(pasted-\d{8}-\d{6}\.png\)\n$/.test(text("Beta.md") || ""), "the picture's markup in the note");
  const name = /\((pasted-[^)]+)\)/.exec(text("Beta.md"))[1];
  assert.deepEqual([...gh.repo.files.get(name).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]); // (a PNG, byte for byte)
  assert.deepEqual([gh.commits.length, gh.commits.at(-1).added.sort()], [before + 1, ["Beta.md", name].sort()]); // (one commit: the note and the picture)
  await page.waitForFunction((n) => { const i = document.querySelector(`#content img[src$="${n}"]`); return i && i.complete && i.naturalWidth === 4; }, name, { timeout: 10000 }); // (and it shows)
});

test("a picture dropped on the note is kept under its own name, and put in where it fell", async () => {
  await open("Beta.md");
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable, null, { timeout: 15000 });
  const before = gh.commits.length;
  const fall = (files) => page.evaluate(async (files) => {
    const dt = new DataTransfer();
    for (const [name, type] of files) {
      const c = document.createElement("canvas"); c.width = c.height = 3; c.getContext("2d").fillRect(0, 0, 3, 3);
      dt.items.add(new File([type ? await new Promise((r) => c.toBlob(r, type)) : "words"], name, { type: type || "text/plain" }));
    }
    const dom = MdActive.view.pm.dom, r = dom.querySelector("p").getBoundingClientRect();
    dom.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: r.left + 4, clientY: r.top + 4, bubbles: true, cancelable: true }));
  }, files);
  await fall([["words.txt", ""]]); // (no picture: said, and nothing kept)
  await page.waitForFunction(() => /Only pictures/.test(document.body.innerText), null, { timeout: 8000 });
  await fall([["A drawing.png", "image/png"], ["words.txt", ""]]);
  await until(() => gh.repo.files.has("A drawing.png"), "the picture in the repository");
  assert.deepEqual([...gh.repo.files.get("A drawing.png").subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(gh.repo.files.has("words.txt"), false);
  await until(() => /!\[\]\(A%20drawing\.png\)/.test(text("Beta.md") || ""), "its markup in the note, as a commit");
  assert.ok(gh.commits.length >= before + 1);
  // the same name once more: beside the first, not over it
  await fall([["A drawing.png", "image/png"]]);
  await until(() => gh.repo.files.has("A drawing-2.png"), "the second picture");
  await until(() => /A%20drawing-2\.png/.test(text("Beta.md") || ""), "the second one's markup");
});

test("the clipboard, where the page asks the host for it: pasted plain, pasted as it is, a picture copied", async () => {
  await open("Beta.md");
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable, null, { timeout: 15000 });
  await page.click("#active h1");
  await page.keyboard.press("End");
  await page.evaluate(() => navigator.clipboard.writeText(" plainly"));
  await post({ type: "pastetext" });
  await until(() => /^# Beta[^\n]* plainly\n/.test(text("Beta.md") || ""), "the plain text, pasted and kept");
  await page.evaluate(() => navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([" bold"], { type: "text/plain" }), "text/html": new Blob([" <b>bold</b>"], { type: "text/html" }) })]));
  await post({ type: "pasteclip" });
  await until(() => /^# Beta[^\n]* plainly\*\*bold\*\*\n/.test(text("Beta.md") || ""), "what was copied elsewhere, as Markdown");
  await post({ type: "copyimage", src: `${base}/file/octo/notes/A%20drawing.png` });
  await until(() => page.evaluate(async () => (await navigator.clipboard.read()).some((i) => i.types.includes("image/png"))), "the picture on the clipboard");
});

test("leaving for the list of repositories: what is typed goes along first", async () => {
  await open("Beta.md");
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable, null, { timeout: 15000 });
  await page.click("#active h1");
  await page.keyboard.press("End");
  await page.keyboard.type(", and gone");
  await post({ type: "close" });
  await page.waitForURL(base + "/", { timeout: 8000 });
  await until(() => /, and gone/.test(text("Beta.md") || ""), "what was typed, as a commit");
});

test("a file that is no note has another name: its bytes under the new, none under the old", async () => {
  const pdf = Buffer.from("%PDF-1.4\n" + "\u00ff\u0000binary".repeat(40), "latin1");
  gh.repo.files.set("docs/Paper.pdf", pdf);
  await open("Beta.md");
  await page.waitForFunction(() => [...document.querySelectorAll(".sb-row")].some((r) => /docs/.test(r.textContent)), null, { timeout: 8000 });
  const before = gh.commits.length;
  await post({ type: "rename", path: "/octo/notes/docs/Paper.pdf", name: "Thesis.pdf" });
  await until(() => gh.repo.files.has("docs/Thesis.pdf") && !gh.repo.files.has("docs/Paper.pdf"), "the renaming");
  assert.ok(gh.repo.files.get("docs/Thesis.pdf").equals(pdf)); // (byte for byte)
  assert.deepEqual([gh.commits.length, gh.commits.at(-1).added, gh.commits.at(-1).deleted], [before + 1, ["docs/Thesis.pdf"], ["docs/Paper.pdf"]]);
  await post({ type: "rename", path: "/octo/notes/docs/Thesis.pdf", name: "Beta.md" }); // (the kind stays: Beta.md.pdf)
  await until(() => gh.repo.files.has("docs/Beta.md.pdf"), "a name with the kind kept");
});

test("the settings show what there is here, not the desktop's own", async () => {
  await open("Beta.md");
  await page.keyboard.press("Control+,");
  await page.waitForFunction(() => { const s = document.querySelector("#settings"); return s && s.hasAttribute("data-open"); }, null, { timeout: 15000 });
  await page.click('#settings .st-nav[data-page="history"]');
  await page.waitForFunction(() => /^On/.test((document.querySelector('.pf-row[data-key="historyState"] .pf-value') || {}).textContent || ""), null, { timeout: 8000 });
  const seen = await page.evaluate(() => {
    const vis = (e) => !!e && e.offsetParent !== null;
    const row = (k) => document.querySelector(`.st-page[data-page="history"] .pf-row[data-key="${k}"]`);
    return {
      nav: [...document.querySelectorAll("#settings .st-nav")].filter(vis).map((b) => b.dataset.page),
      rows: ["historyState", "historyName", "historyBranch", "historyLink", "historyQuiet", "deviceName", "deviceId", "githubAccount", "githubGet"].filter((k) => vis(row(k))),
      link: row("historyLink").querySelector(".pf-value").textContent,
      buttons: [...document.querySelectorAll('.st-page[data-page="history"] .pf-link')].filter(vis).map((b) => b.textContent),
      device: row("deviceName").querySelector("input").placeholder,
    };
  });
  assert.ok(!seen.nav.includes("ai") && seen.nav.includes("history") && seen.nav.includes("editing"), String(seen.nav)); // (no model here)
  assert.deepEqual(seen.rows, ["historyState", "historyName", "historyBranch", "historyLink", "historyQuiet", "deviceName", "deviceId"]); // (signing in is before any page)
  assert.match(seen.link, /^octo\/notes · /);
  assert.deepEqual(seen.buttons, []); // (nothing to switch off or unlink: the repository is the project)
  assert.match(seen.device, /^Chrome on /);
  await page.keyboard.press("Escape");
});

test("a repository that is no project is not written to until that is said", async () => {
  gh.repo.files.delete(MARKER);
  await open("Beta.md");
  assert.match(await page.evaluate(() => MdView.core.current.readonly), /history on first/);
  const before = gh.commits.length, was = text("Beta.md");
  await post({ type: "save", text: "overwritten" });
  await post({ type: "newnote", name: "Nope" });
  await page.waitForTimeout(1600);
  assert.deepEqual([gh.commits.length, text("Beta.md"), text("Nope.md")], [before, was, undefined]);
  // the clock offers to use the repository; said yes (the browser's question), the marker is a commit
  await page.click('[data-act="historymenu"]');
  await page.click('#ctxmenu .menu-item:not([hidden])[data-cmd="history:on"]');
  await until(() => text(MARKER) !== undefined, "the marker");
  assert.equal(gh.commits.at(-1).headline, "project.json");
  assert.equal(JSON.parse(text(MARKER)).version, 1);
  await page.waitForFunction(() => MdView.core.current.readonly == null, null, { timeout: 8000 });
});

test("only the app's own pages can have a commit made, and only inside the repository", async () => {
  const send = (body, headers = {}) => fetch(`${base}/api/r/octo/notes/commit`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", cookie, origin: base, ...headers }, body: JSON.stringify(body) }).then((r) => r.status);
  const good = { branch: "main", expect: gh.head(), headline: "x", body: "", additions: [{ path: "x.md", text: "x" }], deletions: [] };
  const before = gh.commits.length;
  assert.equal(await send(good, { origin: "https://elsewhere.example" }), 403);
  assert.equal(await send(good, { origin: "" }), 403);
  assert.equal(await send(good, { cookie: "" }), 307); // (not signed in: to the sign-in page)
  for (const path of ["../x.md", "/etc/x", ".git/config", "a//b.md", "a/./b.md", ""]) assert.equal(await send({ ...good, additions: [{ path, text: "x" }] }), 400, path);
  assert.equal(await send({ ...good, deletions: ["a/../../x"] }), 400);
  assert.equal(await send({ ...good, expect: "0".repeat(40) }), 409); // (the branch stands elsewhere)
  assert.equal(gh.commits.length, before);
  assert.equal(await send(good), 200);
  assert.equal(text("x.md"), "x");
});

test("nothing was refused or thrown along the way", () => {
  // (but the answers that were cut off on purpose above: a commit that could not be sent is said, and tried again)
  assert.deepEqual(problems.filter((p) => !/Failed to load resource|mdview host: commit TypeError: Failed to fetch/i.test(p)), []);
});
