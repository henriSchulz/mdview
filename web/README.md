# Markdown Notes in the browser

The notes of a repository on GitHub, read through the same page as the desktop app. A Next.js
app; it keeps no notes of its own. The plan, and how far it is: `../docs/Git-Phase-3.md`.

So far: signing in with GitHub, choosing a repository, reading its notes and writing them —
the desktop app's page, with a host in the browser in the Rust shell's place. What is written
is a draft in the browser at once and a commit a little later; what another device wrote
meanwhile is joined in, or asked about. A note's history, and pictures pasted in or dropped on a note.
Working with files as the desktop app's list does: whiteboards as files, hiding, copies, files
from elsewhere — a file the repository has goes into a commit by its blob, never by its bytes.

## Running it

```
npm install
npm run dev        # http://localhost:3000
```

It needs two values, in `web/.env.local` (never committed):

```
GITHUB_CLIENT_SECRET=…   # the GitHub App's client secret
SESSION_SECRET=…         # 32 characters or more, anything random
```

and the GitHub App must name `http://localhost:3000/auth/callback` among its callback URLs.

A third is needed only for sharing notes under a link (`../docs/Teilen.md`); without it nothing
is shared from the server, and everything else works:

```
GITHUB_APP_PRIVATE_KEY=…   # the GitHub App's private key (the .pem's text; line ends may be written \n)
```

`npm run dev` and `npm run build` first copy the page's own files (`viewer.js`, `viewer/`,
`active/`, `vendor/`, the other stylesheets) from the checkout into `public/app/`; they are not kept twice.

## The notes in Claude (MCP)

`/mcp` is a server of the Model Context Protocol (Streamable HTTP, JSON answers, no sessions),
with its own OAuth sign-in in front of GitHub's (`lib/mcp/`, `app/oauth/`, `app/.well-known/`).
Tried locally, with `npm run dev` running as above:

```
claude mcp add --transport http mdview http://localhost:3000/mcp
```

then `/mcp` in Claude Code signs in: the browser shows the app's page (Allow), then GitHub. In
Claude (claude.ai) the deployed address is added as a custom connector, `…/mcp`. The sign-in
comes back through `/auth/callback`, so no further callback URL is needed on the GitHub App.
What it does: `../docs/FEATURES.md`, "The notes in Claude (MCP)"; its test: `test/mcp.test.mjs`.

## Tests

```
npm run build && npm test
```

The built app is started against a GitHub of the test's own (`test/fake-github.mjs`): a
browser's part is played through signing in, and a real Chromium (`CHROMIUM=/path`, or one on
PATH) opens a repository and reads it.

## Where things are

| | |
|---|---|
| `proxy.ts` | nothing of the app without a session |
| `app/auth/` | to GitHub and back, renewing, signing out |
| `lib/github.ts` | what is asked of GitHub (server only) |
| `lib/session.ts` | the session: tokens and user, sealed in a cookie scripts cannot read |
| `app/page.tsx`, `app/repos.tsx` | the repositories, with a field to search them |
| `app/r/[owner]/[repo]/route.ts` | the document the desktop app's page runs in |
| `app/api/r/`, `app/file/` | a repository's state, its notes' texts, when they were changed, commits and versions; its files (sandboxed) |
| `public/host/core.js` | what the host works out: the tree, titles, where links lead, tabs |
| `public/host/host.js` | the host: answers the page from the repository |
| `host/contract.ts` | everything the page and its host say to each other, and what the web host does with each (held to it by `test/contract.test.mjs`) |
| `lib/app.ts`, `lib/share.ts` | the app as itself: a token that reads one repository; a shared note, its files, its password |
| `app/s/[owner]/[repo]/[id]/` | a shared note, for whoever has its link: the page, its data, its files |
| `public/host/share.js` | the host of a shared note: one note, to be read |
| `lib/store.ts`, `lib/firestore.ts` | what the server keeps about shared notes (which link belongs where, how often it is opened): Firestore on Firebase, a Map in memory elsewhere |
| `app/shares/` | Shared Notes: what is shared in the user's repositories |
| `firestore.rules`, `firebase.json` | the database is the server's alone: `npx firebase-tools deploy --only firestore:rules` |
| `apphosting.yaml` | how it runs on Firebase App Hosting |
