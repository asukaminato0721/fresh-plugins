import {
  ensureContrast,
  type HighlightSpan,
  layoutMinimap,
  type MinimapLayout,
  type MinimapRow,
  type Rgb,
  type SourceLine,
  sourceLines,
  visibleRows,
} from "./lib/minimap.ts";

const editor = getEditor();
const PANEL_NAME = "minimap";
const COLUMNS_PER_DOT = 3;
const BRAILLE_BLANK = "\u2800";
const FALLBACK_BG: Rgb = [30, 30, 30];
const FALLBACK_FG: Rgb = [210, 210, 210];
const FALLBACK_VIEW_BG: Rgb = [65, 65, 70];

let shown = false;
let opening = false;
let sourceBuffer: number | null = null;
let sourceSplit: number | null = null;
let panelBuffer: number | null = null;
let panelSplit: number | null = null;
let lines: SourceLine[] = [];
let rows: MinimapRow[] = [];
let highlights: HighlightSpan[] = [];
let topLine = 0;
let viewportHeight = 1;
let cursorLine = 0;
let layout: MinimapLayout = { rows: 1, offset: 0, viewTop: 0, viewBottom: 0 };
let generation = 0;
let rescanTimer: number | null = null;

function panelWidth(): number {
  const pane = editor.describeWorkspace().panes.find((item) =>
    item.splitId === panelSplit
  );
  return Math.max(6, Math.min(24, (pane?.width ?? 16) - 2));
}

function rgb(value: unknown, fallback: Rgb): Rgb {
  if (
    Array.isArray(value) && value.length === 3 &&
    value.every((part) => typeof part === "number")
  ) {
    return value.map((part) =>
      Math.max(0, Math.min(255, Math.round(part)))
    ) as Rgb;
  }
  return fallback;
}

function mixColor(foreground: Rgb, background: Rgb, amount: number): Rgb {
  return foreground.map((value, index) =>
    Math.round(background[index] + (value - background[index]) * amount)
  ) as Rgb;
}

function themeColors(): { bg: Rgb; plainFg: Rgb; viewBg: Rgb } {
  const name = editor.getConfig().theme;
  const data = name ? editor.getThemeData(name) : null;
  const theme = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  const section = theme.editor && typeof theme.editor === "object"
    ? theme.editor as Record<string, unknown>
    : {};
  const bg = rgb(section.bg, FALLBACK_BG);
  const fg = rgb(section.fg, FALLBACK_FG);
  return {
    bg,
    plainFg: rgb(section.line_number_fg, mixColor(fg, bg, 0.45)),
    viewBg: rgb(section.selection_bg, FALLBACK_VIEW_BG),
  };
}

function render(): void {
  if (!shown || panelBuffer === null || lines.length === 0) return;
  const width = panelWidth();
  layout = layoutMinimap(
    viewportHeight,
    lines.length,
    topLine,
    topLine + viewportHeight - 1,
  );
  rows = visibleRows(
    lines,
    layout,
    viewportHeight,
    width,
    COLUMNS_PER_DOT,
    highlights,
  );
  const theme = themeColors();
  const entries: TextPropertyEntry[] = rows.map((row, index) => {
    const inViewport = index >= layout.viewTop && index <= layout.viewBottom;
    const isCursor = Math.floor(cursorLine / 4) - layout.offset === index;
    const background = inViewport ? theme.viewBg : theme.bg;
    const inlineOverlays: InlineOverlay[] = row.colors.map((run) => ({
      start: run.start,
      end: run.end,
      unit: "char",
      style: { fg: ensureContrast(run.color, background) },
    }));
    if (isCursor) {
      const cells = [...row.text];
      let contentEnd = cells.length;
      while (contentEnd > 0 && cells[contentEnd - 1] === BRAILLE_BLANK) {
        contentEnd--;
      }
      if (contentEnd > 0) {
        inlineOverlays.push({
          start: 0,
          end: contentEnd,
          unit: "char",
          style: { underline: true },
        });
      }
    }
    return {
      text: `${row.text}\n`,
      properties: { sourceLine: row.line },
      style: {
        fg: ensureContrast(theme.plainFg, background, 2),
        bg: background,
      },
      inlineOverlays,
    };
  });
  editor.setVirtualBufferContent(
    panelBuffer,
    entries as unknown as Record<string, unknown>[],
  );
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
  lines = [];
  rows = [];
  highlights = [];
  if (split !== null) editor.closeSplit(split);
  if (buffer !== null) editor.closeBuffer(buffer, true);
}

function scrollSourceToMapRow(mapRow: number): void {
  if (sourceBuffer === null) return;
  const row = rows[mapRow];
  if (!row) return;
  const splits = editor.getBufferInfo(sourceBuffer)?.splits ?? [];
  const split = sourceSplit !== null && splits.includes(sourceSplit)
    ? sourceSplit
    : splits[0];
  if (split !== undefined) {
    editor.scrollToLineCenter(split, sourceBuffer, row.line);
  }
}

async function rescan(id: number): Promise<void> {
  const scan = ++generation;
  const info = editor.getBufferInfo(id);
  if (!info || info.is_virtual || panelBuffer === null) return;
  try {
    const [text, spans] = await Promise.all([
      editor.getBufferText(id),
      editor.getHighlights(id, 0, info.length).catch(() => []),
    ]);
    if (
      scan !== generation || !shown || sourceBuffer !== id ||
      panelBuffer === null
    ) return;
    lines = sourceLines(text);
    highlights = spans.sort((a, b) => a.start - b.start);
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
  cursorLine = editor.getPrimaryCursor()?.line ?? 0;
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
  cursorLine = editor.getPrimaryCursor()?.line ?? 0;
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
editor.registerCommand(
  "Minimap: Toggle",
  "Show or hide the code minimap",
  "minimapToggle",
  null,
);

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
  topLine = data.top_line ?? topLine;
  viewportHeight = data.height;
  render();
});
editor.on("cursor_moved", (data) => {
  if (!shown) return;
  if (data.buffer_id === sourceBuffer) {
    cursorLine = data.line;
    render();
    return;
  }
  if (data.buffer_id === panelBuffer) scrollSourceToMapRow(data.line);
});
editor.on("mouse_click", (data) => {
  if (!shown || data.buffer_id !== panelBuffer || data.buffer_row === null) {
    return;
  }
  scrollSourceToMapRow(data.buffer_row);
});
editor.on("config_changed", () => {
  if (shown && sourceBuffer !== null) void rescan(sourceBuffer);
});
