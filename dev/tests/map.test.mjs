// docs/MAP.md lists the files as they are: a file added, taken away or described anew is in it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROOT } from "./harness.mjs";
import { fresh } from "../map.mjs";

test("the map's list of files is up to date (node dev/map.mjs writes it)", () => {
  const doc = readFileSync(ROOT + "/docs/MAP.md", "utf8");
  assert.ok(fresh(doc) === doc, "docs/MAP.md is not up to date: run node dev/map.mjs");
});
