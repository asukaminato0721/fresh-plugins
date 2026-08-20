/// <reference path="./lib/fresh.d.ts" />
// File Diff — side-by-side diff of any two files on disk.
//
// The baseline is a second file you pick, not a git revision, so this works
// on untracked files, scratch notes, backups and anything outside a
// repository. The header row carries the two file names as buttons: click
// one to swap that side for a file chosen from the filesystem browser.
//
// Any number of diffs can be open at once. Each is its own buffer group with
// its own header, and its buttons act only on that view; keyboard commands
// act on whichever view is focused.

const editor = getEditor();

/** Keybinding set carried by each composite and by the groups themselves. */
const MODE = "file-diff";

/** Header row above the diff. `fixed` keeps it one line tall regardless of
 *  the group's height; the diff below it scrolls. */
const GROUP_LAYOUT = JSON.stringify({
  type: "split",
  direction: "v",
  ratio: 0.05, // ignored while one side is `fixed`
  first: { type: "fixed", id: "header", height: 1 },
  second: { type: "scrollable", id: "diff" },
});

/** One pane of a diff. */
interface Side {
  path: string;
  bufferId: number;
}

/** One open diff. `panelId` is both the widget panel id the host routes
 *  clicks to and this view's key in `views` — which is what keeps two open
 *  diffs from driving each other's header. */
interface DiffView {
  panelId: number;
  groupId: number;
  headerBufferId: number;
  left: Side;
  right: Side;
  compositeId: number | null;
  hunkCount: number;
  /** Set when the last rebuild failed; rendered in this view's header. */
  error: string | null;
  headerMounted: boolean;
}

const views = new Map<number, DiffView>();
let nextPanelId = 1;

/** Buffers this plugin opened, and may therefore close again. Ownership is
 *  per *buffer*, not per pane: two views showing the same file share one
 *  buffer, and whichever of them lets go last is the one that closes it. A
 *  file the user already had open is never in here, and so is never closed
 *  out from under them. */
const openedByUs = new Set<number>();

/** The file browser is modal, so only one pick can be in flight across all
 *  views at a time — unlike the rest of the state, this guard is global. */
let pickerBusy = false;

// =============================================================================
// Finding the view a command applies to
// =============================================================================

/** The view the user is looking at: the one owning the active buffer, or the
 *  only one open. Null when several are open and none of them is focused. */
function focusedView(): DiffView | null {
  const active = editor.getActiveBufferId();
  if (active !== 0) {
    for (const view of views.values()) {
      if (view.compositeId === active || view.headerBufferId === active) return view;
    }
  }
  if (views.size === 1) return views.values().next().value ?? null;
  return null;
}

/** How many sides across all open views point at this buffer. A buffer is
 *  only ours to close once this reaches zero — count *after* removing the
 *  releasing view from `views`, or a view closing while a second one shows
 *  the same file will pull the buffer out from under it. */
function referenceCount(bufferId: number): number {
  let count = 0;
  for (const view of views.values()) {
    if (view.left.bufferId === bufferId) count++;
    if (view.right.bufferId === bufferId) count++;
  }
  return count;
}

// =============================================================================
// Header
// =============================================================================

function headerButton(
  label: string,
  key: string,
  opts?: { intent?: ButtonKind; inert?: boolean },
): WidgetSpec {
  const inert = opts?.inert ?? false;
  const spec: WidgetSpec = {
    kind: "button",
    label,
    key,
    focused: false,
    intent: opts?.intent ?? "normal",
    disabled: false,
    focusable: !inert,
    bare: inert,
    fullWidth: false,
  };
  // Omit rather than pass undefined: the bridge turns a present undefined
  // into JSON null, which won't deserialize as the host's Option<_>.
  if (!inert) spec.hoverStyle = { fg: "ui.help_key_fg" };
  return spec;
}

/** Basename, qualified by its parent directory when this view's two sides
 *  share one (comparing two copies of the same file is the common case). */
function sideLabel(view: DiffView, path: string): string {
  const base = editor.pathBasename(path);
  if (editor.pathBasename(view.left.path) === editor.pathBasename(view.right.path)) {
    const parent = editor.pathBasename(editor.pathDirname(path));
    if (parent !== "") return parent + "/" + base;
  }
  return base;
}

function statusLabel(view: DiffView): string {
  if (view.error !== null) return view.error;
  if (view.hunkCount === 0) return editor.t("status.identical");
  if (view.hunkCount === 1) return editor.t("status.hunks_one");
  return editor.t("status.hunks_many", { count: String(view.hunkCount) });
}

function renderHeader(view: DiffView): void {
  if (view.headerBufferId === 0) return;
  const spec: WidgetSpec = {
    kind: "row",
    wrap: false,
    children: [
      headerButton(sideLabel(view, view.left.path), "left"),
      headerButton(sideLabel(view, view.right.path), "right"),
      { kind: "spacer", cols: 2, flex: false },
      headerButton(statusLabel(view), "status", {
        inert: true,
        intent: view.error !== null ? "danger" : "normal",
      }),
      { kind: "spacer", cols: 0, flex: true },
      headerButton(editor.t("header.swap"), "swap"),
      headerButton(editor.t("header.refresh"), "refresh"),
      headerButton(editor.t("header.close"), "close"),
    ],
  };
  if (!view.headerMounted) {
    view.headerMounted = editor.mountWidgetPanel(view.panelId, view.headerBufferId, spec);
  } else {
    editor.updateWidgetPanel(view.panelId, spec);
  }
}

/** Report a failure in that diff's own header. Falls back to the status bar
 *  only when there is no header to put it in — i.e. no view opened. */
function reportError(view: DiffView | null, message: string): void {
  if (view !== null) {
    view.error = message;
    renderHeader(view);
  } else {
    editor.setStatus(message);
  }
}

// =============================================================================
// Building a diff
// =============================================================================

/** Resolve a caller-supplied path against the window's working directory.
 *  `findBufferByPath` matches on the absolute path, so a relative one would
 *  silently open a second buffer for a file already on screen. */
function absolutePath(path: string): string {
  return editor.pathIsAbsolute(path) ? path : editor.pathJoin(editor.getCwd(), path);
}

/** Resolve a side's path to a buffer, opening the file if it isn't already. */
async function ensureBuffer(side: Side): Promise<boolean> {
  let id = editor.findBufferByPath(side.path);
  if (id === 0) {
    editor.openFileInBackground(side.path);
    await editor.flush();
    id = editor.findBufferByPath(side.path);
    if (id !== 0) openedByUs.add(id);
  }
  side.bufferId = id;
  return id !== 0;
}

/** Drop a side's buffer if we opened it and no other pane still shows it.
 *  `closeBuffer` without `force` refuses to discard unsaved edits, which is
 *  what we want: a file the user has been editing outlives the diff. */
function releaseSide(side: Side): void {
  const bufferId = side.bufferId;
  side.bufferId = 0;
  if (bufferId === 0 || referenceCount(bufferId) > 0) return;
  if (openedByUs.delete(bufferId)) {
    try {
      editor.closeBuffer(bufferId);
    } catch (_e) { /* already gone */ }
  }
}

/** The shapes line up field for field, so this is a widening cast in all but
 *  name — with one deliberate omission. Supplying `ops` would classify every
 *  line as a deletion *or* an addition, and the aligner would then put a
 *  modified line's two versions on two separate rows. `computeLineDiff`
 *  hunks carry no context lines, so leaving `ops` off and letting the host
 *  pair positionally is what puts an edited line beside its old self. */
function toCompositeHunks(hunks: LineDiffHunk[]): TsCompositeHunk[] {
  return hunks.map((h) => ({
    oldStart: h.oldStart,
    oldCount: h.oldCount,
    newStart: h.newStart,
    newCount: h.newCount,
  }));
}

/** Recompute one view's diff and swap a fresh composite into its panel. */
async function rebuild(view: DiffView): Promise<void> {
  view.error = null;

  for (const side of [view.left, view.right]) {
    if (!(await ensureBuffer(side))) {
      view.error = editor.t("error.unreadable", { path: side.path });
      renderHeader(view);
      return;
    }
  }

  const leftText = await editor.getBufferText(view.left.bufferId);
  const rightText = await editor.getBufferText(view.right.bufferId);
  const hunks = toCompositeHunks(editor.computeLineDiff(leftText, rightText));
  view.hunkCount = hunks.length;

  const opts: TsCreateCompositeBufferOptions = {
    name: editor.t("title", {
      left: editor.pathBasename(view.left.path),
      right: editor.pathBasename(view.right.path),
    }),
    mode: MODE,
    layout: { type: "side-by-side", ratios: [0.5, 0.5], showSeparator: true },
    sources: [
      {
        bufferId: view.left.bufferId,
        label: view.left.path,
        editable: false,
        style: { gutterStyle: "both" },
      },
      {
        bufferId: view.right.bufferId,
        label: view.right.path,
        editable: false,
        style: { gutterStyle: "both" },
      },
    ],
    hunks: hunks.length > 0 ? hunks : null,
  };
  if (hunks.length > 0) opts.initialFocusHunk = 0;

  const composite = await editor.createCompositeBuffer(opts);

  // Swap the new composite in before tearing the old one down: closing
  // first leaves the panel pointing at a dead buffer for a frame.
  const previous = view.compositeId;
  view.compositeId = composite;
  await editor.setBufferGroupPanelBuffer(view.groupId, "diff", composite);
  editor.focusBufferGroupPanel(view.groupId, "diff");
  if (previous !== null) {
    try {
      editor.closeCompositeBuffer(previous);
    } catch (_e) { /* already gone */ }
  }
  renderHeader(view);
  editor.flushLayout();
}

/** Point one side of a view at a different file, releasing the buffer it
 *  held. Sides of *other* views are untouched. */
function setSide(view: DiffView, which: "left" | "right", path: string): void {
  const side = which === "left" ? view.left : view.right;
  if (side.path === path) return;
  releaseSide(side);
  side.path = path;
}

/** Open a new diff view on two paths. Each call creates its own group, so
 *  several comparisons can sit side by side. */
async function openDiff(leftPath: string, rightPath: string): Promise<DiffView | null> {
  const left = absolutePath(leftPath);
  const right = absolutePath(rightPath);
  if (left === right) {
    reportError(focusedView(), editor.t("error.same_file"));
    return null;
  }
  // The group's tab name is fixed at creation; the header carries the live
  // file names once a side is replaced.
  const title = editor.t("title", {
    left: editor.pathBasename(left),
    right: editor.pathBasename(right),
  });
  // createBufferGroup is a runtime-only binding, absent from the generated
  // EditorAPI type (same as in git-log and audit mode).
  // deno-lint-ignore no-explicit-any
  const group = await (editor as any).createBufferGroup(title, MODE, GROUP_LAYOUT);
  const view: DiffView = {
    panelId: nextPanelId++,
    groupId: group.groupId as number,
    headerBufferId: (group.panels["header"] as number | undefined) ?? 0,
    left: { path: left, bufferId: 0 },
    right: { path: right, bufferId: 0 },
    compositeId: null,
    hunkCount: 0,
    error: null,
    headerMounted: false,
  };
  views.set(view.panelId, view);
  renderHeader(view);
  await rebuild(view);
  return view;
}

function closeView(view: DiffView): void {
  if (view.headerMounted) {
    editor.unmountWidgetPanel(view.panelId);
    view.headerMounted = false;
  }
  if (view.compositeId !== null) {
    try {
      editor.closeCompositeBuffer(view.compositeId);
    } catch (_e) { /* already gone */ }
  }
  // Drop the view from the registry first so `referenceCount` stops
  // counting its own sides as another pane holding the buffer.
  views.delete(view.panelId);
  releaseSide(view.left);
  releaseSide(view.right);
  editor.closeBufferGroup(view.groupId);
}

/** A source buffer disappearing would leave a pane rendering a dead buffer,
 *  so any view showing it goes with it — and only those views. */
function file_diff_on_buffer_closed(args: { buffer_id: number }): void {
  openedByUs.delete(args.buffer_id);
  const doomed: DiffView[] = [];
  for (const view of views.values()) {
    if (args.buffer_id === view.left.bufferId || args.buffer_id === view.right.bufferId) {
      doomed.push(view);
    }
  }
  for (const view of doomed) closeView(view);
}
registerHandler("file_diff_on_buffer_closed", file_diff_on_buffer_closed);
editor.on("buffer_closed", "file_diff_on_buffer_closed");

// =============================================================================
// Commands
// =============================================================================

/** Anchor the file browser near what the user is already looking at. */
function pickAnchor(): string | null {
  const view = focusedView();
  if (view !== null) return editor.pathDirname(view.right.path);
  const active = editor.getActiveBufferId();
  const path = active !== 0 ? editor.getBufferPath(active) : "";
  return path !== "" ? editor.pathDirname(path) : null;
}

async function file_diff_compare(): Promise<void> {
  if (pickerBusy) return;
  pickerBusy = true;
  try {
    const left = await editor.pickFile(editor.t("prompt.pick_left"), pickAnchor());
    if (left === null) return;
    const right = await editor.pickFile(
      editor.t("prompt.pick_right"),
      editor.pathDirname(left),
    );
    if (right === null) return;
    await openDiff(left, right);
  } catch (e) {
    reportError(focusedView(), String(e));
  } finally {
    pickerBusy = false;
  }
}
registerHandler("file_diff_compare", file_diff_compare);

async function file_diff_compare_with(): Promise<void> {
  if (pickerBusy) return;
  pickerBusy = true;
  try {
    const active = editor.getActiveBufferId();
    const path = active !== 0 ? editor.getBufferPath(active) : "";
    if (path === "") {
      reportError(focusedView(), editor.t("error.no_file"));
      return;
    }
    const other = await editor.pickFile(
      editor.t("prompt.pick_other"),
      editor.pathDirname(path),
    );
    if (other === null) return;
    await openDiff(path, other);
  } catch (e) {
    reportError(focusedView(), String(e));
  } finally {
    pickerBusy = false;
  }
}
registerHandler("file_diff_compare_with", file_diff_compare_with);

/** Replace one side of one view from the file browser — what the header
 *  buttons do. The view is passed in, never looked up from focus, so a
 *  click always acts on the diff that was clicked. */
async function pickSide(view: DiffView | null, which: "left" | "right"): Promise<void> {
  if (view === null || pickerBusy) return;
  pickerBusy = true;
  try {
    const current = which === "left" ? view.left : view.right;
    const label = which === "left"
      ? editor.t("prompt.pick_left")
      : editor.t("prompt.pick_right");
    const picked = await editor.pickFile(label, editor.pathDirname(current.path));
    if (picked === null) return;
    // The pick can take a while; the view may be gone by the time it lands.
    if (!views.has(view.panelId)) return;
    const other = which === "left" ? view.right.path : view.left.path;
    if (picked === other) {
      reportError(view, editor.t("error.same_file"));
      return;
    }
    setSide(view, which, picked);
    renderHeader(view);
    await rebuild(view);
  } catch (e) {
    reportError(views.has(view.panelId) ? view : null, String(e));
  } finally {
    pickerBusy = false;
  }
}

async function file_diff_pick_left(): Promise<void> {
  await pickSide(focusedView(), "left");
}
registerHandler("file_diff_pick_left", file_diff_pick_left);

async function file_diff_pick_right(): Promise<void> {
  await pickSide(focusedView(), "right");
}
registerHandler("file_diff_pick_right", file_diff_pick_right);

async function swapSides(view: DiffView | null): Promise<void> {
  if (view === null) return;
  const left = view.left;
  view.left = view.right;
  view.right = left;
  renderHeader(view);
  try {
    await rebuild(view);
  } catch (e) {
    reportError(view, String(e));
  }
}

async function file_diff_swap(): Promise<void> {
  await swapSides(focusedView());
}
registerHandler("file_diff_swap", file_diff_swap);

/** Recompute against the panes' current contents — after an external write,
 *  or after editing either file elsewhere in the editor. */
async function refreshView(view: DiffView | null): Promise<void> {
  if (view === null) return;
  try {
    await rebuild(view);
  } catch (e) {
    reportError(view, String(e));
  }
}

async function file_diff_refresh(): Promise<void> {
  await refreshView(focusedView());
}
registerHandler("file_diff_refresh", file_diff_refresh);

function file_diff_next_hunk(): void {
  const view = focusedView();
  if (view !== null && view.compositeId !== null) editor.compositeNextHunk(view.compositeId);
}
registerHandler("file_diff_next_hunk", file_diff_next_hunk);

function file_diff_prev_hunk(): void {
  const view = focusedView();
  if (view !== null && view.compositeId !== null) editor.compositePrevHunk(view.compositeId);
}
registerHandler("file_diff_prev_hunk", file_diff_prev_hunk);

/** Open the focused pane's file at the line under the cursor. Composite
 *  cursor lines are 0-indexed; openFile takes 1-based line/column. */
async function file_diff_open_at_cursor(): Promise<void> {
  const view = focusedView();
  if (view === null || view.compositeId === null) return;
  try {
    const info = await editor.getCompositeCursorInfo();
    if (info === null) return;
    const side = info.focusedPane === 0 ? view.left : view.right;
    const line = info.lines[info.focusedPane];
    if (line === null || line === undefined) editor.openFile(side.path);
    else editor.openFile(side.path, line + 1, 1);
  } catch (e) {
    reportError(view, String(e));
  }
}
registerHandler("file_diff_open_at_cursor", file_diff_open_at_cursor);

function file_diff_close(): void {
  const view = focusedView();
  if (view !== null) closeView(view);
}
registerHandler("file_diff_close", file_diff_close);

// =============================================================================
// Wiring
// =============================================================================

// Clicks on a header are hit-tested by the host, which fires widget_event
// carrying the panel it landed in — so the click drives that view's own
// state with no mouse plumbing and no ambiguity between open diffs.
editor.on("widget_event", (args) => {
  const view = views.get(args.panel_id);
  if (view === undefined || args.event_type !== "activate") return;
  switch (args.widget_key) {
    case "left":
      void pickSide(view, "left");
      break;
    case "right":
      void pickSide(view, "right");
      break;
    case "swap":
      void swapSides(view);
      break;
    case "refresh":
      void refreshView(view);
      break;
    case "close":
      closeView(view);
      break;
  }
});

editor.registerCommand("%cmd.compare", "%cmd.compare_desc", "file_diff_compare", null);
editor.registerCommand("%cmd.compare_with", "%cmd.compare_with_desc", "file_diff_compare_with", null);
editor.registerCommand("%cmd.pick_left", "%cmd.pick_left_desc", "file_diff_pick_left", MODE);
editor.registerCommand("%cmd.pick_right", "%cmd.pick_right_desc", "file_diff_pick_right", MODE);
editor.registerCommand("%cmd.swap", "%cmd.swap_desc", "file_diff_swap", MODE);
editor.registerCommand("%cmd.refresh", "%cmd.refresh_desc", "file_diff_refresh", MODE);
editor.registerCommand("%cmd.next_hunk", "%cmd.next_hunk_desc", "file_diff_next_hunk", MODE);
editor.registerCommand("%cmd.prev_hunk", "%cmd.prev_hunk_desc", "file_diff_prev_hunk", MODE);
editor.registerCommand("%cmd.open_at_cursor", "%cmd.open_at_cursor_desc", "file_diff_open_at_cursor", MODE);
editor.registerCommand("%cmd.close", "%cmd.close_desc", "file_diff_close", MODE);

// Read-only, inheriting the normal motions so scrolling and cursor movement
// work as they do anywhere else; the letters below are the diff's own.
editor.defineMode(MODE, [
  ["n", "file_diff_next_hunk"],
  ["p", "file_diff_prev_hunk"],
  ["r", "file_diff_refresh"],
  ["s", "file_diff_swap"],
  ["1", "file_diff_pick_left"],
  ["2", "file_diff_pick_right"],
  ["Enter", "file_diff_open_at_cursor"],
  ["q", "file_diff_close"],
], true, false, true);

// Scriptable surface: `fresh --cmd script run` lives in its own realm and
// can't reach the handlers above, so opening a diff from the CLI (or from
// init.ts, or another plugin) goes through here.
editor.exportPluginApi("file_diff", {
  /** Open a new diff view on two paths, relative ones resolved against the
   *  cwd. Resolves with the view's id, its hunk count, and any error. */
  open: async function (
    left: string,
    right: string,
  ): Promise<{ id: number; hunks: number; error: string | null }> {
    const view = await openDiff(left, right);
    if (view === null) return { id: 0, hunks: 0, error: "could not open diff" };
    return { id: view.panelId, hunks: view.hunkCount, error: view.error };
  },
  /** Close one view by id, or the focused one when id is omitted. */
  close: function (id?: number): boolean {
    const view = id === undefined ? focusedView() : (views.get(id) ?? null);
    if (view === null) return false;
    closeView(view);
    return true;
  },
  /** Every open view, in creation order. */
  list: function (): Array<{ id: number; left: string; right: string; hunks: number }> {
    return Array.from(views.values(), (v) => ({
      id: v.panelId,
      left: v.left.path,
      right: v.right.path,
      hunks: v.hunkCount,
    }));
  },
});

editor.debug("File Diff plugin loaded");
