import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChangedFiles, parseCommits } from "./lib/review_git.ts";

test("commit parser keeps subjects with spaces", () => {
  const hash = "a".repeat(40);
  assert.deepEqual(parseCommits(`${hash}\0Fix two files\0`), [
    { hash, subject: "Fix two files" },
  ]);
});

test("file parser accepts spaces and tabs in names", () => {
  assert.deepEqual(parseChangedFiles("M\0src/one file.ts\0A\0a\tfile.txt\0"), [
    { status: "M", path: "src/one file.ts" },
    { status: "A", path: "a\tfile.txt" },
  ]);
});
