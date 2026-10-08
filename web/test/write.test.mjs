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
  await context.addInitScript(() => { if (!localStorage.getItem("mdview:set")) localStorage.setItem("mdview:set", JSON.stringify({ historyQuiet: 1, images: "beside" })); if (localStorage.getItem("mdview:attach-grace") == null) localStorage.setItem("mdview:attach-grace", "0"); }); // (a commit a second after the last change)
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
  await page.evaluate(() => localStorage.setItem("mdview:set", JSON.stringify({ historyQuiet: 30, images: "beside" })));
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
  await page.evaluate(() => localStorage.setItem("mdview:set", JSON.stringify({ historyQuiet: 1, images: "beside" })));
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

test("blocks selected as wholes: Tab stands them under the list above, / and a right click have their menus", async () => {
  put("Blocks.md", "- one\n\nbelow\n\nthird\n");
  await open("Blocks.md");
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable, null, { timeout: 15000 });
  const md = () => page.evaluate(() => MdActive.view.serialize());
  const menu = () => page.evaluate(() => (document.querySelector("#actmenu").hasAttribute("data-open") ? [...document.querySelectorAll("#actmenu .menu-item .menu-label")].map((e) => e.textContent) : null));
  const caretInBelow = () => page.evaluate(() => { const v = MdActive.view.pm; let at = -1; v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text === "below") at = pos + 2; }); v.focus(); v.dispatch(v.state.tr.setSelection(PM.state.TextSelection.create(v.state.doc, at))); });
  await caretInBelow();
  await page.keyboard.press("Escape"); // (the paragraph, as a block)
  await page.waitForFunction(() => !!MdActive.blocks.selection(MdActive.view.pm.state), null, { timeout: 8000 });
  await page.keyboard.press("Tab");
  assert.equal(await md(), "- one\n\n  below\n\nthird\n");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await md(), "- one\n\nbelow\n\nthird\n");
  // "/": the menu for the block, not a slash in the text
  await caretInBelow();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !!MdActive.blocks.selection(MdActive.view.pm.state), null, { timeout: 8000 });
  await page.keyboard.type("/");
  await page.waitForFunction(() => document.querySelector("#actmenu").hasAttribute("data-open"), null, { timeout: 8000 });
  assert.deepEqual(await menu(), ["Text Style", "List", "Format", "Decorations", "Color", "Callout", "Columns", "Code Block", "Formula", "Table", "Divider", "Picture", "File", "Graphic by Claude…", "Whiteboard", "Footnote", "Page", "Actions"]); // (all the "/" menu has)
  assert.ok(await page.evaluate(() => !!document.querySelector("#actmenu .menu-search"))); // (… and it is searched by typing)
  assert.equal(await md(), "- one\n\nbelow\n\nthird\n");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#actmenu").hasAttribute("data-open"), null, { timeout: 8000 });
  // a right click on it: the clipboard, once more, away
  if (!(await page.evaluate(() => !!MdActive.blocks.selection(MdActive.view.pm.state)))) { await caretInBelow(); await page.keyboard.press("Escape"); }
  await page.click(".pm > p", { button: "right" });
  await page.waitForFunction(() => document.querySelector("#actmenu").hasAttribute("data-open"), null, { timeout: 8000 });
  const shown = await menu();
  assert.deepEqual([shown.slice(0, 4), shown.at(-1)], [["Cut", "Copy", "Paste", "Duplicate"], "Delete"]);
  await page.evaluate(() => [...document.querySelectorAll("#actmenu .menu-item")].find((e) => e.textContent.startsWith("Duplicate")).click());
  await page.waitForFunction(() => /below\n\nbelow/.test(MdActive.view.serialize()), null, { timeout: 8000 });
});

test("a folder renamed and deleted, several files deleted at once, and a file of text shown as code", async () => {
  put("Keep.md", "# Keep\n\n![[code/main.c#L2-L3]]\n");
  put("code/main.c", "int a;\nint b;\nint c;\nint d;\n");
  put("pile/One.md", "# One\n");
  put("pile/Two.md", "# Two\n");
  put("Gone1.md", "# Gone 1\n");
  put("Gone2.md", "# Gone 2\n");
  await open("Keep.md");
  // the file's lines stand in the note as code, named
  await page.waitForFunction(() => document.querySelector("#content .code-file code"), null, { timeout: 8000 });
  assert.deepEqual(await page.evaluate(() => [document.querySelector("#content .code-file code").textContent, document.querySelector("#content .code-from a").textContent]), ["int b;\nint c;\n", "main.c:2–3"]);
  // a folder under another name: its files with it
  await post({ type: "rename", path: "/octo/notes/pile", name: "stack" });
  await until(() => text("stack/One.md") !== undefined && text("stack/Two.md") !== undefined && text("pile/One.md") === undefined, "the folder, renamed");
  // … and deleted: every file in it
  await post({ type: "trash", path: "/octo/notes/stack" });
  await until(() => text("stack/One.md") === undefined && text("stack/Two.md") === undefined, "the folder, deleted");
  // several at once
  await post({ type: "trash", paths: ["/octo/notes/Gone1.md", "/octo/notes/Gone2.md"] });
  await until(() => text("Gone1.md") === undefined && text("Gone2.md") === undefined, "both notes, deleted");
  assert.equal(text("Keep.md"), "# Keep\n\n![[code/main.c#L2-L3]]\n");
  assert.equal(await page.evaluate(() => MdView.core.current.name), "Keep.md");
});

test("a note dragged into a folder, and a folder into another: the same files under other paths", async () => {
  put("Loose.md", "# Loose\n\nto be moved\n");
  put("box/Inside.md", "# Inside\n");
  put("shelf/Other.md", "# Other\n");
  await open("Loose.md");
  await page.waitForFunction(() => document.querySelector('.sb-item.is-dir[data-key="/octo/notes/box"]') && document.querySelector('.sb-row[data-real="/octo/notes/Loose.md"]'), null, { timeout: 8000 });
  const before = gh.commits.length;
  // with the pointer: its row onto the folder's
  await page.dragAndDrop('.sb-row[data-real="/octo/notes/Loose.md"]', '.sb-item.is-dir[data-key="/octo/notes/box"] > .sb-in > .sb-row');
  await until(() => text("box/Loose.md") !== undefined && text("Loose.md") === undefined, "the note, in the folder");
  assert.equal(text("box/Loose.md"), "# Loose\n\nto be moved\n");
  assert.deepEqual([gh.commits.at(-1).added, gh.commits.at(-1).deleted], [["box/Loose.md"], ["Loose.md"]]);
  assert.deepEqual(await page.evaluate(() => [MdView.core.current.path, new URL(location.href).searchParams.get("n")]), ["/octo/notes/box/Loose.md", "box/Loose.md"]); // (the note on screen stays, under its new path)
  // a folder into another, with what is in it; and not into itself
  await post({ type: "move", path: "/octo/notes/box", dir: "/octo/notes/box" });
  await post({ type: "move", path: "/octo/notes/box", dir: "/octo/notes/shelf" });
  await until(() => text("shelf/box/Loose.md") !== undefined && text("shelf/box/Inside.md") !== undefined && text("box/Inside.md") === undefined, "the folder, in the other");
  assert.equal(await page.evaluate(() => MdView.core.current.path), "/octo/notes/shelf/box/Loose.md");
  // back to the top; where a file of that name is already, nothing moves
  put("Other.md", "# another Other\n");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(() => document.querySelector('.sb-row[data-real="/octo/notes/Other.md"]'), null, { timeout: 8000 });
  await post({ type: "move", path: "/octo/notes/shelf/Other.md", dir: "/octo/notes" });
  await page.waitForFunction(() => /already exists there/.test(document.body.innerText), null, { timeout: 8000 });
  assert.equal(text("Other.md"), "# another Other\n");
  assert.ok(gh.commits.length >= before + 2);
});

test("Tab stands any block further in: where no list is above, as a quote that only indents", async () => {
  put("Indent.md", "# Indent\n\nfirst\n\nsecond\n");
  await open("Indent.md");
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable, null, { timeout: 15000 });
  await page.evaluate(() => { const v = MdActive.view.pm; let at = -1; v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text === "second") at = pos + 3; }); v.focus(); v.dispatch(v.state.tr.setSelection(PM.state.TextSelection.create(v.state.doc, at))); });
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => MdActive.view.serialize()), "# Indent\n\nfirst\n\n> [!indent]\n> second\n");
  // it looks like nothing but standing further in: no bar, no tint — in the active mode and when read
  const look = (root) => page.evaluate((root) => { const q = document.querySelector(root + " blockquote.deco-indent"), p = q.querySelector("p"), first = document.querySelector(root + " p"), s = getComputedStyle(q); return [Math.round(p.getBoundingClientRect().left - first.getBoundingClientRect().left) > 16, s.borderLeftWidth, s.backgroundColor]; }, root);
  assert.deepEqual(await look(".pm"), [true, "0px", "rgba(0, 0, 0, 0)"]);
  await until(() => /> \[!indent\]\n> second/.test(text("Indent.md") || ""), "written");
  await page.evaluate(() => MdView.setMode("read"));
  await page.waitForFunction(() => (document.body.dataset.view || "read") === "read" && document.querySelector("#content blockquote.deco-indent"), null, { timeout: 8000 });
  assert.deepEqual(await look("#content"), [true, "0px", "rgba(0, 0, 0, 0)"]);
  assert.ok(!/indent/.test(await page.evaluate(() => document.querySelector("#content").innerText))); // (the word that says so is not shown)
});

test("the last tab closed: not out of the repository, but an empty tab with All Notes", async () => {
  await open("Beta.md");
  // (whatever tabs the tests before left: all but one closed first)
  for (let i = 0; i < 12 && (await page.evaluate(() => document.querySelectorAll("#tabs .tab:not(.leaving)").length)) > 1; i++) { await post({ type: "tab", op: "close" }); await page.waitForTimeout(350); }
  await page.waitForFunction(() => document.querySelectorAll("#tabs .tab:not(.leaving)").length === 1, null, { timeout: 8000 });
  if (!(await page.evaluate(() => !!MdView.core.current))) { await post({ type: "note", path: "/octo/notes/Beta.md" }); await untilNote("Beta.md"); }
  await post({ type: "tab", op: "close" });
  await page.waitForFunction(() => !MdView.core.current && document.querySelectorAll("#tabs .tab:not(.leaving)").length === 1, null, { timeout: 8000 });
  assert.ok(page.url().startsWith(`${base}/r/octo/notes`)); // (still in the repository)
  await post({ type: "tab", op: "reopen" }); // (and the note comes back with Reopen Closed Tab)
  await untilNote("Beta.md");
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
  await page.evaluate(() => localStorage.setItem("mdview:set", JSON.stringify({ historyQuiet: 30, images: "beside" })));
  await page.reload();
  await untilNote("Lost.md");
  await post({ type: "save", text: "# Lost\n\na line, a third time and a fourth\n" });
  await post({ type: "history-now" });
  await until(() => text("Lost.md") === "# Lost\n\na line, a third time and a fourth\n", "the fourth, after the reload");
  assert.equal(await page.evaluate(() => document.querySelector('[data-act="historymenu"]').classList.contains("warn")), false);
  await page.evaluate(() => localStorage.setItem("mdview:set", JSON.stringify({ historyQuiet: 1, images: "beside" })));
});

test("two tabs on one repository: each keeps what was typed in it, and what a closed one left is taken over", async () => {
  await page.evaluate(() => localStorage.setItem("mdview:set", JSON.stringify({ historyQuiet: 30, images: "beside" })));
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
  await page.evaluate(() => localStorage.setItem("mdview:set", JSON.stringify({ historyQuiet: 1, images: "beside" })));
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
  await fall([["A drawing.png", "image/png"], ["words.txt", ""]]);
  await until(() => gh.repo.files.has("A drawing.png"), "the picture in the repository");
  assert.deepEqual([...gh.repo.files.get("A drawing.png").subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  // any other file is kept too, and stands in the note as a block that names it
  assert.equal(text("words.txt"), "words");
  await until(() => /\[words\.txt\]\(words\.txt\)/.test(text("Beta.md") || ""), "the file's block in the note");
  assert.equal(await page.evaluate(() => !!document.querySelector(".pm p.file-block > a")), true);
  await until(() => /!\[\]\(A%20drawing\.png\)/.test(text("Beta.md") || ""), "its markup in the note, as a commit");
  assert.ok(gh.commits.length >= before + 1);
  // the same name once more: beside the first, not over it
  await fall([["A drawing.png", "image/png"]]);
  await until(() => gh.repo.files.has("A drawing-2.png"), "the second picture");
  await until(() => /A%20drawing-2\.png/.test(text("Beta.md") || ""), "the second one's markup");
});

test("a picture pasted comes from the paste itself: no asking the browser for the clipboard", async () => {
  put("Pasted.md", "# Pasted\n\ntext\n");
  await open("Pasted.md");
  await context.clearPermissions(); // (whatever was granted before: none of it is needed)
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable, null, { timeout: 15000 });
  const paste = (into, files) => page.evaluate(async ([into, files]) => {
    const dt = new DataTransfer();
    for (const [name, type] of files) {
      const c = document.createElement("canvas"); c.width = c.height = 3; c.getContext("2d").fillRect(0, 0, 3, 3);
      dt.items.add(new File([await new Promise((r) => c.toBlob(r, type))], name, { type }));
    }
    (into ? document.querySelector(into) : document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [into, files]);
  await page.click(".pm p");
  // said at once, and until it is in the note: the window is busy, and takes no second paste meanwhile
  await page.route("**/api/r/octo/notes/commit", async (route) => { await new Promise((r) => setTimeout(r, 900)); await route.continue(); }, { times: 1 });
  const commitsBefore = gh.commits.length;
  await paste(".pm", [["image.png", "image/png"]]);
  await page.waitForFunction(() => document.querySelector("#busy").hasAttribute("data-open") && /Adding the picture/.test(document.querySelector("#busy").textContent), null, { timeout: 3000 });
  await paste(".pm", [["image.png", "image/png"]]); // (pasted again, impatiently: not taken)
  await page.keyboard.type("x");                     // (nor is anything typed)
  await page.waitForFunction(() => !document.querySelector("#busy").hasAttribute("data-open"), null, { timeout: 10000 });
  assert.equal(gh.commits.length, commitsBefore + 1);
  assert.equal([...gh.repo.files.keys()].filter((k) => /^pasted-.*\.png$/.test(k) && gh.repo.files.get(k).length < 200).length >= 1, true);
  await until(() => /!\[\]\(pasted-\d{8}-\d{6}\.png\)/.test(text("Pasted.md") || ""), "the picture's markup in the note");
  const name = /\((pasted-[^)]+)\)/.exec(text("Pasted.md"))[1];
  assert.deepEqual([...gh.repo.files.get(name).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  await page.waitForFunction((n) => { const i = document.querySelector(`.pm img[src$="${n}"]`); return i && i.complete && i.naturalWidth === 3; }, name, { timeout: 10000 });
  // in the reading view: at the note's end
  await page.evaluate(() => MdView.setMode("read"));
  await page.waitForFunction(() => (document.body.dataset.view || "read") === "read", null, { timeout: 8000 });
  await page.waitForTimeout(1100); // (another second: another name)
  await paste(null, [["image.png", "image/jpeg"]]);
  await until(() => /\.jpg\)\n$/.test(text("Pasted.md") || ""), "the second picture, at the end");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
});

test("a picture put in while writing goes again with what shows it, and comes back when that is undone; one that was there stays", async () => {
  put("Gone.md", "# Gone\n\n![](there.png)\n\ntext\n");
  put("there.png", "not put in by the app");
  await open("Gone.md");
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable, null, { timeout: 15000 });
  await page.evaluate(() => { const v = MdActive.view.pm; v.focus(); v.dispatch(v.state.tr.setSelection(PM.state.Selection.atEnd(v.state.doc))); });
  await page.evaluate(async () => {
    const dt = new DataTransfer(), c = document.createElement("canvas");
    c.width = c.height = 3; c.getContext("2d").fillRect(0, 0, 3, 3);
    dt.items.add(new File([await new Promise((r) => c.toBlob(r, "image/png"))], "image.png", { type: "image/png" }));
    document.querySelector(".pm").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await until(() => /\(pasted-\d{8}-\d{6}\.png\)/.test(text("Gone.md") || ""), "the picture's markup in the note");
  const name = /\((pasted-[^)]+)\)/.exec(text("Gone.md"))[1];
  assert.ok(gh.repo.files.has(name));
  assert.equal(JSON.parse(text(".mdview/attachments.json"))[name], "Gone.md"); // (written down as the note's own)
  // taken out of the note: it goes from the repository too (a picture that was there before is not in the list, and never goes)
  await page.evaluate((what) => {
    const v = MdActive.view.pm, tr = v.state.tr, at = [];
    v.state.doc.descendants((n, p) => { if (n.type.name === "image" && n.attrs.src.includes(what)) at.push([p, p + n.nodeSize]); });
    for (const [a, b] of at.reverse()) tr.delete(a, b);
    v.dispatch(tr);
  }, name);
  await until(() => !(text("Gone.md") || name).includes(name) && !gh.repo.files.has(name), "the pasted picture is gone from the repository");
  assert.ok(gh.repo.files.has("there.png"));
  assert.equal(JSON.parse(text(".mdview/attachments.json"))[name], undefined);
  // undone: back in the note, in the repository, and on the page
  await page.evaluate(() => PM.history.undo(MdActive.view.pm.state, MdActive.view.pm.dispatch));
  await until(() => (text("Gone.md") || "").includes(name) && gh.repo.files.has(name), "the picture is back in the repository");
  assert.deepEqual([...gh.repo.files.get(name).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(JSON.parse(text(".mdview/attachments.json"))[name], "Gone.md");
  await page.waitForFunction((n) => { const i = [...document.querySelectorAll(".pm img")].find((i) => i.src.includes(n)); return i && i.complete && i.naturalWidth === 3; }, name, { timeout: 10000 });
});

test("a picture taken out of a note stays for a while: cut, saved, and undone, it was never gone", async () => {
  put("Stays.md", "# Stays\n\ntext\n");
  await page.evaluate(() => localStorage.setItem("mdview:attach-grace", "3600")); // (as it is for everyone: an hour)
  await open("Stays.md");
  await page.reload();
  await page.waitForFunction(() => window.MdView && MdView.core.current && MdView.core.current.name === "Stays.md", null, { timeout: 15000 });
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable, null, { timeout: 15000 });
  await page.evaluate(() => { const v = MdActive.view.pm; v.focus(); v.dispatch(v.state.tr.setSelection(PM.state.Selection.atEnd(v.state.doc))); });
  await page.evaluate(async () => {
    const dt = new DataTransfer(), c = document.createElement("canvas");
    c.width = c.height = 3; c.getContext("2d").fillRect(0, 0, 3, 3);
    dt.items.add(new File([await new Promise((r) => c.toBlob(r, "image/png"))], "image.png", { type: "image/png" }));
    document.querySelector(".pm").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await until(() => /\(pasted-\d{8}-\d{6}\.png\)/.test(text("Stays.md") || ""), "the picture's markup in the note");
  const name = /\((pasted-[^)]+)\)/.exec(text("Stays.md"))[1];
  // taken out, and the note committed without it: the file is still in the repository, and still the note's
  await page.evaluate((what) => {
    const v = MdActive.view.pm, tr = v.state.tr, at = [];
    v.state.doc.descendants((n, p) => { if (n.type.name === "image" && n.attrs.src.includes(what)) at.push([p, p + n.nodeSize]); });
    for (const [a, b] of at.reverse()) tr.delete(a, b);
    v.dispatch(tr);
  }, name);
  await until(() => !(text("Stays.md") || name).includes(name), "the note, committed without the picture");
  await page.waitForTimeout(1500);
  assert.ok(gh.repo.files.has(name), "the file stays");
  assert.equal(JSON.parse(text(".mdview/attachments.json"))[name], "Stays.md");
  // undone: the picture is drawn at once — it never went
  await page.evaluate(() => PM.history.undo(MdActive.view.pm.state, MdActive.view.pm.dispatch));
  await page.waitForFunction((n) => { const i = [...document.querySelectorAll(".pm img")].find((i) => i.src.includes(n)); return i && i.complete && i.naturalWidth === 3; }, name, { timeout: 4000 });
  await until(() => (text("Stays.md") || "").includes(name), "the picture's markup is back");
  await page.evaluate(() => localStorage.setItem("mdview:attach-grace", "0"));
  await page.reload();
});

test("where nothing else is set, what is pasted goes into a folder of its own beside the note: assets", async () => {
  put("Kept.md", "# Kept\n\ntext\n");
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem("mdview:set") || "{}"); delete p.images; localStorage.setItem("mdview:set", JSON.stringify(p)); }); // (as a browser that never chose)
  await open("Kept.md");
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable, null, { timeout: 15000 });
  await page.evaluate(() => { const v = MdActive.view.pm; v.focus(); v.dispatch(v.state.tr.setSelection(PM.state.Selection.atEnd(v.state.doc))); });
  await page.evaluate(async () => {
    const dt = new DataTransfer(), c = document.createElement("canvas");
    c.width = c.height = 3; c.getContext("2d").fillRect(0, 0, 3, 3);
    dt.items.add(new File([await new Promise((r) => c.toBlob(r, "image/png"))], "image.png", { type: "image/png" }));
    document.querySelector(".pm").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await until(() => /!\[\]\(assets\/pasted-\d{8}-\d{6}\.png\)/.test(text("Kept.md") || ""), "the picture's markup names the folder");
  const name = /\((assets\/pasted-[^)]+)\)/.exec(text("Kept.md"))[1];
  assert.ok(gh.repo.files.has(name));
  await page.waitForFunction((n) => { const i = [...document.querySelectorAll(".pm img")].find((i) => i.src.includes(n.split("/").pop())); return i && i.complete && i.naturalWidth === 3; }, name, { timeout: 10000 });
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem("mdview:set") || "{}"); p.images = "beside"; localStorage.setItem("mdview:set", JSON.stringify(p)); });
});

test("a file block: a click hands the file out, and a file that can be shown is embedded on request", async () => {
  put("Files.md", "# Files\n\n[paper.pdf](paper.pdf)\n\n[data.zip](data.zip)\n\nA [link in a line](data.zip) is a link.\n");
  gh.repo.files.set("paper.pdf", Buffer.from("%PDF-1.4 not really"));
  gh.repo.files.set("data.zip", Buffer.from("PK\u0003\u0004zip"));
  await open("Files.md");
  assert.equal(await page.evaluate(() => document.querySelectorAll("#content p.file-block > a").length), 2); // (the link in a line is none)
  // a click: the file itself, as the app serves a repository's files (what it does not know: as a download)
  const popup = page.waitForEvent("popup");
  await page.click('#content p.file-block > a[href="data.zip"]');
  const opened = await popup;
  await opened.close(); // (a download leaves the new tab empty: what it would have got is asked for below)
  const served = await fetch(`${base}/file/octo/notes/data.zip`, { headers: { cookie } });
  assert.deepEqual([served.status, served.headers.get("content-disposition")], [200, "attachment"]);
  // in the active mode: the same card; its menu embeds what can be shown in the note
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable && document.querySelectorAll(".pm p.file-block").length === 2, null, { timeout: 15000 });
  const menuAt = async (sel) => { await page.click(sel, { button: "right" }); await page.waitForFunction(() => document.querySelector("#actmenu").hasAttribute("data-open"), null, { timeout: 8000 }); return page.evaluate(() => [...document.querySelectorAll("#actmenu .menu-item .menu-label")].map((e) => e.textContent)); };
  assert.ok(!(await menuAt('.pm p.file-block > a[href="data.zip"]')).includes("Embed in the Note")); // (a zip has nothing to show)
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#actmenu").hasAttribute("data-open"), null, { timeout: 8000 });
  assert.ok((await menuAt('.pm p.file-block > a[href="paper.pdf"]')).includes("Embed in the Note"));
  await page.evaluate(() => [...document.querySelectorAll("#actmenu .menu-item")].find((e) => e.textContent.startsWith("Embed in the Note")).click());
  await page.waitForFunction(() => /!\[\[paper\.pdf\]\]/.test(MdActive.view.serialize()), null, { timeout: 8000 });
  assert.match(await page.evaluate(() => MdActive.view.serialize()), /# Files\n\n!\[\[paper\.pdf\]\]\n\n\[data\.zip\]\(data\.zip\)\n/);
  // three sizes, chosen in the block's menu and written where a link has its title
  const size = async (label) => {
    await page.click('.pm p.file-block > a[href="data.zip"]', { button: "right" });
    await page.waitForFunction(() => document.querySelector("#actmenu").hasAttribute("data-open"), null, { timeout: 8000 });
    await page.hover('#actmenu .menu-item:has-text("Size")'); // (the pointer resting on it opens what it holds)
    await page.waitForFunction(() => document.querySelector("#actsub").hasAttribute("data-open"), null, { timeout: 8000 });
    await page.click(`#actsub .menu-item:has-text("${label}")`);
    await page.waitForFunction(() => !document.querySelector("#actmenu").hasAttribute("data-open"), null, { timeout: 8000 });
  };
  const box = () => page.evaluate(() => { const p = document.querySelector(".pm p.file-block:has(a[href='data.zip'])"), a = p.querySelector("a"); return [p.className.replace(/\s+/g, " ").trim().split(" ").filter((c) => c.startsWith("file-")).sort().join(" "), p.dataset.ext, Math.round(a.getBoundingClientRect().height), a.hasAttribute("title")]; });
  const medium = await box();
  assert.deepEqual([medium[0], medium[1], medium[3]], ["file-block", "ZIP", false]);
  await size("Large");
  await page.waitForFunction(() => /\[data\\?\.zip\]\(data\.zip "large"\)/.test(MdActive.view.serialize()), null, { timeout: 8000 });
  const large = await box();
  assert.deepEqual([large[0], large[3], large[2] > medium[2] + 10], ["file-block file-large", false, true]);
  await size("Small");
  await page.waitForFunction(() => /\[data\\?\.zip\]\(data\.zip "small"\)/.test(MdActive.view.serialize()), null, { timeout: 8000 });
  assert.ok((await box())[2] < medium[2]);
  // read, it is drawn the same
  await until(() => /data\.zip "small"/.test(text("Files.md") || ""), "written");
  await page.evaluate(() => MdView.setMode("read"));
  await page.waitForFunction(() => (document.body.dataset.view || "read") === "read" && document.querySelector("#content p.file-block.file-small"), null, { timeout: 8000 });
  assert.deepEqual(await page.evaluate(() => { const p = document.querySelector("#content p.file-block.file-small"); return [p.dataset.ext, p.querySelector("a").hasAttribute("title")]; }), ["ZIP", false]);
  // (a picture of the three, for looking at)
  put("Sizes.md", "# Sizes\n\n[small.zip](data.zip \"small\")\n\n[medium.zip](data.zip)\n\n[A larger file, with a name.pdf](paper.pdf \"large\")\n");
  await open("Sizes.md");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(web, ".next", "file-sizes.png"), clip: { x: 300, y: 60, width: 800, height: 330 } });
});

test("code put away behind a card: a click shows it in a window, the menu puts it away and brings it back", async () => {
  put("Hidden.md", "# Hidden\n\n```js hide The helper\nconst answer = 42;\nexport default answer;\n```\n\n```js\nlet shown = true;\n```\n");
  await open("Hidden.md");
  assert.deepEqual(await page.evaluate(() => [document.querySelectorAll("#content .code-card").length, document.querySelector("#content .code-card-title").textContent, document.querySelector("#content .code-hidden pre").hidden]), [1, "The helper", true]);
  await page.click("#content .code-card");
  await page.waitForFunction(() => document.querySelector("#codeview").hasAttribute("data-open"), null, { timeout: 8000 });
  assert.deepEqual(await page.evaluate(() => [document.querySelector("#codeview-title").textContent, document.querySelector("#codeview .code-lang").textContent, document.querySelector("#codeview pre code").textContent, !!document.querySelector("#codeview pre code .hljs-keyword")]), ["The helper", "js", "const answer = 42;\nexport default answer;\n", true]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(web, ".next", "codeview.png") });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#codeview").hasAttribute("data-open"), null, { timeout: 8000 });
  await page.screenshot({ path: join(web, ".next", "codecard.png"), clip: { x: 300, y: 60, width: 760, height: 260 } });
  // in the active mode: the menu of a code block puts it away, and brings it back
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.pm.editable && document.querySelectorAll(".pm .code-block").length === 2, null, { timeout: 15000 });
  const toggle = async (sel) => {
    await page.click(sel, { button: "right" });
    await page.waitForFunction(() => document.querySelector("#actmenu").hasAttribute("data-open"), null, { timeout: 8000 });
    await page.evaluate(() => [...document.querySelectorAll("#actmenu .menu-item")].find((e) => e.textContent.startsWith("Hide the Code")).click());
    await page.waitForFunction(() => !document.querySelector("#actmenu").hasAttribute("data-open"), null, { timeout: 8000 }); // (it blinks, acts, and is gone)
  };
  await toggle(".pm .code-block:not(.code-hidden)");
  await page.waitForFunction(() => /```js hide\nlet shown = true;/.test(MdActive.view.serialize()), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => document.querySelectorAll(".pm .code-hidden").length), 2);
  await toggle(".pm .code-hidden");
  await page.waitForFunction(() => /```js The helper\nconst answer/.test(MdActive.view.serialize()), null, { timeout: 8000 });
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

test("a whiteboard is made in the note, drawn on with the pointer, kept in commits, and shown by its picture", async () => {
  await open("Beta.md");
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active", null, { timeout: 10000 });
  await page.evaluate(() => { MdActive.view.focus(); MdActive.context.INSERT.board(MdActive.view.pm); });
  await page.waitForFunction(() => window.MdBoard && MdBoard.shown && document.getElementById("board").hasAttribute("data-ready"), null, { timeout: 15000 });
  const name = () => [...gh.repo.files.keys()].find((k) => /^board-\d{8}-\d{6}\.board\.svg$/.test(k));
  await until(() => !!name(), "the board's file in the repository");
  assert.match(text(name()), /<metadata id="mdview-board">/);
  assert.equal(JSON.parse(text(".mdview/attachments.json"))[name()] ?? Object.values(JSON.parse(text(".mdview/attachments.json"))).includes("Beta.md"), "Beta.md"); // (the note's own: it goes with the note)
  assert.equal(await page.evaluate(() => MdBoard.state().items), 0);
  await page.waitForTimeout(700); // (grown to the window's size)
  await page.mouse.move(400, 400);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(400 + i * 10, 400 + Math.sin(i / 2) * 40);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => MdBoard.state().items), 1);
  const strokes = () => (text(name()) || "").split("\n").filter((l) => l.startsWith('{"id"')).length;
  await until(() => strokes() === 1, "the stroke in a commit", 12000);
  await until(() => (text("Beta.md") || "").includes(`![](${name()})`), "the note names the board", 12000);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !MdBoard.shown && document.getElementById("board").hidden, null, { timeout: 5000 });
  await page.waitForFunction(() => { const i = document.querySelector("#active .board-block img"); return i && i.complete && i.naturalWidth > 250; }, null, { timeout: 8000 }); // (what was drawn, not the empty board's sign)
  // opened again in the reading view: the stroke is there
  await page.evaluate(() => MdView.setMode("read"));
  await page.waitForFunction(() => document.body.dataset.view !== "active" && document.querySelector("#content .board-block img"), null, { timeout: 8000 });
  await page.click("#content .board-block img");
  await page.waitForFunction(() => MdBoard.shown && document.getElementById("board").hasAttribute("data-ready") && MdBoard.state().items === 1, null, { timeout: 8000 });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !MdBoard.shown, null, { timeout: 5000 });
});

test("nothing was refused or thrown along the way", () => {
  // (but the answers that were cut off on purpose above: a commit that could not be sent is said, and tried again)
  assert.deepEqual(problems.filter((p) => !/Failed to load resource|mdview host: commit TypeError: Failed to fetch/i.test(p)), []);
});
