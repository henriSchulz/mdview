// Links, PDF links and PDF embeds in the web app, in a repository laid out as Henri's notes are
// (his DreamChip notes: notes in risc-v/tracing/, the PDFs in assets/risc-v/, no .obsidian): every
// link found, opened where it says — a page of a PDF too —, every region of a PDF drawn, also out
// of a PDF of several MB; names with spaces, umlauts and "&". The built app against a GitHub of the
// test's own, in a real browser. Run: npm run build && npm test; in Firefox or WebKit (Henri reads on
// Firefox and on an iPad): BROWSER=firefox node --test test/links.test.mjs, after `npx playwright-core install firefox`
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright-core";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(web, "..", "dev", "tests", "tauri-check");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const gh = fakeGitHub();
let app, base, browser, page;
const problems = [];

/* A PDF of `pages` pages of US letter, each saying its number; `filler` bytes of a stream nobody
 * draws make it as large as a real one (Henri's thesis PDF: 5 MB). */
function makePdf(pages, filler = 0) {
  const objs = [], add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null), tree = add(null), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  for (let n = 1; n <= pages; n++) {
    const text = `BT /F1 36 Tf 80 600 Td (Page ${n}) Tj ET 0 0 1 rg 76 65 481 298 re f`;
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  if (filler) add(`<< /Length ${filler} >>\nstream\n${"%".repeat(filler)}\nendstream`);
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objs[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`;
  let out = "%PDF-1.4\n";
  const at = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + at.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const NOTE = "risc-v/tracing/06 E-Trace Spec.md";
const files = {
  [NOTE]: [
    "# E-Trace",
    "",
    "Spec: [[risc-v-e-trace-spec.pdf#page=35|Spec, S. 25]]. Overview: [[00 Übersicht]], [[Elsewhere]], [[README_DCT_RISC_V_Trace_Setup&Issues.pdf#page=2|the readme]].",
    "",
    "Markdown: [the spec](../../assets/risc-v/risc-v-e-trace-spec.pdf), [the overview](<00 Übersicht.md>), [elsewhere](../../other/Elsewhere.md), [the readme](<../../assets/README_DCT_RISC_V_Trace_Setup&Issues.pdf>).",
    "",
    "![[risc-v-e-trace-spec.pdf#page=12&rect=76,65,557,363]]",
    "",
    "![[Masterarbeit_Tobias_Walther.pdf#page=35&rect=120,88,520,330]]",
    "",
    "![a picture](../../assets/risc-v/pic%20one.png)",
    "",
    "![[pic one.png|200]]",
    "",
  ].join("\n"),
  "risc-v/tracing/00 Übersicht.md": "# Übersicht\n\nBack: [[06 E-Trace Spec]]\n",
  "other/Elsewhere.md": "# Elsewhere\n\nThe spec: [[risc-v-e-trace-spec.pdf#page=3]]\n",
  ".mdview/project.json": "{\"id\":\"x\",\"version\":1}",
};
const BIG = makePdf(40, 5_000_000);

before(async () => {
  for (const [p, text] of Object.entries(files)) gh.repo.files.set(p, Buffer.from(text));
  gh.repo.files.set("assets/risc-v/risc-v-e-trace-spec.pdf", makePdf(40));
  gh.repo.files.set("assets/risc-v/Masterarbeit_Tobias_Walther.pdf", BIG);
  gh.repo.files.set("assets/README_DCT_RISC_V_Trace_Setup&Issues.pdf", makePdf(3));
  gh.repo.files.set("assets/risc-v/pic one.png", readFileSync(join(fixtures, "bild.png")));
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
  const session = back.headers.getSetCookie().find((c) => c.startsWith("mdview=")).split(";")[0];
  const engine = { firefox, webkit }[process.env.BROWSER];
  if (!engine) assert.ok(browserPath && existsSync(browserPath), "no Chromium found (set CHROMIUM)");
  browser = engine ? await engine.launch({ headless: true }) : await chromium.launch({ executablePath: browserPath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "mdview", value: session.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
});

after(async () => { await browser?.close(); app?.kill(); gh.close(); });

const current = () => page.evaluate(() => MdView.core.current && MdView.core.current.name);
const until = (fn, arg, ms = 15000) => page.waitForFunction(fn, arg, { timeout: ms });
const untilShown = (name) => until((n) => window.MdView && MdView.core.current && MdView.core.current.name === n && (n.endsWith(".pdf") ? document.querySelector(".pdf-page canvas, .pdf-page img") : document.querySelector("#content").innerText.length > 0), name, 25000);
const pdfPage = () => page.evaluate(() => window.MdPdf && MdPdf.shown && MdPdf.shown.now);
const home = async () => { await page.goto(`${base}/r/octo/notes?n=${encodeURIComponent(NOTE)}`); await untilShown("06 E-Trace Spec.md"); await page.evaluate(() => { if (document.body.dataset.sidebar !== "open") document.querySelector('#tabs [data-act="sidebar"]').click(); }); };

test("every link of a note of a subfolder is found: notes of other folders, PDFs in assets/…, names with spaces, umlauts and &", async () => {
  await home();
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => ({
    links: [...document.querySelectorAll("#content a.wikilink[data-wiki]")].map((a) => [a.dataset.wiki, !a.classList.contains("unresolved")]),
    missing: [...document.querySelectorAll("#content .embed-missing")].map((e) => e.dataset.wiki),
    embeds: document.querySelectorAll("#content .pdf-embed").length,
  }));
  assert.deepEqual(got.missing, []);
  assert.deepEqual(got.links.filter(([, ok]) => !ok), [], "links shown as not existing");
  assert.equal(got.embeds, 2);
});

test("a region of a PDF embedded with rect is drawn — out of a PDF of 5 MB too", async () => {
  await home();
  for (let i = 0; i < 2; i++) {
    await page.evaluate((i) => document.querySelectorAll("#content .pdf-embed")[i].scrollIntoView({ block: "center" }), i);
    await until((i) => { const e = document.querySelectorAll("#content .pdf-embed")[i]; return e && e.classList.contains("ready") && e.querySelector("img") && e.querySelector("img").naturalWidth > 0; }, i, 30000);
  }
});

test("pictures of another folder are shown: a relative path with a space, and an embed by its name", async () => {
  await home();
  await until(() => { const i = [...document.querySelectorAll("#content img")].filter((i) => !i.classList.contains("pdf-embed-img")); return i.length === 2 && i.every((x) => x.complete && x.naturalWidth > 0); }, null, 15000);
});

test("a link opens what it names, where it is: a note of the same folder, of another, a PDF at its page", async () => {
  await home();
  await page.click('#content a[data-wiki="00 Übersicht"]');
  await untilShown("00 Übersicht.md");
  await home();
  await page.click('#content a[data-wiki="Elsewhere"]');
  await untilShown("Elsewhere.md");
  await home();
  await page.click('#content a[data-wiki="risc-v-e-trace-spec.pdf#page=35"]');
  await untilShown("risc-v-e-trace-spec.pdf");
  await until(() => MdPdf.shown && MdPdf.shown.now === 35, null, 15000);
  await home();
  await page.click('#content a[data-wiki="README_DCT_RISC_V_Trace_Setup&Issues.pdf#page=2"]');
  await untilShown("README_DCT_RISC_V_Trace_Setup&Issues.pdf");
  await until(() => MdPdf.shown && MdPdf.shown.now === 2, null, 15000);
});

test("Markdown links of a note of a subfolder: ../ to another folder, a name in <…> with an umlaut, a PDF with & in its name", async () => {
  for (const [href, name] of [["../../other/Elsewhere.md", "Elsewhere.md"], ["00 Übersicht.md", "00 Übersicht.md"], ["../../assets/risc-v/risc-v-e-trace-spec.pdf", "risc-v-e-trace-spec.pdf"], ["../../assets/README_DCT_RISC_V_Trace_Setup&Issues.pdf", "README_DCT_RISC_V_Trace_Setup&Issues.pdf"]]) {
    await home();
    await page.evaluate((h) => { const a = [...document.querySelectorAll("#content a[href]")].find((a) => decodeURI(a.getAttribute("href")) === h || a.getAttribute("href") === h); if (!a) throw new Error("no link " + h); a.click(); }, href);
    await untilShown(name);
  }
});

test("a link copied in the PDF viewer (a region) is found again from the note", async () => {
  await home();
  await page.click('#content a[data-wiki="risc-v-e-trace-spec.pdf#page=35"]');
  await untilShown("risc-v-e-trace-spec.pdf");
  const text = await page.evaluate(() => MdPdf.sheet.copyLink(MdPdf.shown.p.path, { page: 12, rect: [76, 65, 557, 363] }));
  assert.equal(text.trim(), "![[risc-v-e-trace-spec.pdf#page=12&rect=76,65,557,363]]");
  await home();
  const target = /\[\[([^\]|]+)/.exec(text)[1];
  const info = await page.evaluate((target) => new Promise((done) => { const was = MdView.linkResolved; MdView.linkResolved = (t, i) => { MdView.linkResolved = was; was(t, i); done(i); }; MdHost.post(JSON.stringify({ type: "resolve", target })); }), target);
  assert.equal(info && info.path, "/octo/notes/assets/risc-v/risc-v-e-trace-spec.pdf");
});

test("a note made after the note was read: a link to it is found without a reload", async () => {
  await home();
  await page.evaluate(() => MdHost.post(JSON.stringify({ type: "newnote", dir: "/octo/notes/other", name: "Later" })));
  await page.waitForTimeout(800);
  await home();
  const target = "Later";
  const info = await page.evaluate((target) => new Promise((done) => { const was = MdView.linkResolved; MdView.linkResolved = (t, i) => { MdView.linkResolved = was; was(t, i); done(i); }; MdHost.post(JSON.stringify({ type: "resolve", target })); }), target);
  assert.equal(info && info.path, "/octo/notes/other/Later.md");
});

test("a PDF moved to another folder in the web app: its embed and its link are found there, without a reload", async () => {
  await home();
  await page.evaluate(() => MdHost.post(JSON.stringify({ type: "move", path: "/octo/notes/assets/risc-v/risc-v-e-trace-spec.pdf", dir: "/octo/notes/other" })));
  await page.waitForTimeout(800);
  await page.evaluate(() => MdHost.post(JSON.stringify({ type: "note", path: "/octo/notes/risc-v/tracing/00 Übersicht.md" })));
  await untilShown("00 Übersicht.md");
  await page.evaluate(() => MdHost.post(JSON.stringify({ type: "note", path: "/octo/notes/risc-v/tracing/06 E-Trace Spec.md" })));
  await untilShown("06 E-Trace Spec.md");
  assert.equal(await page.evaluate(() => document.querySelector('#content a[data-wiki="risc-v-e-trace-spec.pdf#page=35"]').classList.contains("unresolved")), false);
  await page.evaluate(() => document.querySelector("#content .pdf-embed").scrollIntoView({ block: "center" }));
  await until(() => { const e = document.querySelector("#content .pdf-embed"); return e && e.dataset.pdf === "/octo/notes/other/risc-v-e-trace-spec.pdf" && e.classList.contains("ready") && e.querySelector("img"); }, null, 20000);
});

test("nothing was refused or thrown along the way", () => {
  assert.deepEqual(problems.filter((p) => !/favicon|Failed to load resource: the server responded with a status of 40[14]/.test(p)), []);
});
