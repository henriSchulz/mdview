// The handwriting Claude writes with on a whiteboard (board/claude.js: the step "write"): two of the Hershey fonts — strokes,
// not outlines, as a pen draws them — taken from the package hersheytext (`node build-hershey.mjs`) into ../vendor/hershey.js.
// Each font: its letters from "!" to "~", each the SVG path of its strokes (a letter 21 units high, the line under it at 21)
// and how far the next one stands.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SPEC = "hersheytext@2.0.0", FONTS = { hand: "futural", script: "scripts" };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdview-hershey-"));
const tgz = execFileSync("npm", ["pack", SPEC, "--silent"], { cwd: tmp, encoding: "utf8" }).trim().split("\n").pop();
execFileSync("tar", ["-xzf", path.join(tmp, tgz), "-C", tmp]);
const all = JSON.parse(fs.readFileSync(path.join(tmp, "package", "hersheytext.json"), "utf8"));
const fonts = Object.fromEntries(Object.entries(FONTS).map(([mine, theirs]) => [mine, all[theirs].chars.map((c) => [c.d, Number(c.o)])]));
fs.writeFileSync(new URL("../vendor/hershey.js", import.meta.url),
  `/* The Hershey fonts (Dr. A. V. Hershey, 1967; public domain), as the package ${SPEC} (MIT, vendor/LICENSES.md) carries them:\n` +
  ` * ${Object.entries(FONTS).map(([m, t]) => `${m} = ${all[t].name}`).join(", ")}. Made by dev/build-hershey.mjs — not written by hand.\n` +
  ` * Each: the letters "!" to "~", [path, o] — the next letter stands o × 1.68 further on. */\n"use strict";\nwindow.MdHershey = ${JSON.stringify(fonts)};\n`);
fs.rmSync(tmp, { recursive: true, force: true });
