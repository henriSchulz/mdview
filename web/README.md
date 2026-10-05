# Markdown Notes in the browser

The notes of a repository on GitHub, read through the same page as the desktop app. A Next.js
app; it keeps no notes of its own. The plan, and how far it is: `../docs/Git-Phase-3.md`.

So far: signing in with GitHub, choosing a repository, reading its notes and writing them —
the desktop app's page, with a host in the browser in the Rust shell's place. What is written
is a draft in the browser at once and a commit a little later; what another device wrote
meanwhile is joined in, or asked about. A note's history, and pictures pasted in.

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

`npm run dev` and `npm run build` first copy the page's own files (`viewer.js`, `active/`,
`vendor/`, the stylesheets) from the checkout into `public/app/`; they are not kept twice.

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
| `app/api/r/`, `app/file/` | a repository's state, its notes' texts, its files (sandboxed) |
| `public/host/core.js` | what the host works out: the tree, titles, where links lead, tabs |
| `public/host/host.js` | the host: answers the page from the repository |
| `host/contract.ts` | everything the page and its host say to each other, and what the web host does with each |
| `apphosting.yaml` | how it runs on Firebase App Hosting |
