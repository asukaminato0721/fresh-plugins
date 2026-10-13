import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fileRevisions,
  parseChangedFiles,
  parseCommits,
} from "../lib/review_git.ts";

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

test("file revisions use the first parent and selected commit", () => {
  const hash = "a".repeat(40);
  assert.deepEqual(fileRevisions(hash, { status: "M", path: "src/file.ts" }), {
    oldRevision: `${hash}^:src/file.ts`,
    newRevision: `${hash}:src/file.ts`,
  });
  assert.equal(
    fileRevisions(hash, { status: "A", path: "new.ts" }).oldRevision,
    null,
  );
  assert.equal(
    fileRevisions(hash, { status: "D", path: "old.ts" }).newRevision,
    null,
  );
});
