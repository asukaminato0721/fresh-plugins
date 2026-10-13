/** One screen row summarizes a contiguous range of source lines. */
export interface MinimapRow {
  line: number;
  sampleLine: number;
  sampleStartByte: number;
  sampleText: string;
  text: string;
}

/** Fresh uses UTF-8 byte offsets for syntax spans. */
export function byteLength(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x7f) count++;
    else if (code <= 0x7ff) count += 2;
    else if (code >= 0xd800 && code <= 0xdfff) {
      count += 4;
      i++;
    } else count += 3;
  }
  return count;
}

/** Map a map row to a source line. The last row reaches the last line. */
export function lineForRow(row: number, rows: number, lineCount: number): number {
  if (rows <= 1 || lineCount <= 1) return 0;
  return Math.round(Math.max(0, Math.min(row, rows - 1)) * (lineCount - 1) / (rows - 1));
}

/** Map a source line to the nearest map row. */
export function rowForLine(line: number, rows: number, lineCount: number): number {
  if (rows <= 1 || lineCount <= 1) return 0;
  return Math.round(Math.max(0, Math.min(line, lineCount - 1)) * (rows - 1) / (lineCount - 1));
}

/** Convert one source line to the columns occupied by its visible text. */
function occupiedColumns(line: string, width: number): Set<number> {
  const columns = new Set<number>();
  let position = 0;
  for (const char of line) {
    if (position >= width * 2) break;
    if (char === "\t") {
      position += 4 - position % 4;
    } else {
      if (!/\s/u.test(char)) columns.add(Math.floor(position / 2));
      position++;
    }
  }
  return columns;
}

/** One line's compact shape, kept for callers that need a single-line map. */
export function miniature(line: string, width = 20): string {
  const columns = occupiedColumns(line, Math.max(1, width));
  const last = Math.max(-1, ...columns);
  return last < 0 ? " " : Array.from({ length: last + 1 }, (_, col) =>
    columns.has(col) ? "█" : " "
  ).join("");
}

/** Aggregate every line in each range. Density remains visible after downsampling. */
export function buildMinimap(text: string, rows: number, width = 20): MinimapRow[] {
  const lines = text.split("\n");
  const count = Math.max(1, Math.min(Math.floor(rows), lines.length));
  const columns = Math.max(1, Math.floor(width));
  const starts: number[] = [];
  let byte = 0;
  for (const line of lines) {
    starts.push(byte);
    byte += byteLength(line) + 1;
  }
  const result: MinimapRow[] = [];
  for (let row = 0; row < count; row++) {
    const start = lineForRow(row, count, lines.length);
    const end = row + 1 < count ? lineForRow(row + 1, count, lines.length) : lines.length;
    const hits = Array<number>(columns).fill(0);
    let sampleLine = start;
    let sampleLength = -1;
    for (let line = start; line < end; line++) {
      const occupied = occupiedColumns(lines[line], columns);
      if (occupied.size > sampleLength) {
        sampleLine = line;
        sampleLength = occupied.size;
      }
      for (const col of occupied) hits[col]++;
    }
    const lineCount = Math.max(1, end - start);
    let last = -1;
    for (let col = 0; col < hits.length; col++) {
      if (hits[col] > 0) last = col;
    }
    const rendered = last < 0 ? " " : hits.slice(0, last + 1).map((hit) => {
      if (!hit) return " ";
      const density = hit / lineCount;
      return density < 0.2 ? "░" : density < 0.45 ? "▒" : density < 0.75 ? "▓" : "█";
    }).join("");
    result.push({
      line: start,
      sampleLine,
      sampleStartByte: starts[sampleLine],
      sampleText: lines[sampleLine],
      text: rendered,
    });
  }
  return result;
}
