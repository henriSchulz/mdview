// The welcome page: what is seen at the address without signing in. It is the app itself, with a
// handful of sample notes (public/host/demo.js) — scrolling writes one of them into it. Here: the
// notes, and the page's document. How it moves is public/welcome/welcome.js, how it looks
// public/welcome/welcome.css; the engine under it (scrollcraft.js, scrollcraft.css) is not ours.
import { randomBytes } from "node:crypto";
import { attr, inline } from "@/lib/page";

export const REPOSITORY = "https://github.com/henriSchulz/mdview";

/** The note that is written while the page is scrolled, as far as it stands when the page opens … */
export const OPENING = `# Notes that stay yours

Scroll, and this note writes itself.
`;
/** … and all of it. */
export const WELCOME = `${OPENING}
Every note is a **Markdown file** in a Git repository *you* own. Scroll back up and it is unwritten again.

- [x] Plain text that every other tool can open
- [x] Formulas, tables, callouts and files in the note
- [ ] A link for anyone who should read it

$$
e^{i\\pi} + 1 = 0
$$

| Where   | How                          |
| ------- | ---------------------------- |
| Desktop | an app for Linux             |
| Browser | sign in with GitHub          |
| A link  | read only, for whoever has it |

> [!tip] One more thing
> The address of a shared note with \`/raw\` behind it gives this text, exactly as it is typed here.
`;

const FORMULAS = `# Formulas

Written as LaTeX, shown as they are meant: $a^2 + b^2 = c^2$ in a line, or set apart.

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

$$
\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}^{-1} = \\frac{1}{ad - bc}\\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}
$$
`;
const CALLOUTS = `# Callouts

> [!note] A note
> Something to keep in mind.

> [!warning] A warning
> Something to look out for.

> [!success]- Folded until it is opened
> A callout with a \`-\` behind its kind starts closed.
`;
const CODE = `# Code

\`\`\`rust
fn main() {
    let notes = std::fs::read_dir("notes").unwrap();
    println!("{} notes", notes.count());
}
\`\`\`

\`\`\`sh
curl https://md.henrischulz.com/k/raw
\`\`\`
`;
const TRY = `# Your turn

This is the editor itself, running in your browser. Click into the text and type.

- [ ] Make something **bold**
- [ ] Write a formula: $e^{i\\pi} + 1 = 0$
- [ ] Open another note in the sidebar

Nothing you write here is kept: these notes live in this tab only.
`;

const SAMPLES = { "Formulas.md": FORMULAS, "Callouts.md": CALLOUTS, "Code.md": CODE };
/** The notes of one of the page's windows. write: the note being written. share: the same note, done,
 * and shared. try: a note to write in. note: the shared note as whoever has its link sees it. */
export function demo(view: string, here: string) {
  const link = `${here}/welcome/note`;
  if (view === "try") return { id: "try", notes: { "Try it.md": TRY, "Welcome.md": WELCOME, ...SAMPLES }, first: "Try it.md", mode: "active", link };
  if (view === "share") return { id: "share", notes: { "Welcome.md": WELCOME, ...SAMPLES }, first: "Welcome.md", mode: "read", link, side: false };
  if (view === "note") return { id: "note", notes: { "Welcome.md": WELCOME }, first: "Welcome.md", mode: "read", link, shared: true, bare: true };
  return { id: "write", notes: { "Welcome.md": OPENING, ...SAMPLES }, first: "Welcome.md", mode: "read", link, side: false };
}

const GITHUB = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.4c-2.23.48-2.7-.95-2.7-.95-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"/></svg>`;
const DOWN = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.75v8.5m0 0L4.75 7M8 10.25 11.25 7M2.75 13.25h10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The page. */
export function welcomeDocument(here: string, why: string | null): Response {
  const nonce = randomBytes(16).toString("base64"), w = "/welcome";
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`;
  const frame = (view: string, title: string) => `<iframe class='win__app' data-view='${view}' data-src='${w}/app?view=${view}' title='${attr(title)}' loading='lazy' tabindex='-1'></iframe>`;
  const page = `<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'>
<title>Markdown Notes · notes that stay yours</title>
<meta name='description' content='Notes as Markdown files in a Git repository you own. An app for the desktop and the browser, with formulas, tables, files, and a link to share a note.'>
<link rel='icon' href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230071e3'/><path d='M8 22V10l5 6 5-6v12M22 10v12m0 0-3-3m3 3 3-3' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/></svg>">
<link rel='stylesheet' href='/app/motion.css'><link rel='stylesheet' href='${w}/scrollcraft.css'><link rel='stylesheet' href='${w}/welcome.css'>
</head><body>
<main id='top'>

<section id='write' data-sc-act='pin' data-sc-span='4.6' aria-labelledby='hero-h'>
  <div data-sc-stage class='stage write'>
    <div class='glow' aria-hidden='true'></div>
    <header class='hero'>
      <div class='hero__top'><span class='hero__mark'>Markdown Notes</span><a class='hero__in' href='${here}/auth/login'>Sign in</a></div>
      <h1 id='hero-h' class='hero__h'>Notes that stay <em>yours</em>.</h1>
      <p class='hero__p'>A fast, beautiful editor for Markdown files in your own Git repository. On the desktop, in the browser, and under a link.</p>
      <div class='hero__go'>
        <a class='btn btn--main' href='${here}/auth/login'>${GITHUB}<span>Sign in with GitHub</span></a>
        <a class='btn' href='${REPOSITORY}#install'>${DOWN}<span>Get the desktop app</span></a>
      </div>
      <p class='hero__cue'><span>Scroll. The page writes the note for you.</span><svg viewBox='0 0 16 16' aria-hidden='true'><path d='M8 2.5v10m0 0L4 8.6m4 3.9 4-3.9' fill='none' stroke='currentColor' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg></p>
      <div class='chips' aria-hidden='true'>
        <code class='chip' style='--x:-41;--y:-6;--z:1.5'># heading</code><code class='chip' style='--x:38;--y:-13;--z:.8'>**bold**</code>
        <code class='chip' style='--x:-33;--y:22;--z:.6'>- [x] task</code><code class='chip' style='--x:42;--y:16;--z:1.3'>$$ e^{i\\pi} $$</code>
        <code class='chip' style='--x:-45;--y:-27;--z:.9'>[[link]]</code><code class='chip' style='--x:31;--y:-31;--z:1.1'>| table |</code>
        <code class='chip' style='--x:47;--y:-1;--z:.5'>/raw</code><code class='chip' style='--x:-24;--y:-36;--z:.7'>&gt; [!tip]</code>
      </div>
    </header>
    <div class='side'>
      <div class='cap'><h2>Your scroll wheel is the keyboard.</h2><p>Keep going and the note gets written. Scroll back up and it is unwritten again.</p></div>
    <div class='src' aria-hidden='true'>
      <div class='src__bar'><span class='src__name'>Welcome.md</span><span class='src__kind'>Markdown</span></div>
      <div class='src__body'><pre class='src__text'><span class='src__typed'></span><span class='src__caret'></span></pre></div>
    </div>
    </div>
    <div class='win write__win'>${frame("write", "The app, showing the note as it is written")}<div class='win__wait' role='status' aria-label='Loading'><span class='ring'></span></div></div>
    <noscript><p class='nojs'>This page shows the app at work and needs JavaScript. <a href='${here}/signin'>Sign in with GitHub</a> or <a href='${REPOSITORY}#install'>get the desktop app</a>.</p></noscript>
  </div>
</section>

<section id='files' class='sc-section facts' aria-labelledby='files-h'>
  <div class='sc-wrap facts__in' data-sc-in data-sc-stagger='60'>
    <h2 id='files-h' class='facts__h'>A folder of Markdown files. Nothing else.</h2>
    <p class='facts__p'>The app keeps no notes of its own. It reads and writes <code>.md</code> files in a repository on your GitHub account, so whatever else you use can open them too.</p>
    <dl class='facts__list'>
      <div><dt>Where they are</dt><dd>In a Git repository you choose. The app reaches only the repositories you give it.</dd></div>
      <div><dt>What they are</dt><dd>Markdown, with formulas, tables, callouts, diagrams, and files laid into a note.</dd></div>
      <div><dt>What is kept</dt><dd>Every version, as a commit. Any of them can be looked at and put back.</dd></div>
      <div><dt>What is not here</dt><dd>No writing by a model in the browser, and no account besides GitHub.</dd></div>
    </dl>
  </div>
</section>

<section id='share' data-sc-act='pin' data-sc-span='2.8' aria-label='A note shared under a link'>
  <div data-sc-stage class='stage share'>
    <div class='glow glow--b' aria-hidden='true'></div>
    <div class='cap share__cap'><h2>One link. Anyone can read it.</h2><p>Share a single note, read only, with a password if you like. Put <code>/raw</code> behind the link and you get the Markdown itself.</p></div>
    <div class='win share__win'>${frame("share", "The app, sharing the note under a link")}<div class='win__wait' role='status' aria-label='Loading'><span class='ring'></span></div>
      <div class='raw' aria-label='The shared note as plain Markdown'>
        <div class='raw__bar'><code class='raw__cmd'>curl <a href='${here}${w}/note/raw'>${attr(here.replace(/^https?:\/\//, ""))}${w}/note/raw</a></code></div>
        <pre class='raw__text'></pre>
      </div>
    </div>
  </div>
</section>

<section id='places' data-sc-act='pan' data-sc-span='4.2' aria-labelledby='places-h'>
  <div data-sc-stage class='stage places'>
    <div class='rail' data-sc-pan='0.04'>
      <div class='place place--lead'><h2 id='places-h'>The same notes, in five places.</h2><p>None of them is a copy.</p></div>
      <article class='place'><h3>Desktop</h3><p>An app for Linux, opened on a folder. It works on any Markdown file, with nothing to set up.</p><pre><code>mdview ~/notes</code></pre></article>
      <article class='place'><h3>Browser</h3><p>Sign in with GitHub and choose a repository. The page is the same one the desktop app is made of.</p><pre><code>${attr(here.replace(/^https?:\/\//, ""))}</code></pre></article>
      <article class='place'><h3>Repository</h3><p>What you write becomes a commit in your own repository. Clone it and the notes are files again.</p><pre><code>git clone github.com/you/notes</code></pre></article>
      <article class='place'><h3>Link</h3><p>One note, read only, for whoever has the link. With a password if you set one.</p><pre><code>${attr(here.replace(/^https?:\/\//, ""))}/k</code></pre></article>
      <article class='place'><h3>Terminal</h3><p>The same link with <code>/raw</code> behind it gives the Markdown as it was written.</p><pre><code>curl ${attr(here.replace(/^https?:\/\//, ""))}/k/raw</code></pre></article>
    </div>
  </div>
</section>

<section id='try' data-sc-act='pin' data-sc-span='1.3' aria-label='Write a note yourself'>
  <div data-sc-stage class='stage try'>
    <div class='win try__win'>${frame("try", "The app, with a note to write in")}<div class='win__wait' role='status' aria-label='Loading'><span class='ring'></span></div></div>
    <div class='go'>
      <h2 class='go__h'>Your turn.</h2>
      <p class='go__p'>That is the real editor. Type in it, then take your own notes with you.</p>
      ${why ? `<p class='go__why' role='status'>${attr(why)}</p>` : ""}
      <a class='btn btn--main' href='${here}/auth/login'>${GITHUB}<span>Sign in with GitHub</span></a>
      <a class='btn' href='${REPOSITORY}#install'>${DOWN}<span>Get the desktop app</span></a>
      <p class='go__small'>Free and open source. The desktop app is built from its source, for Linux. <a href='${REPOSITORY}'>github.com/henriSchulz/mdview</a></p>
    </div>
  </div>
</section>

</main>

<nav class='status' aria-label='This page'>
  <a class='status__mark' href='#top'>Markdown Notes</a>
  <ol class='status__acts'>
    <li><a href='#write' data-act='write'>Write</a></li>
    <li><a href='#files' data-act='files'>Files</a></li>
    <li><a href='#share' data-act='share'>Share</a></li>
    <li><a href='#places' data-act='places'>Places</a></li>
    <li><a href='#try' data-act='try'>Try</a></li>
  </ol>
  <span class='status__line' aria-hidden='true'></span>
  <a class='status__in' href='${here}/auth/login'>Sign in with GitHub</a>
</nav>

<script nonce='${nonce}'>window.MdWelcome=${inline({ opening: OPENING, text: WELCOME, raw: `${w}/note/raw` })};</script>
<script nonce='${nonce}' src='${w}/scrollcraft.js'></script>
<script nonce='${nonce}' src='${w}/welcome.js'></script>
</body></html>`;
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" } });
}
