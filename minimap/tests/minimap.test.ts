import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMinimap, lineForRow, miniature, rowForLine } from "../lib/minimap.ts";

test("map includes the first and final lines", () => {
  const source = Array.from({ length: 101 }, (_, index) => `line ${index}`).join("\n");
  const map = buildMinimap(source, 18);
  assert.equal(map.length, 18);
  assert.equal(map[0].line, 0);
  assert.equal(map.at(-1)?.line, 100);
  assert.equal(lineForRow(17, 18, 101), 100);
  assert.equal(rowForLine(100, 18, 101), 17);
});

test("short files keep one map row per source line", () => {
  const map = buildMinimap("one\n  two\nthree", 18);
  assert.deepEqual(map.map((row) => row.line), [0, 1, 2]);
  assert.equal(rowForLine(1, map.length, 3), 1);
});

test("source shape keeps indentation and fits the sidebar", () => {
  assert.equal(miniature("    abc(def)", 20).startsWith("  ━"), true);
  assert.equal(miniature("x".repeat(100), 20).length, 20);
  assert.equal(miniature("   "), " ");
});
