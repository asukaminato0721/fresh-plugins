export type Rgb = [number, number, number];

export interface HighlightSpan {
  start: number;
  end: number;
  color: Rgb;
}

export interface SourceLine {
  text: string;
  startByte: number;
}

export interface ColorRun {
  start: number;
  end: number;
  color: Rgb;
}

export interface EncodedRow {
  text: string;
  colors: ColorRun[];
}

export interface MinimapRow extends EncodedRow {
  line: number;
}

export interface MinimapLayout {
  rows: number;
  offset: number;
  viewTop: number;
  viewBottom: number;
}

export const LINES_PER_ROW = 4;
const BRAILLE_BASE = 0x2800;
const BRAILLE_CELL_BYTES = 3;
const DOT: readonly (readonly number[])[] = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];

/** Convert a Braille-cell index to its UTF-8 byte offset. */
export function brailleByteOffset(cell: number): number {
  return Math.max(0, Math.floor(cell)) * BRAILLE_CELL_BYTES;
}

/** Fresh uses UTF-8 byte offsets for syntax spans. */
export function byteLength(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x7f) count++;
    else if (code <= 0x7ff) count += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      count += 4;
      i++;
    } else count += 3;
  }
  return count;
}

export function sourceLines(text: string): SourceLine[] {
  const lines = text.split("\n");
  const result: SourceLine[] = [];
  let startByte = 0;
  for (const line of lines) {
    result.push({ text: line, startByte });
    startByte += byteLength(line) + 1;
  }
  return result;
}

function highlightAt(
  spans: readonly HighlightSpan[],
  byte: number,
): HighlightSpan | null {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (spans[mid].start <= byte) low = mid + 1;
    else high = mid;
  }
  const span = spans[low - 1];
  return span && byte < span.end ? span : null;
}

function colorKey(color: Rgb): string {
  return `${color[0]},${color[1]},${color[2]}`;
}

/** Encode four source lines as one row of Unicode Braille cells. */
export function encodeBraille(
  lines: readonly SourceLine[],
  cellCount: number,
  columnsPerDot = 3,
  tabSize = 4,
  highlights: readonly HighlightSpan[] = [],
): EncodedRow {
  const width = Math.max(1, Math.floor(cellCount));
  const perDot = Math.max(1, Math.floor(columnsPerDot));
  const cells = Array<number>(width).fill(0);
  const counts = Array.from(
    { length: width },
    () => new Map<string, { color: Rgb; count: number }>(),
  );
  const limit = width * 2 * perDot;

  for (let y = 0; y < Math.min(LINES_PER_ROW, lines.length); y++) {
    const line = lines[y];
    let column = 0;
    let localByte = 0;
    for (const char of line.text) {
      const size = byteLength(char);
      if (char === "\t") {
        column += tabSize - column % tabSize;
      } else {
        if (!/\s/u.test(char) && column < limit) {
          const dotColumn = Math.floor(column / perDot);
          const cell = Math.floor(dotColumn / 2);
          cells[cell] |= DOT[dotColumn % 2][y];
          const span = highlightAt(highlights, line.startByte + localByte);
          if (span) {
            const key = colorKey(span.color);
            const held = counts[cell].get(key);
            counts[cell].set(key, {
              color: span.color,
              count: (held?.count ?? 0) + 1,
            });
          }
        }
        column++;
      }
      localByte += size;
      if (column >= limit) break;
    }
  }

  const colors: ColorRun[] = [];
  for (let cell = 0; cell < width; cell++) {
    let best: { key: string; color: Rgb; count: number } | null = null;
    for (const [key, value] of counts[cell]) {
      if (
        !best || value.count > best.count ||
        (value.count === best.count && key < best.key)
      ) {
        best = { key, color: value.color, count: value.count };
      }
    }
    if (!best) continue;
    const previous = colors.at(-1);
    if (
      previous && previous.end === cell && colorKey(previous.color) === best.key
    ) previous.end++;
    else colors.push({ start: cell, end: cell + 1, color: best.color });
  }

  return {
    text: cells.map((bits) => String.fromCodePoint(BRAILLE_BASE + bits)).join(
      "",
    ),
    colors,
  };
}

/** Keep the source viewport visible while the minimap moves through a long file. */
export function layoutMinimap(
  height: number,
  lineCount: number,
  topLine: number,
  bottomLine: number,
): MinimapLayout {
  const panelHeight = Math.max(1, Math.floor(height));
  const lines = Math.max(1, Math.floor(lineCount));
  const top = Math.max(0, Math.min(Math.floor(topLine), lines - 1));
  const bottom = Math.max(top, Math.min(Math.floor(bottomLine), lines - 1));
  const rows = Math.ceil(lines / LINES_PER_ROW);
  const absoluteViewTop = Math.floor(top / LINES_PER_ROW);
  const absoluteViewBottom = Math.floor(bottom / LINES_PER_ROW);
  let offset = 0;

  if (rows > panelHeight) {
    const maxOffset = rows - panelHeight;
    const scrollable = lines - (bottom - top + 1);
    if (scrollable > 0) {
      const fraction = Math.max(0, Math.min(1, top / scrollable));
      offset = Math.floor(fraction * maxOffset + 0.5);
    }
    if (absoluteViewBottom >= offset + panelHeight) {
      offset = absoluteViewBottom - panelHeight + 1;
    }
    if (absoluteViewTop < offset) offset = absoluteViewTop;
    offset = Math.max(0, Math.min(offset, maxOffset));
  }

  return {
    rows,
    offset,
    viewTop: absoluteViewTop - offset,
    viewBottom: Math.min(absoluteViewBottom - offset, panelHeight - 1),
  };
}

export function visibleRows(
  lines: readonly SourceLine[],
  layout: MinimapLayout,
  height: number,
  width: number,
  columnsPerDot: number,
  highlights: readonly HighlightSpan[] = [],
): MinimapRow[] {
  const result: MinimapRow[] = [];
  const count = Math.min(
    Math.max(1, Math.floor(height)),
    layout.rows - layout.offset,
  );
  for (let row = 0; row < count; row++) {
    const line = (layout.offset + row) * LINES_PER_ROW;
    const encoded = encodeBraille(
      lines.slice(line, line + LINES_PER_ROW),
      width,
      columnsPerDot,
      4,
      highlights,
    );
    result.push({ line, ...encoded });
  }
  return result;
}

function linearChannel(value: number): number {
  const channel = Math.max(0, Math.min(255, value)) / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const luminance = (color: Rgb) =>
    0.2126 * linearChannel(color[0]) + 0.7152 * linearChannel(color[1]) +
    0.0722 * linearChannel(color[2]);
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Raise low contrast without changing a readable syntax color. */
export function ensureContrast(
  foreground: Rgb,
  background: Rgb,
  minimum = 3,
): Rgb {
  if (contrastRatio(foreground, background) >= minimum) return foreground;
  const black: Rgb = [0, 0, 0];
  const white: Rgb = [255, 255, 255];
  const target =
    contrastRatio(black, background) > contrastRatio(white, background)
      ? black
      : white;
  for (let step = 1; step <= 20; step++) {
    const amount = step / 20;
    const candidate: Rgb = foreground.map((value, index) =>
      Math.round(value + (target[index] - value) * amount)
    ) as Rgb;
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return target;
}
