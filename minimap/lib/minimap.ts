/** Small, fixed-height overview of a source buffer. */
export interface MinimapRow {
  line: number;
  text: string;
}

/** Map a map row to a source line. The last row always reaches the last line. */
export function lineForRow(row: number, rows: number, lineCount: number): number {
  if (rows <= 1 || lineCount <= 1) return 0;
  return Math.round(Math.max(0, Math.min(row, rows - 1)) * (lineCount - 1) / (rows - 1));
}

/** Map a source line to the nearest map row. */
export function rowForLine(line: number, rows: number, lineCount: number): number {
  if (rows <= 1 || lineCount <= 1) return 0;
  return Math.round(Math.max(0, Math.min(line, lineCount - 1)) * (rows - 1) / (lineCount - 1));
}

/** Render the shape of one source line with fixed-width blocks. */
export function miniature(line: string, width = 20): string {
  const columns = Math.max(1, width);
  const expanded = line.replace(/\t/g, "    ");
  const indent = Math.min(Math.floor((expanded.match(/^ */)?.[0].length ?? 0) / 2), columns - 1);
  const content = expanded.trimStart();
  let result = " ".repeat(indent);
  for (const char of content) {
    if (result.length >= columns) break;
    if (/\s/.test(char)) result += " ";
    else if (/[.,:;|(){}[\]]/.test(char)) result += "·";
    else result += "━";
  }
  return result.trimEnd() || " ";
}

/** Include the whole document while keeping a fixed number of map rows. */
export function buildMinimap(text: string, rows: number, width = 20): MinimapRow[] {
  const lines = text.split("\n");
  const count = Math.max(1, Math.min(rows, lines.length));
  const result: MinimapRow[] = [];
  for (let row = 0; row < count; row++) {
    const start = lineForRow(row, count, lines.length);
    const end = row + 1 < count ? lineForRow(row + 1, count, lines.length) : lines.length;
    let chosen = start;
    // The densest line shows code when a sampled interval starts with whitespace.
    for (let line = start + 1; line < end; line++) {
      if (lines[line].trim().length > lines[chosen].trim().length) chosen = line;
    }
    result.push({ line: start, text: miniature(lines[chosen], width) });
  }
  return result;
}
