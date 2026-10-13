import {
  type ChangedFile,
  type Commit,
  fileRevisions,
  parseChangedFiles,
  parseCommits,
} from "./lib/review_git.ts";

const editor = getEditor();
const PANEL_ID = 3205;
const TREE_KEY = "review-tree";
const PANEL_ROWS = 32;

type TreeItem =
  | { kind: "commit"; commit: Commit }
  | { kind: "file"; commit: Commit; file: ChangedFile }
  | { kind: "loading"; commit: Commit };

interface DiffView {
  compositeId: number;
  oldBufferId: number;
  newBufferId: number;
}

let open = false;
let opening = false;
let mounted = false;
let repoRoot: string | null = null;
let ownerWindow: number | null = null;
let commits: Commit[] = [];
let treeItems: TreeItem[] = [];
let selectedKey: string | null = null;
let expanded = new Set<string>();
let filesByCommit = new Map<string, ChangedFile[]>();
let loadingCommits = new Set<string>();
let diffView: DiffView | null = null;
let lifecycleGeneration = 0;
let historyGeneration = 0;
let diffGeneration = 0;

function commitKey(commit: Commit): string {
  return `commit:${commit.hash}`;
}

function fileKey(commit: Commit, file: ChangedFile): string {
  return `file:${commit.hash}:${file.path}`;
}

function statusColor(status: string): OverlayColorSpec {
  if (status === "A") return "ui.file_status_added_fg";
  if (status === "D") return "ui.file_status_deleted_fg";
  if (status === "R") return "ui.file_status_renamed_fg";
  return "ui.file_status_modified_fg";
}

function commitEntry(commit: Commit): TextPropertyEntry {
  const files = filesByCommit.get(commit.hash);
  return {
    text: "",
    segments: [
      { text: commit.hash.slice(0, 7), style: { fg: "syntax.number" } },
      { text: `  ${commit.subject}` },
      ...(files
        ? [{ text: `  ${files.length}`, style: { fg: "syntax.comment" } }]
        : []),
    ],
  };
}

function fileEntry(file: ChangedFile): TextPropertyEntry {
  return {
    text: "",
    segments: [
      {
        text: `${file.status} `,
        style: { fg: statusColor(file.status), bold: true },
      },
      { text: file.path },
    ],
  };
}

function buildTree(): { nodes: TreeNode[]; keys: string[]; items: TreeItem[] } {
  const nodes: TreeNode[] = [];
  const keys: string[] = [];
  const items: TreeItem[] = [];
  for (const commit of commits) {
    nodes.push({ text: commitEntry(commit), depth: 0, hasChildren: true });
    keys.push(commitKey(commit));
    items.push({ kind: "commit", commit });

    const files = filesByCommit.get(commit.hash);
    if (files) {
      for (const file of files) {
        nodes.push({ text: fileEntry(file), depth: 1, hasChildren: false });
        keys.push(fileKey(commit, file));
        items.push({ kind: "file", commit, file });
      }
    } else if (loadingCommits.has(commit.hash)) {
      nodes.push({
        text: {
          text: "Loading files…",
          style: { fg: "syntax.comment", italic: true },
        },
        depth: 1,
        hasChildren: false,
      });
      keys.push(`loading:${commit.hash}`);
      items.push({ kind: "loading", commit });
    }
  }
  return { nodes, keys, items };
}

function panelSpec(): WidgetSpec {
  const tree = buildTree();
  treeItems = tree.items;
  const selectedIndex = selectedKey === null
    ? -1
    : tree.keys.indexOf(selectedKey);
  return {
    kind: "tree",
    key: TREE_KEY,
    nodes: tree.nodes,
    itemKeys: tree.keys,
    selectedIndex,
    expandedKeys: Array.from(expanded),
    checkable: false,
    itemHeight: 1,
    cardBorders: false,
    toggleOnClick: true,
    indentCols: 1,
  };
}

function publish(): void {
  if (!open) return;
  const spec = panelSpec();
  if (!mounted) {
    editor.mountSidebarSection(PANEL_ID, spec, "Commit Review", PANEL_ROWS, {
      closable: true,
      startBlurred: false,
      scope: ownerWindow === null ? "editor" : { window: ownerWindow },
    });
    mounted = true;
    return;
  }
  editor.updateFloatingWidget(PANEL_ID, spec);
  editor.widgetMutate(
    PANEL_ID,
    {
      kind: "setExpandedKeys",
      widgetKey: TREE_KEY,
      keys: Array.from(expanded),
    } satisfies WidgetMutation,
  );
}

function closeDiff(view: DiffView | null): void {
  if (!view) return;
  try {
    editor.closeCompositeBuffer(view.compositeId);
  } catch { /* Already closed. */ }
  try {
    editor.closeBuffer(view.oldBufferId);
  } catch { /* Already closed. */ }
  try {
    editor.closeBuffer(view.newBufferId);
  } catch { /* Already closed. */ }
}

function closeReview(): void {
  lifecycleGeneration++;
  historyGeneration++;
  diffGeneration++;
  if (mounted) editor.unmountFloatingWidget(PANEL_ID);
  closeDiff(diffView);
  open = false;
  opening = false;
  mounted = false;
  repoRoot = null;
  ownerWindow = null;
  commits = [];
  treeItems = [];
  selectedKey = null;
  expanded = new Set<string>();
  filesByCommit = new Map<string, ChangedFile[]>();
  loadingCommits = new Set<string>();
  diffView = null;
}

async function git(args: string[], cwd: string): Promise<SpawnResult> {
  return await editor.spawnProcess("git", args, cwd);
}

async function loadFiles(commit: Commit): Promise<void> {
  if (
    !open || repoRoot === null || filesByCommit.has(commit.hash) ||
    loadingCommits.has(commit.hash)
  ) return;
  const lifecycle = lifecycleGeneration;
  const history = historyGeneration;
  loadingCommits.add(commit.hash);
  publish();
  const result = await git([
    "show",
    "--format=",
    "--first-parent",
    "--no-renames",
    "--name-status",
    "-z",
    commit.hash,
  ], repoRoot);
  if (
    !open || lifecycle !== lifecycleGeneration || history !== historyGeneration
  ) return;
  loadingCommits.delete(commit.hash);
  if (result.exit_code !== 0) {
    editor.setStatus(
      `Commit Review: ${result.stderr.trim() || "Cannot read commit"}`,
    );
    publish();
    return;
  }
  filesByCommit.set(commit.hash, parseChangedFiles(result.stdout));
  publish();
}

async function loadCommits(): Promise<void> {
  if (!open || repoRoot === null) return;
  const lifecycle = lifecycleGeneration;
  const history = ++historyGeneration;
  const result = await git(
    ["log", "-n", "50", "-z", "--format=%H%x00%s"],
    repoRoot,
  );
  if (
    !open || lifecycle !== lifecycleGeneration || history !== historyGeneration
  ) return;
  if (result.exit_code !== 0) {
    editor.setStatus(
      `Commit Review: ${result.stderr.trim() || "Cannot read history"}`,
    );
    return;
  }
  commits = parseCommits(result.stdout);
  selectedKey = commits[0] ? commitKey(commits[0]) : null;
  expanded = new Set(commits[0] ? [commitKey(commits[0])] : []);
  filesByCommit.clear();
  loadingCommits.clear();
  publish();
  if (commits[0]) await loadFiles(commits[0]);
}

async function openReview(): Promise<void> {
  if (open || opening) return;
  opening = true;
  const lifecycle = ++lifecycleGeneration;
  const active = editor.getActiveBufferId();
  const info = editor.getBufferInfo(active);
  const path = info?.path || "";
  const cwd = path ? editor.pathDirname(path) : editor.getCwd();
  const result = await git(["rev-parse", "--show-toplevel"], cwd);
  if (lifecycle !== lifecycleGeneration) return;
  opening = false;
  if (result.exit_code !== 0) {
    editor.setStatus("Commit Review: Open a file in a Git repository");
    return;
  }
  repoRoot = result.stdout.trim();
  ownerWindow = info?.window_id ?? null;
  open = true;
  publish();
  await loadCommits();
}

function normalizedContent(content: string): string {
  if (!content) return "";
  return content.endsWith("\n") ? content : `${content}\n`;
}

function byteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdfff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

function startTask(task: Promise<void>): void {
  void task.catch((error: unknown) => {
    editor.setStatus(`Commit Review: ${String(error)}`);
  });
}

function declareSyntax(bufferId: number, content: string, path: string): void {
  if (!content) return;
  editor.setSyntaxRegions(bufferId, [{
    start: 0,
    end: byteLength(content),
    language: path,
    prefix: 0,
    streams: [],
  }]);
}

async function readRevision(
  revision: string | null,
): Promise<SpawnResult | null> {
  if (revision === null || repoRoot === null) return null;
  return await git(["show", revision], repoRoot);
}

async function openFileDiff(commit: Commit, file: ChangedFile): Promise<void> {
  if (!open || repoRoot === null) return;
  const lifecycle = lifecycleGeneration;
  const generation = ++diffGeneration;
  selectedKey = fileKey(commit, file);
  publish();

  const revisions = fileRevisions(commit.hash, file);
  const [oldResult, newResult] = await Promise.all([
    readRevision(revisions.oldRevision),
    readRevision(revisions.newRevision),
  ]);
  if (
    !open || lifecycle !== lifecycleGeneration || generation !== diffGeneration
  ) return;
  if (
    (oldResult && oldResult.exit_code !== 0) ||
    (newResult && newResult.exit_code !== 0)
  ) {
    const message = oldResult?.stderr.trim() || newResult?.stderr.trim() ||
      "Cannot read file versions";
    editor.setStatus(`Commit Review: ${message}`);
    return;
  }

  const oldContent = normalizedContent(oldResult?.stdout ?? "");
  const newContent = normalizedContent(newResult?.stdout ?? "");
  if (oldContent.includes("\0") || newContent.includes("\0")) {
    editor.setStatus(`Commit Review: ${file.path} is a binary file`);
    return;
  }
  const oldBuffer = await editor.createVirtualBuffer({
    name: `*${commit.hash.slice(0, 7)}^:${file.path}*`,
    mode: "normal",
    readOnly: true,
    editingDisabled: true,
    showLineNumbers: true,
    hiddenFromTabs: true,
    entries: [{ text: oldContent }],
  });
  const newBuffer = await editor.createVirtualBuffer({
    name: `*${commit.hash.slice(0, 7)}:${file.path}*`,
    mode: "normal",
    readOnly: true,
    editingDisabled: true,
    showLineNumbers: true,
    hiddenFromTabs: true,
    entries: [{ text: newContent }],
  });
  if (
    !open || lifecycle !== lifecycleGeneration || generation !== diffGeneration
  ) {
    editor.closeBuffer(oldBuffer.bufferId);
    editor.closeBuffer(newBuffer.bufferId);
    return;
  }
  declareSyntax(oldBuffer.bufferId, oldContent, file.path);
  declareSyntax(newBuffer.bufferId, newContent, file.path);
  const hunks: TsCompositeHunk[] = editor.computeLineDiff(
    oldContent,
    newContent,
  );
  const compositeId = await editor.createCompositeBuffer({
    name: `*${commit.hash.slice(0, 7)} ${file.path}*`,
    mode: "diff-view",
    layout: { type: "side-by-side", ratios: [0.5, 0.5], showSeparator: true },
    sources: [
      {
        bufferId: oldBuffer.bufferId,
        label: `PARENT · ${file.path}`,
        editable: false,
        style: { gutterStyle: "both" },
      },
      {
        bufferId: newBuffer.bufferId,
        label: `${commit.hash.slice(0, 7)} · ${file.path}`,
        editable: false,
        style: { gutterStyle: "both" },
      },
    ],
    hunks: hunks.length > 0 ? hunks : null,
    initialFocusHunk: hunks.length > 0 ? 0 : undefined,
  });
  if (
    !open || lifecycle !== lifecycleGeneration || generation !== diffGeneration
  ) {
    editor.closeCompositeBuffer(compositeId);
    editor.closeBuffer(oldBuffer.bufferId);
    editor.closeBuffer(newBuffer.bufferId);
    return;
  }
  const previous = diffView;
  diffView = {
    compositeId,
    oldBufferId: oldBuffer.bufferId,
    newBufferId: newBuffer.bufferId,
  };
  editor.showBuffer(compositeId);
  closeDiff(previous);
  editor.flushLayout();
  editor.setStatus(`${file.status} ${file.path} · n/p: next/previous change`);
}

function setExpanded(commit: Commit, value: boolean): void {
  const key = commitKey(commit);
  if (value) {
    expanded.add(key);
    startTask(loadFiles(commit));
  } else {
    expanded.delete(key);
  }
  publish();
}

registerHandler("gitReviewToggle", () => {
  if (open || opening) closeReview();
  else startTask(openReview());
});
registerHandler("gitReviewRefresh", () => {
  startTask(loadCommits());
});
editor.registerCommand(
  "Git Review: Toggle",
  "Show or hide commit review",
  "gitReviewToggle",
  null,
);
editor.registerCommand(
  "Git Review: Refresh",
  "Refresh commit history",
  "gitReviewRefresh",
  null,
);

editor.on("widget_event", (event) => {
  if (event.panel_id !== PANEL_ID || !open) return;
  const payload = (event.payload ?? {}) as {
    index?: unknown;
    key?: unknown;
    expanded?: unknown;
    via?: unknown;
  };
  if (event.event_type === "cancel") {
    mounted = false;
    closeReview();
    return;
  }
  if (event.event_type === "expand") {
    if (typeof payload.key !== "string") return;
    const commit = commits.find((candidate) =>
      commitKey(candidate) === payload.key
    );
    if (!commit) return;
    const value = typeof payload.expanded === "boolean"
      ? payload.expanded
      : !expanded.has(commitKey(commit));
    setExpanded(commit, value);
    return;
  }
  if (event.event_type !== "select" && event.event_type !== "activate") return;
  if (typeof payload.index !== "number") return;
  const item = treeItems[payload.index];
  if (!item || item.kind === "loading") return;
  selectedKey = item.kind === "commit"
    ? commitKey(item.commit)
    : fileKey(item.commit, item.file);
  if (item.kind === "commit") {
    if (event.event_type === "activate") {
      setExpanded(item.commit, !expanded.has(commitKey(item.commit)));
    }
    return;
  }
  if (event.event_type === "activate" || payload.via === "click") {
    startTask(openFileDiff(item.commit, item.file));
  }
});

editor.on("buffer_closed", (event) => {
  if (!diffView) return;
  const view = diffView;
  if (
    event.buffer_id === view.compositeId ||
    event.buffer_id === view.oldBufferId ||
    event.buffer_id === view.newBufferId
  ) {
    diffView = null;
    closeDiff(view);
  }
});
