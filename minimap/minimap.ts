import { buildMinimap, byteLength, rowForLine, type MinimapRow } from "./lib/minimap.ts";

const editor = getEditor();
const MAX_BYTES = 1024 * 1024;
const PANEL_NAME = "minimap";

let shown = false;
let opening = false;
let sourceBuffer: number | null = null;
let sourceSplit: number | null = null;
let panelBuffer: number | null = null;
let panelSplit: number | null = null;
let rows: MinimapRow[] = [];
let highlights: TsHighlightSpan[] = [];
let totalLines = 0;
let topLine = 0;
let viewportHeight = 1;
let generation = 0;
let rescanTimer: number | null = null;

function panelWidth(): number {
  const pane = editor.describeWorkspace().panes.find((p) => p.splitId === panelSplit);
  return Math.max(6, Math.min(30, (pane?.width ?? 16) - 2));
}

function highlightAt(byte: number): TsHighlightSpan | null {
  let low = 0;
  let high = highlights.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (highlights[mid].start <= byte) low = mid + 1;
    else high = mid;
  }
  const span = highlights[low - 1];
  return span && byte < span.end ? span : null;
}

/** Keep the color of sampled syntax tokens in the compressed display. */
function colorOffsets(row: MinimapRow, width: number): Array<number | null> {
  const offsets: Array<number | null> = Array(width).fill(null);
  let byte = row.sampleStartByte;
  let column = 0;
  for (const char of row.sampleText) {
    if (column >= width * 2) break;
    if (char === "\t") {
      column += 4 - column % 4;
    } else {
      if (!/\s/u.test(char) && offsets[Math.floor(column / 2)] === null) {
        offsets[Math.floor(column / 2)] = byte;
      }
      column++;
    }
    byte += byteLength(char);
  }
  return offsets;
}

function render(): void {
  if (!shown || panelBuffer === null) return;
  const width = panelWidth();
  const first = rowForLine(topLine, rows.length, totalLines);
  const last = rowForLine(topLine + viewportHeight - 1, rows.length, totalLines);
  const entries: TextPropertyEntry[] = rows.map((row, index) => {
    const text = `${index >= first && index <= last ? "┃" : " "}${row.text.padEnd(width)}\n`;
    const offsets = colorOffsets(row, width);
    const inlineOverlays: InlineOverlay[] = [];
    for (let col = 0; col < row.text.length; col++) {
      const byte = offsets[col];
      const span = byte === null ? null : highlightAt(byte);
      if (span) inlineOverlays.push({
        start: col + 1,
        end: col + 2,
        unit: "char",
        style: { fg: span.color },
      });
    }
    return {
      text,
      properties: { sourceLine: row.line },
      style: index >= first && index <= last ? { bg: "editor.selection_bg" } : undefined,
      inlineOverlays,
    };
  });
  editor.setVirtualBufferContent(panelBuffer, entries as unknown as Record<string, unknown>[]);
}

function closePanel(): void {
  generation++;
  if (rescanTimer !== null) editor.clearInterval(rescanTimer);
  rescanTimer = null;
  const split = panelSplit;
  const buffer = panelBuffer;
  panelSplit = null;
  panelBuffer = null;
  sourceBuffer = null;
  sourceSplit = null;
  rows = [];
  highlights = [];
  if (split !== null) editor.closeSplit(split);
  if (buffer !== null) editor.closeBuffer(buffer, true);
}

async function rescan(id: number): Promise<void> {
  const scan = ++generation;
  const info = editor.getBufferInfo(id);
  if (!info || info.is_virtual || panelBuffer === null) return;
  if (info.length > MAX_BYTES) {
    rows = [{ line: 0, sampleLine: 0, sampleStartByte: 0,
      sampleText: "", text: "File exceeds 1 MiB" }];
    highlights = [];
    totalLines = 1;
    render();
    return;
  }
  try {
    const text = await editor.getBufferText(id);
    const spans = await editor.getHighlights(id, 0, info.length).catch(() => []);
    if (scan !== generation || !shown || sourceBuffer !== id || panelBuffer === null) return;
    highlights = spans.sort((a, b) => a.start - b.start);
    totalLines = text.split("\n").length;
    rows = buildMinimap(text, Math.max(1, Math.min(viewportHeight, 200)), panelWidth());
    render();
  } catch (error) {
    editor.debug(`Minimap scan failed: ${error}`);
  }
}

async function openPanel(id: number): Promise<void> {
  if (!shown || opening || panelBuffer !== null) return;
  const info = editor.getBufferInfo(id);
  if (!info || info.is_virtual) return;
  opening = true;
  const split = editor.getActiveSplitId();
  sourceBuffer = id;
  sourceSplit = split;
  const viewport = editor.getViewport();
  topLine = viewport?.topLine ?? 0;
  viewportHeight = viewport?.height ?? 1;
  try {
    const screen = editor.getScreenSize();
    const ratio = Math.max(0.75, Math.min(0.9, 1 - 16 / screen.width));
    const created = await editor.createVirtualBufferInSplit({
      name: "*Minimap*",
      panelId: PANEL_NAME,
      direction: "vertical",
      ratio,
      readOnly: true,
      editingDisabled: true,
      showLineNumbers: false,
      showCursors: false,
      scrollable: false,
      lineWrap: false,
      entries: [{ text: "Loading minimap…\n" }],
    });
    if (!shown) {
      if (created.splitId !== null) editor.closeSplit(created.splitId);
      editor.closeBuffer(created.bufferId, true);
      return;
    }
    panelBuffer = created.bufferId;
    panelSplit = created.splitId;
    editor.focusSplit(split);
    void rescan(id);
  } catch (error) {
    shown = false;
    sourceBuffer = null;
    sourceSplit = null;
    editor.debug(`Minimap could not open: ${error}`);
  } finally {
    opening = false;
  }
}

function activate(id: number): void {
  if (!shown) return;
  const info = editor.getBufferInfo(id);
  if (!info || info.is_virtual) return;
  sourceBuffer = id;
  sourceSplit = editor.getActiveSplitId();
  const viewport = editor.getViewport();
  topLine = viewport?.topLine ?? 0;
  viewportHeight = viewport?.height ?? 1;
  if (panelBuffer === null) void openPanel(id);
  else void rescan(id);
}

registerHandler("minimapRescan", () => {
  rescanTimer = null;
  if (sourceBuffer !== null) void rescan(sourceBuffer);
});

registerHandler("minimapToggle", () => {
  shown = !shown;
  if (shown) activate(editor.getActiveBufferId());
  else closePanel();
});
editor.registerCommand("Minimap: Toggle", "Show or hide the code minimap", "minimapToggle", null);

editor.on("buffer_activated", (data) => activate(data.buffer_id));
editor.on("buffer_closed", (data) => {
  if (data.buffer_id === sourceBuffer || data.buffer_id === panelBuffer) {
    shown = false;
    closePanel();
  }
});
editor.on("buffer_modified", (data) => {
  if (!shown || data.buffer_id !== sourceBuffer) return;
  if (rescanTimer !== null) editor.clearInterval(rescanTimer);
  rescanTimer = editor.setTimeout(250, "minimapRescan");
});
editor.on("viewport_changed", (data) => {
  if (!shown || data.buffer_id !== sourceBuffer) return;
  const changedSize = viewportHeight !== data.height;
  topLine = data.top_line ?? topLine;
  viewportHeight = data.height;
  if (changedSize) void rescan(data.buffer_id);
  else render();
});
editor.on("cursor_moved", (data) => {
  if (!shown || data.buffer_id !== panelBuffer || sourceBuffer === null) return;
  const row = rows[data.line];
  if (!row || (totalLines === 1 && row.text === "File exceeds 1 MiB")) return;
  const splits = editor.getBufferInfo(sourceBuffer)?.splits ?? [];
  const split = sourceSplit !== null && splits.includes(sourceSplit) ? sourceSplit : splits[0];
  if (split !== undefined) editor.scrollToLineCenter(split, sourceBuffer, row.line);
});
