/// <reference path="./lib/fresh.d.ts" />
import { buildMinimap, rowForLine, type MinimapRow } from "./lib/minimap.ts";

const editor = getEditor();
const PANEL_ID = 3480;
const LIST_KEY = "minimap";
const MAX_BYTES = 1024 * 1024;

editor.defineConfigInteger("rows", {
  default: 18,
  minimum: 4,
  maximum: 80,
  description: "Number of rows in the Minimap sidebar section.",
});

interface MinimapConfig { rows?: number }
function rowCount(): number {
  const value = (editor.getPluginConfig() as MinimapConfig | null)?.rows;
  return typeof value === "number" ? Math.max(4, Math.min(80, Math.floor(value))) : 18;
}

let shown = false;
let mounted = false;
let bufferId: number | null = null;
let rows: MinimapRow[] = [];
let totalLines = 0;
let topLine = 0;
let viewportHeight = 1;
let generation = 0;
let rescanTimer: number | null = null;

function mapSpec(): WidgetSpec {
  const first = rowForLine(topLine, rows.length, totalLines);
  const last = rowForLine(topLine + viewportHeight - 1, rows.length, totalLines);
  return {
    kind: "list",
    key: LIST_KEY,
    items: rows.map((row, index) => ({
      text: `${index >= first && index <= last ? "┃" : " "}${row.text}`,
    })),
    itemKeys: rows.map((row) => String(row.line)),
    selectedIndex: first,
    focusable: true,
    typeAhead: false,
  };
}

function publish(): void {
  if (!shown || bufferId === null || rows.length === 0) return;
  if (!mounted) {
    editor.mountSidebarSection(PANEL_ID, mapSpec(), "Minimap", rowCount(), {
      closable: true,
      startBlurred: true,
      scope: { buffer: bufferId },
    });
    mounted = true;
    return;
  }
  editor.updateFloatingWidget(PANEL_ID, mapSpec());
  editor.widgetMutate(PANEL_ID, {
    kind: "setSelectedIndex",
    widgetKey: LIST_KEY,
    index: rowForLine(topLine, rows.length, totalLines),
  } satisfies WidgetMutation);
}

function unmount(): void {
  generation++;
  if (rescanTimer !== null) editor.clearInterval(rescanTimer);
  rescanTimer = null;
  if (mounted) editor.unmountFloatingWidget(PANEL_ID);
  mounted = false;
  bufferId = null;
  rows = [];
}

async function rescan(id: number): Promise<void> {
  const scan = ++generation;
  const info = editor.getBufferInfo(id);
  if (!info || info.is_virtual) return;
  if (info.length > MAX_BYTES) {
    // A whole-buffer read would make ordinary editing slow for large files.
    if (scan === generation && shown && bufferId === id) {
      rows = [{ line: 0, text: "File is too large for Minimap" }];
      totalLines = 1;
      publish();
    }
    return;
  }
  try {
    const text = await editor.getBufferText(id);
    if (scan !== generation || !shown || bufferId !== id) return;
    rows = buildMinimap(text, rowCount());
    totalLines = text.split("\n").length;
    publish();
  } catch (error) {
    editor.debug(`Minimap scan failed: ${error}`);
  }
}

function activate(id: number): void {
  if (!shown) return;
  const info = editor.getBufferInfo(id);
  if (!info || info.is_virtual) {
    unmount();
    return;
  }
  if (bufferId !== id) {
    unmount();
    bufferId = id;
    const viewport = editor.getViewport();
    topLine = viewport?.topLine ?? 0;
    viewportHeight = viewport?.height ?? 1;
  }
  void rescan(id);
}

function scheduleRescan(id: number): void {
  if (!shown || bufferId !== id) return;
  if (rescanTimer !== null) editor.clearInterval(rescanTimer);
  rescanTimer = editor.setTimeout(250, "minimapRescan");
}

registerHandler("minimapRescan", () => {
  rescanTimer = null;
  if (bufferId !== null) void rescan(bufferId);
});

registerHandler("minimapToggle", () => {
  shown = !shown;
  if (shown) {
    activate(editor.getActiveBufferId());
  } else {
    unmount();
  }
});
editor.registerCommand("Minimap: Toggle", "Show or hide the code minimap", "minimapToggle", null);

editor.on("buffer_activated", (data) => activate(data.buffer_id));
editor.on("buffer_closed", (data) => {
  if (bufferId === data.buffer_id) unmount();
});
editor.on("buffer_modified", (data) => scheduleRescan(data.buffer_id));
editor.on("viewport_changed", (data) => {
  if (!shown || bufferId !== data.buffer_id || !mounted) return;
  if (topLine === data.top_line && viewportHeight === data.height) return;
  topLine = data.top_line ?? topLine;
  viewportHeight = data.height;
  publish();
});
editor.on("config_changed", () => {
  if (bufferId === null) return;
  if (mounted) editor.floatingPanelControl(PANEL_ID, "sidebar_rows", rowCount());
  void rescan(bufferId);
});
editor.on("widget_event", (event) => {
  if (event.panel_id !== PANEL_ID) return;
  if (event.event_type === "cancel") {
    shown = false;
    mounted = false;
    unmount();
    return;
  }
  if (event.event_type !== "select" && event.event_type !== "activate") return;
  const index = event.payload.index;
  if (typeof index !== "number" || bufferId === null || !rows[index]) return;
  if (totalLines <= 1 && rows[0]?.text === "File is too large for Minimap") return;
  const splits = editor.getBufferInfo(bufferId)?.splits ?? [];
  const active = editor.getActiveSplitId();
  const split = splits.includes(active) ? active : splits[0];
  if (split === undefined) return;
  editor.scrollToLineCenter(split, bufferId, rows[index].line);
  if (event.event_type === "activate") {
    editor.floatingPanelControl(PANEL_ID, "blur", 0);
    editor.focusSplit(split);
  }
});
