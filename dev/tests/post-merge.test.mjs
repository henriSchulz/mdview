// After a merge into the installed checkout (bin/mdview-post-merge): the program built anew when
// src-tauri/ changed, a restart asked for when only the page did, nothing otherwise — and nothing
// at all for a merge in another worktree.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hook = join(dirname(fileURLToPath(import.meta.url)), "../../bin/mdview-post-merge");

// a checkout with the hook in its bin/, the hook linked as Git's, and a branch that changes `file`
function checkout(file) {
  const dir = mkdtempSync(join(tmpdir(), "mdview-hook-"));
  const repo = join(dir, "repo");
  const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  mkdirSync(join(repo, "bin"), { recursive: true });
  mkdirSync(join(repo, "src-tauri"), { recursive: true });
  copyFileSync(hook, join(repo, "bin/mdview-post-merge"));
  chmodSync(join(repo, "bin/mdview-post-merge"), 0o755);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "README.md"), "x\n");
  git("add", ".");
  git("commit", "-qm", "start");
  execFileSync("ln", ["-s", join(repo, "bin/mdview-post-merge"), join(repo, ".git/hooks/post-merge")]);
  git("checkout", "-qb", "work");
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), "changed\n");
  git("add", ".");
  git("commit", "-qm", "change");
  git("checkout", "-q", "main");
  return { dir, repo, git };
}

function script(dir, name, line) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${line}\n`);
  chmodSync(path, 0o755);
  return path;
}

// the merge, with the build and the notification written down instead of done
function merge({ dir, repo }, where = repo, built = false) {
  const said = join(dir, "said");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    XDG_CACHE_HOME: join(dir, "cache"),
    MDVIEW_HOOK_BUILD: script(dir, "build", `echo built >> ${said}`),
    MDVIEW_HOOK_NOTIFY: script(dir, "notify", `echo "$1" >> ${said}`),
  };
  execFileSync("git", ["merge", "-q", "--no-ff", "-m", "merge", "work"], { cwd: where, env });
  // the build goes on in the background: wait until it said how it went
  const until = Date.now() + 2000;
  while (built && Date.now() < until && !(existsSync(said) && readFileSync(said, "utf8").includes("updated"))) execFileSync("sleep", ["0.05"]);
  return existsSync(said) ? readFileSync(said, "utf8").trim().split("\n") : [];
}

test("the program changed: it is built, then a restart is asked for", () => {
  assert.deepEqual(merge(checkout("src-tauri/src/main.rs"), undefined, true), ["built", "Markdown Notes updated"]);
});

test("only the page changed: a restart is asked for, nothing is built", () => {
  assert.deepEqual(merge(checkout("viewer/render.js")), ["Markdown Notes updated"]);
  assert.deepEqual(merge(checkout("motion.css")), ["Markdown Notes updated"]);
});

test("neither changed: nothing happens", () => {
  assert.deepEqual(merge(checkout("docs/FEATURES.md")), []);
});

test("a merge in another worktree is not the installed app's", () => {
  const c = checkout("src-tauri/src/main.rs");
  const other = join(c.dir, "other");
  c.git("worktree", "add", "-q", other, "-b", "elsewhere");
  assert.deepEqual(merge(c, other, true), []); // (given the time a build would take)
});
