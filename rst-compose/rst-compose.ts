import { parseDocument } from "./lib/parse.ts";

const editor = getEditor();
const namespace = "rst-compose";
const versions = new Map<number, number>();
const pending = new Set<number>();
const tracked = new Set<number>();
let timer: number | undefined;
const MAX_BYTES = 1024 * 1024;

interface Settings {
  autoCompose?: boolean;
  pageWidth?: number;
  hideLineNumbers?: boolean;
}
function settings(): Settings {
  return editor.getPluginConfig() as Settings ?? {};
}
function isRst(id: number): boolean {
  const info = editor.getBufferInfo(id);
  return !!info && !info.is_virtual && /\.(rst|rest)$/i.test(info.path);
}
function composing(id: number): boolean {
  return !!editor.getBufferInfo(id)?.is_composing_in_any_split;
}
function invalidate(id: number): void {
  versions.set(id, (versions.get(id) ?? 0) + 1);
}
function clear(id: number): void {
  editor.clearNamespace(id, namespace);
  editor.clearConcealNamespace(id, namespace);
}

// Fresh 0.5.3's built-in Markdown handler decorates every compose buffer.
// Remove only those known Markdown decorations from RST buffers. Keep the
// Markdown plugin loaded so Markdown buffers continue to work normally.
function clearMarkdownArtifacts(id: number): void {
  editor.clearNamespace(id, "md-emphasis");
  editor.clearConcealNamespace(id, "md-syntax");
  editor.clearSoftBreakNamespace(id, "md-wrap");
  editor.clearVirtualTextNamespace(id, "md-tb");
  editor.clearVirtualTextNamespace(id, "md-ls");
  editor.removeVirtualTextsByPrefix(id, "mdcr:");
  editor.clearScrollbarMarkers(id, "md-headings");
}

function layout(id: number): void {
  const cfg = settings();
  const global = editor.getConfig();
  const language = editor.getBufferInfo(id)?.language ?? "rst";
  const langWidth = global.languages?.[language]?.page_width;
  const globalWidth = global.editor?.page_width;
  const configuredWidth = typeof langWidth === "number" && langWidth > 0
    ? langWidth
    : globalWidth === null
    ? 0
    : globalWidth ?? 80;
  const width = Math.max(0, Math.min(400, cfg.pageWidth ?? configuredWidth));
  editor.setLineNumbersDefault(
    id,
    cfg.hideLineNumbers === false ? null : false,
  );
  editor.setFoldIndicators(id, false);
  editor.setIndentationGuide(id, false);
  editor.setLineWrap(id, editor.getActiveSplitId(), true);
  editor.setLayoutHints(id, editor.getActiveSplitId(), {
    composeWidth: width > 0 ? width : undefined,
  });
}

function schedule(id: number): void {
  invalidate(id);
  pending.add(id);
  if (timer !== undefined) editor.clearInterval(timer);
  timer = editor.setTimeout(60, "rstComposeRefresh");
}

async function decorate(id: number): Promise<void> {
  if (!isRst(id) || !composing(id)) return;
  const version = versions.get(id);
  const info = editor.getBufferInfo(id)!;
  if (info.length > MAX_BYTES) {
    clear(id);
    editor.setStatus(
      "RST Compose: Files larger than 1 MiB keep source markup.",
    );
    return;
  }
  try {
    const text = await editor.getBufferText(id);
    if (versions.get(id) !== version || !isRst(id) || !composing(id)) return;
    const plan = parseDocument(text, (value) => editor.stringWidth(value));
    clearMarkdownArtifacts(id);
    clear(id);
    for (const decoration of plan.decorations) {
      if (decoration.style) {
        editor.addOverlay(
          id,
          namespace,
          decoration.start,
          decoration.end,
          decoration.style,
        );
      }
      if (decoration.replacement !== undefined) {
        editor.addConceal(
          id,
          namespace,
          decoration.start,
          decoration.end,
          decoration.replacement,
          "unless-cursor-in",
          decoration.scopeStart,
          decoration.scopeEnd,
        );
      }
    }
  } catch (error) {
    if (isRst(id)) editor.setStatus(`RST Compose: ${String(error)}`);
  }
}

registerHandler("rstComposeRefresh", async () => {
  timer = undefined;
  const ids = [...pending];
  pending.clear();
  for (const id of ids) await decorate(id);
});

async function enable(id: number): Promise<void> {
  tracked.add(id);
  editor.setViewMode(id, "compose");
  layout(id);
  await editor.flush();
  schedule(id);
}

registerHandler("rstComposeToggle", async () => {
  const id = editor.getActiveBufferId();
  if (!isRst(id)) {
    editor.setStatus("RST Compose: Open an .rst or .rest file first.");
    return;
  }
  if (editor.getBufferInfo(id)?.view_mode !== "compose") {
    await enable(id);
    editor.setStatus("RST Compose enabled. Markup appears at the cursor.");
  } else {
    invalidate(id);
    editor.setViewMode(id, "source");
    editor.setLineNumbersDefault(id, null);
    editor.setFoldIndicators(id, null);
    editor.setIndentationGuide(id, null);
    editor.setLayoutHints(id, editor.getActiveSplitId(), {});
    await editor.flush();
    if (!composing(id)) clear(id);
    clearMarkdownArtifacts(id);
    editor.setStatus("RST source view enabled.");
  }
});
editor.registerCommand(
  "RST: Toggle Compose",
  "Switch between editable reStructuredText compose and source views",
  "rstComposeToggle",
  null,
);

editor.on("buffer_activated", async ({ buffer_id: id }) => {
  if (!isRst(id)) return;
  if (editor.getBufferInfo(id)?.view_mode === "compose") {
    tracked.add(id);
    layout(id);
    schedule(id);
  } else if (settings().autoCompose && !tracked.has(id)) await enable(id);
});
editor.on("after_file_open", async ({ buffer_id: id }) => {
  if (isRst(id) && settings().autoCompose) await enable(id);
});
editor.on("buffer_modified", ({ buffer_id: id }) => {
  if (tracked.has(id)) schedule(id);
});
editor.on(
  "lines_changed",
  ({ buffer_id: id, is_composing_in_any_split: active }) => {
    if (!active || !isRst(id)) return;
    tracked.add(id);
    clearMarkdownArtifacts(id);
    schedule(id);
  },
);
editor.on("buffer_closed", ({ buffer_id: id }) => {
  invalidate(id);
  pending.delete(id);
  tracked.delete(id);
});
editor.on("config_changed", () => {
  const id = editor.getActiveBufferId();
  if (isRst(id) && editor.getBufferInfo(id)?.view_mode === "compose") {
    layout(id);
  }
});

// Handle buffers already open when the plugin loads.
const initial = editor.getActiveBufferId();
if (
  isRst(initial) &&
  (settings().autoCompose ||
    editor.getBufferInfo(initial)?.view_mode === "compose")
) void enable(initial);
