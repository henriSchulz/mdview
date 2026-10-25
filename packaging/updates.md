# The app's updates — the key, once

An AppImage and the Windows installer update themselves (`src-tauri/src/update.rs`): the app reads
`latest.json` of the newest release, downloads the new file, and installs it only if its signature
holds against the public key built into the app (`plugins.updater.pubkey` in
`src-tauri/tauri.conf.json`). A `.deb` or an `.rpm` only says that a newer version is on the
download page. A program that runs out of a checkout (`bin/mdview`, `bin/mdview-install`) never
looks for one.

The release workflow (`.github/workflows/build.yml`) signs the AppImages and the Windows installer
with the private key from the repository's secrets, uploads `<file>.sig` beside each, and writes
`latest.json` (`packaging/latest-json.mjs`). It stops at its first step while the public key in
`tauri.conf.json` is still the placeholder.

## Once: the key

1. Make the key pair (it asks for a password — give one; an empty password cannot be stored as a
   secret):

   ```sh
   npx --yes @tauri-apps/cli@2 signer generate -w ~/.tauri/mdview-updater.key
   ```

   This writes `~/.tauri/mdview-updater.key` (private) and `~/.tauri/mdview-updater.key.pub` (public).

2. Hand the private key and its password to GitHub (run in the checkout; the second one prompts):

   ```sh
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/mdview-updater.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
   ```

3. Put the public key into the app: the whole content of `~/.tauri/mdview-updater.key.pub` (one
   line of base64) replaces the placeholder at `plugins.updater.pubkey` in
   `src-tauri/tauri.conf.json`. Commit it — it is public.

4. **Back the private key up** (`~/.tauri/mdview-updater.key` and its password), somewhere apart
   from this computer — a password manager. Lost, no release can be signed for the apps already
   installed: they would never update again, and everyone would have to download anew by hand.

## Seeing it work

Updates reach only an install that already has them: the first release built with the key
(say v0.1.5) is downloaded by hand once; from the release after it (v0.1.6) on, that install
offers the update by itself — a few seconds after the start, or at Settings › About › Check Now.

To try it: install the AppImage of v0.1.5 (or the Windows installer) from the release, bump the
version in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, tag and push v0.1.6, wait for
the workflow (its last job, "latest.json"), then start the v0.1.5 app: "Markdown Notes 0.1.6 is
available — Restart to Update". `https://github.com/henriSchulz/mdview/releases/latest/download/latest.json`
shows what the apps are told.
