import { parseChangedFiles, parseCommits, type ChangedFile, type Commit } from "./lib/review_git.ts";

const editor = getEditor();
const PANEL_ID = 3205;
const COMMITS_KEY = "review-commits";
const FILES_KEY = "review-files";
const PANEL_ROWS = 26;

let open = false;
let opening = false;
let mounted = false;
let repoRoot: string | null = null;
let ownerWindow: number | null = null;
let commits: Commit[] = [];
let files: ChangedFile[] = [];
let commitIndex = -1;
let fileIndex = -1;
let diffBufferId: number | null = null;
let requestGeneration = 0;

function label(text: string): WidgetSpec {
  return { kind: "label", text, labelWidth: 0, wrap: false, elide: "tail" };
}

function panelSpec(): WidgetSpec {
  return {
    kind: "col",
    children: [
      label(`Commits (${commits.length})`),
      {
        kind: "list",
        key: COMMITS_KEY,
        items: commits.map((commit) => ({ text: `${commit.hash.slice(0, 7)} ${commit.subject}` })),
        itemKeys: commits.map((commit) => commit.hash),
        selectedIndex: commitIndex,
        visibleRows: 9,
        focusable: true,
        typeAhead: false,
      },
      label(`Changed files (${files.length})`),
      {
        kind: "list",
        key: FILES_KEY,
        items: files.map((file) => ({ text: `${file.status} ${file.path}` })),
        itemKeys: files.map((file) => file.path),
        selectedIndex: fileIndex,
        visibleRows: 13,
        focusable: true,
        typeAhead: false,
      },
    ],
  };
}

function publish(): void {
  if (!open) return;
  if (!mounted) {
    editor.mountSidebarSection(PANEL_ID, panelSpec(), "Git Review", PANEL_ROWS, {
      closable: true,
      startBlurred: true,
      scope: ownerWindow === null ? "editor" : { window: ownerWindow },
    });
    mounted = true;
    return;
  }
  editor.updateFloatingWidget(PANEL_ID, panelSpec());
}

function closeReview(): void {
  requestGeneration++;
  if (mounted) editor.unmountFloatingWidget(PANEL_ID);
  if (diffBufferId !== null) editor.closeBuffer(diffBufferId);
  open = false;
  opening = false;
  mounted = false;
  repoRoot = null;
  ownerWindow = null;
  commits = [];
  files = [];
  commitIndex = -1;
  fileIndex = -1;
  diffBufferId = null;
}

async function git(args: string[], cwd: string): Promise<SpawnResult> {
  return await editor.spawnProcess("git", args, cwd);
}

async function loadFiles(index: number): Promise<void> {
  const commit = commits[index];
  if (!open || !commit || repoRoot === null) return;
  const generation = ++requestGeneration;
  commitIndex = index;
  fileIndex = -1;
  files = [];
  publish();
  editor.widgetMutate(PANEL_ID, {
    kind: "setSelectedIndex", widgetKey: COMMITS_KEY, index,
  } satisfies WidgetMutation);
  const result = await git([
    "show", "--format=", "--first-parent", "--no-renames", "--name-status", "-z", commit.hash,
  ], repoRoot);
  if (!open || generation !== requestGeneration) return;
  if (result.exit_code !== 0) {
    editor.setStatus(`Git Review: ${result.stderr.trim() || "Cannot read commit"}`);
    return;
  }
  files = parseChangedFiles(result.stdout);
  publish();
  editor.widgetMutate(PANEL_ID, {
    kind: "setSelectedIndex", widgetKey: FILES_KEY, index: -1,
  } satisfies WidgetMutation);
}

async function loadCommits(): Promise<void> {
  if (!open || repoRoot === null) return;
  const generation = ++requestGeneration;
  const result = await git(["log", "-n", "40", "-z", "--format=%H%x00%s"], repoRoot);
  if (!open || generation !== requestGeneration) return;
  if (result.exit_code !== 0) {
    editor.setStatus(`Git Review: ${result.stderr.trim() || "Cannot read history"}`);
    return;
  }
  commits = parseCommits(result.stdout);
  commitIndex = -1;
  files = [];
  publish();
  if (commits.length > 0) await loadFiles(0);
}

async function openReview(): Promise<void> {
  if (open || opening) return;
  opening = true;
  const generation = ++requestGeneration;
  const active = editor.getActiveBufferId();
  const info = editor.getBufferInfo(active);
  const path = info?.path || "";
  const cwd = path ? editor.pathDirname(path) : editor.getCwd();
  const result = await git(["rev-parse", "--show-toplevel"], cwd);
  if (generation !== requestGeneration) return;
  opening = false;
  if (result.exit_code !== 0) {
    editor.setStatus("Git Review: Open a file in a Git repository");
    return;
  }
  repoRoot = result.stdout.trim();
  ownerWindow = info?.window_id ?? null;
  open = true;
  publish();
  await loadCommits();
}

async function openFileDiff(index: number): Promise<void> {
  const file = files[index];
  const commit = commits[commitIndex];
  if (!open || !file || !commit || repoRoot === null) return;
  const generation = ++requestGeneration;
  fileIndex = index;
  const result = await git([
    "show", "--format=", "--first-parent", "--no-renames", "--patch", commit.hash, "--", file.path,
  ], repoRoot);
  if (!open || generation !== requestGeneration) return;
  if (result.exit_code !== 0) {
    editor.setStatus(`Git Review: ${result.stderr.trim() || "Cannot read file diff"}`);
    return;
  }
  if (diffBufferId !== null) editor.closeBuffer(diffBufferId);
  diffBufferId = null;
  const view = await editor.createVirtualBuffer({
    name: `*${commit.hash.slice(0, 7)} ${file.path}.diff*`,
    readOnly: true,
    editingDisabled: true,
    showLineNumbers: true,
    entries: [{ text: result.stdout || "(No patch for this file)\n" }],
  });
  if (!open || generation !== requestGeneration) {
    if (view) editor.closeBuffer(view.bufferId);
    return;
  }
  diffBufferId = view.bufferId;
}

registerHandler("gitReviewToggle", () => {
  if (open || opening) closeReview();
  else void openReview();
});
registerHandler("gitReviewRefresh", () => { void loadCommits(); });
editor.registerCommand("Git Review: Toggle", "Show or hide commit review", "gitReviewToggle", null);
editor.registerCommand("Git Review: Refresh", "Refresh commit history", "gitReviewRefresh", null);

editor.on("widget_event", (event) => {
  if (event.panel_id !== PANEL_ID || !open) return;
  if (event.event_type === "cancel") {
    mounted = false;
    closeReview();
    return;
  }
  if (event.event_type !== "select" && event.event_type !== "activate") return;
  const index = event.payload.index;
  if (typeof index !== "number") return;
  if (event.widget_key === COMMITS_KEY && index !== commitIndex) void loadFiles(index);
  if (event.widget_key === FILES_KEY) void openFileDiff(index);
});

editor.on("buffer_closed", (event) => {
  if (diffBufferId === event.buffer_id) diffBufferId = null;
});
