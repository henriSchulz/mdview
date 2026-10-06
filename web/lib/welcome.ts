// The welcome page: what is seen at the address without signing in. It is the app itself, with a
// handful of sample notes (public/host/demo.js) — scrolling writes one of them into it. Here: the
// notes, and the page's document. How it moves is public/welcome/welcome.js, how it looks
// public/welcome/welcome.css; the engine under it (scrollcraft.js, scrollcraft.css) is not ours.
import { randomBytes } from "node:crypto";
import { attr, icons, inline } from "@/lib/page";

export const REPOSITORY = "https://github.com/henriSchulz/mdview";

/** The note that is written while the page is scrolled, as far as it stands when the page opens … */
export const OPENING = `# Notes that stay yours

Write in Markdown. Read it the way it is meant.
`;
/** … and all of it. */
export const WELCOME = `${OPENING}
Every note is a **Markdown file** in a Git repository *you* own.

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

> [!success] Done
> Callouts come in many kinds, and each can fold.

> [!tip]- Folded until it is opened
> A callout with a \`-\` behind its kind starts closed.
`;
const CODE = `# Code

\`\`\`rust
fn main() {
    let notes = std::fs::read_dir("notes").unwrap();
    println!("{} notes", notes.count());
}
\`\`\`

\`\`\`python
def title(note: str) -> str:
    return note.splitlines()[0].lstrip("# ")
\`\`\`
`;
const TASKS = `# Tasks and tables

- [x] Write the outline
- [x] Collect the figures
- [ ] Send it round
    - [ ] to the team
    - [ ] to the client

| Milestone | Owner | Due    |
| --------- | ----- | ------ |
| Draft     | Ada   | Monday |
| Review    | Linus | Friday |
| Release   | Grace | ==next week== |
`;
const DIAGRAMS = `# Diagrams

\`\`\`mermaid
flowchart LR
  A[A note] --> B{Saved}
  B --> C[A commit in your repository]
  C --> D[Desktop]
  C --> E[Browser]
  C --> F[A link]
\`\`\`
`;
const COLUMNS = `# Columns

<!-- columns 1:1 -->

### This week

- [x] Read the paper
- [ ] Write the summary

<!-- column -->

### Remember

> [!note] Thursday
> The seminar moved to room 204.

<!-- /columns -->

Wikilinks lead from one note to another: [[Formulas]], [[Callouts]], [[Diagrams]].
`;
const TRY = `# Try it

This is the editor itself, running in your browser. Click into the text and type.

- [ ] Make something **bold**
- [ ] Write a formula: $e^{i\\pi} + 1 = 0$
- [ ] Open another note in the sidebar

Nothing you write here is kept: these notes live in this tab only.
`;

const SAMPLES = { "Formulas.md": FORMULAS, "Callouts.md": CALLOUTS, "Code.md": CODE, "Tasks and tables.md": TASKS, "Diagrams.md": DIAGRAMS, "Columns.md": COLUMNS };
/** The notes of one of the page's windows. write: the note being written. share: the same note, done,
 * … tour: the notes that show what a note can hold. try: a note to write in. note: the shared note as whoever has its link sees it. */
export function demo(view: string, here: string) {
  const link = `${here}/welcome/note`;
  if (view === "try") return { id: "try", notes: { "Try it.md": TRY, "Welcome.md": WELCOME, ...SAMPLES }, first: "Try it.md", mode: "active", link };
  if (view === "tour") return { id: "tour", notes: { ...SAMPLES, "Welcome.md": WELCOME }, first: "Formulas.md", mode: "read", link, side: false };
  if (view === "note") return { id: "note", notes: { "Welcome.md": WELCOME }, first: "Welcome.md", mode: "read", link, shared: true, bare: true };
  return { id: "write", notes: { "Welcome.md": OPENING, ...SAMPLES }, first: "Welcome.md", mode: "read", link, side: false };
}

const GITHUB = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.4c-2.23.48-2.7-.95-2.7-.95-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"/></svg>`;
const DOWN = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.75v8.5m0 0L4.75 7M8 10.25 11.25 7M2.75 13.25h10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The page. */
export function welcomeDocument(here: string, why: string | null): Response {
  const nonce = randomBytes(16).toString("base64"), w = "/welcome";
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`;
  const frame = (view: string, title: string) => `<iframe class='win__app' data-view='${view}' data-src='${w}/app?view=${view}' title='${attr(title)}' loading='lazy' tabindex='-1'></iframe>`;
  const page = `<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'>
<title>Markdown Notes · notes that stay yours</title>
<meta name='description' content='Notes as Markdown files in a Git repository you own. An app for the desktop and the browser, with formulas, tables, files, and a link to share a note.'>
${icons(here)}<meta name='theme-color' content='#e9e9ee' media='(prefers-color-scheme: light)'><meta name='theme-color' content='#131315' media='(prefers-color-scheme: dark)'>
<link rel='canonical' href='${here}/'><meta property='og:type' content='website'><meta property='og:title' content='Markdown Notes'><meta property='og:description' content='Notes as Markdown files in a Git repository you own.'><meta property='og:url' content='${here}/'><meta property='og:image' content='${here}/welcome/icon-512.png'>
<link rel='stylesheet' href='/app/motion.css'><link rel='stylesheet' href='${w}/scrollcraft.css'><link rel='stylesheet' href='${w}/welcome.css'>
</head><body>
<main id='top'>

<section id='write' data-sc-act='pin' data-sc-span='4.6' aria-labelledby='hero-h'>
  <div data-sc-stage class='stage write'>
    <div class='glow' aria-hidden='true'></div>
    <header class='hero'>
      <div class='hero__top'><span class='hero__mark'><img src='/welcome/icon.svg' alt='' width='28' height='28'>Markdown Notes</span><a class='hero__in' href='${here}/auth/login'>Sign in</a></div>
      <h1 id='hero-h' class='hero__h'>Notes that stay <em>yours</em>.</h1>
      <p class='hero__p'>A fast, beautiful editor for Markdown files in your own Git repository. On the desktop, in the browser, and under a link.</p>
      <div class='hero__go'>
        <a class='btn btn--main' href='${here}/auth/login'>${GITHUB}<span>Sign in with GitHub</span></a>
        <a class='btn' href='${REPOSITORY}#install'>${DOWN}<span>Get the desktop app</span></a>
      </div>
      <p class='hero__cue'><span>See what it does</span><svg viewBox='0 0 16 16' aria-hidden='true'><path d='M8 2.5v10m0 0L4 8.6m4 3.9 4-3.9' fill='none' stroke='currentColor' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg></p>
      <div class='chips' aria-hidden='true'>
        <code class='chip' style='--x:-41;--y:-6;--z:1.5'># heading</code><code class='chip' style='--x:38;--y:-13;--z:.8'>**bold**</code>
        <code class='chip' style='--x:-33;--y:22;--z:.6'>- [x] task</code><code class='chip' style='--x:42;--y:16;--z:1.3'>$$ e^{i\\pi} $$</code>
        <code class='chip' style='--x:-45;--y:-27;--z:.9'>[[link]]</code><code class='chip' style='--x:31;--y:-31;--z:1.1'>| table |</code>
        <code class='chip' style='--x:47;--y:-1;--z:.5'>/raw</code><code class='chip' style='--x:-24;--y:-36;--z:.7'>&gt; [!tip]</code>
      </div>
    </header>
    <div class='side'>
      <div class='cap'><h2>Write Markdown. See it rendered.</h2><p>Tasks, formulas, tables and callouts take shape as you type. Read the note, write in the rendered page, or edit the source.</p></div>
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
      <div><dt>What they are</dt><dd>Markdown that every other tool can open, on the desktop, in the browser, or in a terminal.</dd></div>
      <div><dt>What is kept</dt><dd>Every version, as a commit. Any of them can be looked at and put back.</dd></div>
      <div><dt>What is not here</dt><dd>No writing by a model in the browser, and no account besides GitHub.</dd></div>
    </dl>
  </div>
</section>

<section id='blocks' data-sc-act='pin' data-sc-span='4.4' aria-labelledby='blocks-h'>
  <div data-sc-stage class='stage tour'>
    <div class='glow glow--b' aria-hidden='true'></div>
    <div class='cap tour__cap'>
      <h2 id='blocks-h'>Everything a note can hold.</h2>
      <ol class='tour__names'><li class='tour__mark' aria-hidden='true'></li><li data-note='Formulas.md'>Formulas</li><li data-note='Callouts.md'>Callouts</li><li data-note='Code.md'>Code</li><li data-note='Tasks and tables.md'>Tasks and tables</li><li data-note='Diagrams.md'>Diagrams</li><li data-note='Columns.md'>Columns and links</li><li data-note='Welcome.md'>Sharing</li></ol>
      <div class='tour__texts'><p>LaTeX in a line or set apart, rendered with KaTeX as you type.</p><p>Notes, tips and warnings in boxes of their own. Each can fold.</p><p>Fenced code, highlighted, with a button to copy it.</p><p>Tick a task where you read it. Tables are edited as tables.</p><p>Mermaid diagrams drawn from the text in the note.</p><p>Blocks side by side, and wikilinks from one note to the next.</p><p>One note under a short link, read only, with a password if you like.</p></div>
    </div>
    <div class='tour__scene'>
      <div class='tour__glyphs' aria-hidden='true'><span data-hue='#0071e3'>∑</span><span data-hue='#ff9f0a'>!</span><span data-hue='#a05bff'>{ }</span><span data-hue='#30b45a'>✓</span><span data-hue='#18a6c9'>◇</span><span data-hue='#ff5a8a'>▥</span><span data-hue='#0071e3'>↗</span></div>
      <div class='win tour__win'>${frame("tour", "The app, showing what a note can hold")}<div class='win__wait' role='status' aria-label='Loading'><span class='ring'></span></div></div>
      <div class='tour__src' aria-hidden='true'><div class='tour__srcbar'>Markdown</div><div class='tour__srcs'><pre><code>$$\n\\int e^{-x^2}\\,dx = \\sqrt{\\pi}\n$$</code></pre><pre><code>&gt; [!warning] A warning\n&gt; Something to look out for.</code></pre><pre><code>&#96;&#96;&#96;rust\nfn main() { … }\n&#96;&#96;&#96;</code></pre><pre><code>- [x] Write the outline\n- [ ] Send it round\n\n| Milestone | Owner |</code></pre><pre><code>&#96;&#96;&#96;mermaid\nflowchart LR\n  A[A note] --&gt; B{Saved}\n&#96;&#96;&#96;</code></pre><pre><code>&lt;!-- columns 1:1 --&gt;\n…\n&lt;!-- column --&gt;\n[[Formulas]]</code></pre><pre><code>md.henrischulz.com/k\nmd.henrischulz.com/k/raw</code></pre></div></div>
    </div>
  </div>
</section>

<section id='open' class='sc-section facts open' aria-labelledby='open-h'>
  <div class='sc-wrap facts__in' data-sc-in data-sc-stagger='60'>
    <h2 id='open-h' class='facts__h'>Open source, all of it.</h2>
    <p class='facts__p'>The desktop app, this web app and the server behind it are in one public repository under the MIT licence. Read it, build it, change it, run your own.</p>
    <dl class='facts__list'>
      <div><dt>Licence</dt><dd>MIT. Use it for anything.</dd></div>
      <div><dt>Made of</dt><dd>A Rust shell built with Tauri around one web page. The browser shows that same page.</dd></div>
      <div><dt>No lock-in</dt><dd>Your notes are files in your repository. Without the app they are still Markdown.</dd></div>
      <div><dt>Yours to host</dt><dd>The web app is an ordinary Next.js server. Run it yourself, with a GitHub App of your own.</dd></div>
    </dl>
    <p class='open__go'><a class='btn' href='${REPOSITORY}'>${GITHUB}<span>View the source on GitHub</span></a></p>
  </div>
</section>

<section id='try' data-sc-act='pin' data-sc-span='1.3' aria-label='Write a note yourself'>
  <div data-sc-stage class='stage try'>
    <div class='win try__win'>${frame("try", "The app, with a note to write in")}<div class='win__wait' role='status' aria-label='Loading'><span class='ring'></span></div></div>
    <div class='go'>
      <h2 class='go__h'>Try the editor.</h2>
      <p class='go__p'>This is the app, running in your browser. Type in it, then open your own notes.</p>
      ${why ? `<p class='go__why' role='status'>${attr(why)}</p>` : ""}
      <a class='btn btn--main' href='${here}/auth/login'>${GITHUB}<span>Sign in with GitHub</span></a>
      <a class='btn' href='${REPOSITORY}#install'>${DOWN}<span>Get the desktop app</span></a>
      <p class='go__small'>Free and open source. The desktop app is built from its source, for Linux. <a href='${REPOSITORY}'>github.com/henriSchulz/mdview</a></p>
    </div>
  </div>
</section>

</main>

<nav class='status' aria-label='This page'>
  <a class='status__mark' href='#top'><img src='/welcome/icon.svg' alt='' width='16' height='16'>Markdown Notes</a>
  <ol class='status__acts'>
    <li><a href='#write' data-act='write'>Write</a></li>
    <li><a href='#files' data-act='files'>Files</a></li>
    <li><a href='#blocks' data-act='blocks'>Blocks</a></li>
    <li><a href='#open' data-act='open'>Open source</a></li>
    <li><a href='#try' data-act='try'>Try</a></li>
  </ol>
  <span class='status__line' aria-hidden='true'></span>
  <a class='status__in' href='${here}/auth/login'>Sign in with GitHub</a>
</nav>

<script nonce='${nonce}'>window.MdWelcome=${inline({ opening: OPENING, text: WELCOME })};</script>
<script nonce='${nonce}' src='${w}/scrollcraft.js'></script>
<script nonce='${nonce}' src='${w}/welcome.js'></script>
</body></html>`;
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" } });
}
