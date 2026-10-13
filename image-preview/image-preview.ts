import {
  absolutePath,
  isImagePath,
  renderImage,
  type RenderOptions,
  type Rgb,
} from "./lib/render.ts";

const editor = getEditor();
const MODE = "image-preview";
interface Settings {
  autoOpen?: boolean;
  renderer?: RenderOptions["renderer"];
  chafaCommand?: string;
  magickCommand?: string;
  maxWidth?: number;
  maxHeight?: number;
}
interface Preview {
  buffer: number;
  source: number | null;
  path: string;
  width: number;
  height: number;
  version: number;
  process: ProcessHandle<SpawnResult> | null;
}
const previews = new Map<number, Preview>();
const pending = new Set<number>();
let resizeTimer: number | null = null;
let opening = false;

function settings(): Settings {
  return (editor.getPluginConfig() ?? {}) as Settings;
}

function background(): Rgb {
  const name = editor.getConfig().theme;
  const theme = name
    ? editor.getThemeData(name) as { editor?: { bg?: unknown } } | null
    : null;
  const value = theme?.editor?.bg;
  return Array.isArray(value) && value.length === 3 &&
      value.every((part) => Number.isFinite(part))
    ? value.map((part) => Math.max(0, Math.min(255, Math.round(part)))) as Rgb
    : [30, 30, 30];
}

function limit(value: unknown, fallback: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function dimensions(buffer: number): { width: number; height: number } | null {
  const pane = editor.listSplits().find((split) => split.bufferId === buffer);
  if (!pane) return null;
  const config = settings();
  return {
    width: Math.max(
      1,
      Math.min(pane.viewport.width - 2, limit(config.maxWidth, 200, 400)),
    ),
    height: Math.max(
      1,
      Math.min(pane.viewport.height - 3, limit(config.maxHeight, 100, 200)),
    ),
  };
}

function label(path: string): string {
  return path.split(/[\\/]/).at(-1)!.replace(/[\x00-\x1f\x7f]/g, "?");
}

async function redraw(preview: Preview): Promise<void> {
  const size = dimensions(preview.buffer);
  if (!size) return;
  const version = ++preview.version;
  if (preview.process) void preview.process.kill();
  preview.process = null;
  preview.width = size.width;
  preview.height = size.height;
  const config = settings();
  try {
    const image = await renderImage((command, args) => {
      if (preview.version !== version || !previews.has(preview.buffer)) {
        throw new Error("Preview closed.");
      }
      const process = editor.spawnProcess(command, args, editor.getCwd());
      preview.process = process;
      return process;
    }, {
      ...size,
      path: preview.path,
      background: background(),
      renderer: config.renderer,
      chafaCommand: config.chafaCommand,
      magickCommand: config.magickCommand,
    });
    if (preview.version !== version || !previews.has(preview.buffer)) return;
    editor.setVirtualBufferContent(preview.buffer, [
      { text: `${label(preview.path)} · ${image.renderer}\n` },
      ...image.entries,
      {
        text: "r: refresh   b: view bytes   q: close\n",
        style: { fg: "ui.help_key_fg" },
      },
    ]);
  } catch (error) {
    if (preview.version !== version || !previews.has(preview.buffer)) return;
    editor.setVirtualBufferContent(preview.buffer, [
      {
        text: `Cannot preview ${label(preview.path)}\n`,
        style: { fg: "diagnostic.error" },
      },
      { text: `${error}\n\nr: retry   b: view bytes   q: close\n` },
    ]);
    editor.setStatus(`Image preview failed: ${error}`);
  } finally {
    if (preview.version === version) preview.process = null;
  }
}

async function show(path: string, source: number | null): Promise<void> {
  if (opening) return;
  path = absolutePath(path, editor.getCwd(), editor.getEnv("HOME") ?? "");
  if (!editor.fileExists(path)) {
    editor.setStatus(`Image file does not exist: ${path}`);
    return;
  }
  opening = true;
  try {
    const split = editor.getActiveSplitId();
    const existing = [...previews.values()].find((preview) =>
      preview.path === path
    );
    if (existing && editor.getBufferInfo(existing.buffer)) {
      editor.setSplitBuffer(split, existing.buffer);
      editor.setContext(MODE, true);
      await editor.flush();
      void redraw(existing);
      return;
    }
    const result = await editor.createVirtualBuffer({
      name: `*Image: ${label(path)}*`,
      mode: MODE,
      splitId: split,
      readOnly: true,
      editingDisabled: true,
      showLineNumbers: false,
      showCursors: false,
      highlightCurrentLine: false,
      entries: [{ text: `Loading ${label(path)}...\n` }],
    });
    const preview: Preview = {
      buffer: result.bufferId,
      source,
      path,
      width: 0,
      height: 0,
      version: 0,
      process: null,
    };
    previews.set(preview.buffer, preview);
    editor.setLineWrap(preview.buffer, split, false);
    editor.setContext(MODE, true);
    await editor.flush();
    void redraw(preview);
  } catch (error) {
    editor.setStatus(`Cannot open image preview: ${error}`);
  } finally {
    opening = false;
  }
}

function autoOpen(id: number): void {
  if (settings().autoOpen === false || id !== editor.getActiveBufferId()) {
    return;
  }
  const info = editor.getBufferInfo(id);
  if (info && !info.is_virtual && isImagePath(info.path)) {
    void show(info.path, id);
  }
}

function active(): Preview | undefined {
  return previews.get(editor.getActiveBufferId());
}

registerHandler("imagePreviewShow", () => {
  const preview = active();
  if (preview) {
    void redraw(preview);
    return;
  }
  const id = editor.getActiveBufferId();
  const info = editor.getBufferInfo(id);
  if (!info || info.is_virtual || !isImagePath(info.path)) {
    editor.setStatus("Open an image file, or run Image Preview: Open.");
    return;
  }
  void show(info.path, id);
});
registerHandler("imagePreviewOpen", async () => {
  const path = await editor.prompt("Image path:", active()?.path ?? "");
  if (path?.trim()) await show(path.trim(), null);
});
registerHandler("imagePreviewRefresh", () => {
  const preview = active();
  if (preview) void redraw(preview);
});
registerHandler("imagePreviewBytes", async () => {
  const preview = active();
  if (!preview) return;
  const split = editor.getActiveSplitId();
  // Existing binary buffers can be viewed without firing after_file_open again.
  if (preview.source !== null && editor.getBufferInfo(preview.source)) {
    editor.setSplitBuffer(split, preview.source);
  } else {
    // Suppress automatic preview while opening the original file.
    opening = true;
    try {
      await editor.openFile(preview.path);
      preview.source = editor.getActiveBufferId();
    } finally {
      opening = false;
    }
  }
});
registerHandler("imagePreviewClose", () => {
  const preview = active();
  if (preview) editor.closeBuffer(preview.buffer, true);
});
registerHandler("imagePreviewResize", () => {
  resizeTimer = null;
  const ids = [...pending];
  pending.clear();
  for (const id of ids) {
    const preview = previews.get(id);
    if (preview) void redraw(preview);
  }
});
registerHandler(
  "imagePreviewInitial",
  () => autoOpen(editor.getActiveBufferId()),
);

editor.defineMode(MODE, [
  ["q", "imagePreviewClose"],
  ["r", "imagePreviewRefresh"],
  ["b", "imagePreviewBytes"],
], true);
editor.registerCommand(
  "Image Preview: Show",
  "Preview the current image file",
  "imagePreviewShow",
  null,
);
editor.registerCommand(
  "Image Preview: Open",
  "Preview an image by file path",
  "imagePreviewOpen",
  null,
);
editor.registerCommand(
  "Image Preview: Refresh",
  "Render the image again",
  "imagePreviewRefresh",
  MODE,
);
editor.registerCommand(
  "Image Preview: View Bytes",
  "Show the original image file",
  "imagePreviewBytes",
  MODE,
);
editor.registerCommand(
  "Image Preview: Close",
  "Close the image preview",
  "imagePreviewClose",
  MODE,
);
editor.on("after_file_open", (data) => autoOpen(data.buffer_id));
editor.on("buffer_activated", (data) => {
  editor.setContext(MODE, previews.has(data.buffer_id));
  const preview = previews.get(data.buffer_id);
  const size = preview ? dimensions(preview.buffer) : null;
  if (
    preview && size &&
    (size.width !== preview.width || size.height !== preview.height)
  ) void redraw(preview);
});
editor.on("buffer_closed", (data) => {
  const preview = previews.get(data.buffer_id);
  if (preview) {
    preview.version++;
    if (preview.process) void preview.process.kill();
    previews.delete(data.buffer_id);
    pending.delete(data.buffer_id);
  }
});
editor.on("viewport_changed", (data) => {
  const preview = previews.get(data.buffer_id);
  if (!preview) return;
  const size = dimensions(preview.buffer);
  if (
    !size || (size.width === preview.width && size.height === preview.height)
  ) return;
  pending.add(preview.buffer);
  if (resizeTimer !== null) editor.clearInterval(resizeTimer);
  resizeTimer = editor.setTimeout(150, "imagePreviewResize");
});
editor.on("config_changed", () => {
  for (const preview of previews.values()) {
    if (dimensions(preview.buffer)) void redraw(preview);
  }
});
editor.setTimeout(0, "imagePreviewInitial");
