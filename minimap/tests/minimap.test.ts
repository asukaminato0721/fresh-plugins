import assert from "node:assert/strict";
import { test } from "node:test";
import {
  brailleByteOffset,
  contrastRatio,
  encodeBraille,
  ensureContrast,
  layoutMinimap,
  sourceLines,
  visibleRows,
} from "../lib/minimap.ts";

const braille = (bits: number) => String.fromCodePoint(0x2800 + bits);
const lines = (...text: string[]) => sourceLines(text.join("\n"));

test("Braille cell offsets use UTF-8 bytes", () => {
  assert.equal(brailleByteOffset(0), 0);
  assert.equal(brailleByteOffset(1), 3);
  assert.equal(brailleByteOffset(7), 21);
});

test("Braille dots follow four source lines", () => {
  assert.equal(encodeBraille(lines("ab"), 1, 1).text, braille(0x01 + 0x08));
  assert.equal(
    encodeBraille(lines("a", "a", "a", "a"), 1, 1).text,
    braille(0x01 + 0x02 + 0x04 + 0x40),
  );
  assert.equal(encodeBraille(lines(" b"), 1, 1).text, braille(0x08));
  assert.equal(
    encodeBraille(lines("abcd"), 2, 1).text,
    braille(0x09) + braille(0x09),
  );
  assert.equal(encodeBraille(lines("abcd"), 1, 2).text, braille(0x09));
});

test("tabs and Unicode use display columns", () => {
  assert.equal(
    encodeBraille(lines("\tx"), 3, 2, 4).text,
    braille(0) + braille(0x01) + braille(0),
  );
  assert.equal(encodeBraille(lines("éé"), 1, 1).text, braille(0x09));
  assert.equal(encodeBraille([], 2, 1).text, braille(0) + braille(0));
});

test("each cell uses its most common syntax color", () => {
  const red: [number, number, number] = [255, 0, 0];
  const blue: [number, number, number] = [0, 0, 255];
  const source = lines("abc");
  const encoded = encodeBraille(source, 2, 1, 4, [
    { start: 0, end: 2, color: red },
    { start: 2, end: 3, color: blue },
  ]);
  assert.deepEqual(encoded.colors, [
    { start: 0, end: 1, color: red },
    { start: 1, end: 2, color: blue },
  ]);
});

test("the minimap scrolls through long files", () => {
  assert.deepEqual(layoutMinimap(30, 100, 0, 29), {
    rows: 25,
    offset: 0,
    viewTop: 0,
    viewBottom: 7,
  });
  assert.equal(layoutMinimap(30, 4000, 0, 29).offset, 0);
  const end = layoutMinimap(30, 4000, 3970, 3999);
  assert.equal(end.offset, 970);
  assert.equal(end.viewBottom, 29);
  for (let top = 0; top <= 3970; top += 97) {
    const layout = layoutMinimap(30, 4000, top, top + 29);
    assert.ok(layout.viewTop >= 0 && layout.viewBottom <= 29);
  }
});

test("visible rows keep the nvim four-line mapping", () => {
  const source = lines(
    ...Array.from({ length: 400 }, (_, index) => `line ${index}`),
  );
  const layout = layoutMinimap(10, source.length, 200, 209);
  const rows = visibleRows(source, layout, 10, 14, 3);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].line, layout.offset * 4);
  assert.equal(rows[1].line, rows[0].line + 4);
  assert.equal([...rows[0].text].length, 14);
});

test("low contrast colors are corrected for light and dark backgrounds", () => {
  const dark: [number, number, number] = [30, 30, 30];
  const light: [number, number, number] = [250, 250, 250];
  assert.ok(contrastRatio(ensureContrast([40, 40, 40], dark), dark) >= 3);
  assert.ok(contrastRatio(ensureContrast([240, 240, 240], light), light) >= 3);
  assert.deepEqual(ensureContrast([230, 80, 80], dark), [230, 80, 80]);
});
