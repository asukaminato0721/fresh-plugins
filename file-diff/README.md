# File Diff Plugin for Fresh Editor

Side-by-side diff of **any two files on disk**. The baseline is a second file
you pick rather than a git revision, so it works on untracked files, scratch
notes, backups, config copies — anything, inside a repository or not.

## Install

From the command palette (Ctrl+P), run **`Package: Install from URL`** and give
it the repository with this plugin's subdirectory as the fragment:

```
https://github.com/sinelaw/fresh-plugins#file-diff
```

Or install it from the registry: run **`Package: Packages`**, find `file-diff`
in the list, and install it there — same package, and the browser shows what
else is available.

## Features

- **Any two paths** — no git, no repository, no index
- **Clickable file names** — swap either side without leaving the view
- **Several diffs at once** — each is its own tab with its own header, and its
  buttons act only on that diff
- **Real file buffers** as panes, so both sides get syntax highlighting, and
  `Enter` jumps from a diff line to that line of the file
- **Live**, not a snapshot: `Refresh` recomputes from the buffers as they
  currently stand, including edits you've made in the editor

## Usage

```
[ config.toml ][ config.toml.bak ]  4 changes          [ Swap ][ Refresh ][ Close ]
────────────────────────────────────────────────────────────────────────────────
 /etc/app/config.toml                  │ /home/me/config.toml.bak
   1 [server]                          │   1 [server]
   2 port = 8080                       │   2 port = 9090
```

The two file names in the header are buttons: click one to replace that side
with a file chosen from the editor's file browser.

Run **`Diff: Compare Two Files`** from the command palette (Ctrl+P) and pick
two files, or **`Diff: Compare Current File With`** to diff the file you're in
against one you pick.

### Commands

| Command | Description |
|---------|-------------|
| `Diff: Compare Two Files` | Pick two files and open them in a new diff |
| `Diff: Compare Current File With` | Diff the current file against one you pick |
| `Diff: Replace Left Side` | Pick a different file for the left pane |
| `Diff: Replace Right Side` | Pick a different file for the right pane |
| `Diff: Swap Sides` | Exchange the left and right files |
| `Diff: Refresh` | Recompute the diff |
| `Diff: Next Change` / `Diff: Previous Change` | Move between differing regions |
| `Diff: Open File At Cursor` | Open the focused pane's file at the cursor's line |
| `Diff: Close` | Close this diff |

### Keys (inside a diff)

| Key | Action |
|-----|--------|
| `n` / `p` | Next / previous change |
| `1` / `2` | Replace the left / right file |
| `s` | Swap sides |
| `r` | Refresh |
| `Enter` | Open the focused pane's file at this line |
| `q` | Close |

Ordinary motions and scrolling work as they do anywhere else.

## Scripting

The plugin exports an API, so a diff can be opened from the CLI, from
`init.ts`, or from another plugin:

```sh
fresh --cmd script run - <<'EOF'
return await editor.getPluginApi("file_diff").open("a.txt", "b.txt");
EOF
```

| Call | Result |
|------|--------|
| `open(left, right)` | Opens a new diff. Relative paths resolve against the working directory. Returns `{ id, hunks, error }` |
| `close(id?)` | Closes that diff, or the focused one |
| `list()` | `[{ id, left, right, hunks }]` for every open diff |

## Notes

- The panes are **read-only**; edit through the real file buffers, then
  `Refresh`.
- Files the plugin opened are closed again when the last diff showing them
  goes away. A file you already had open, or one with unsaved changes, is
  left alone.
- A tab's name is fixed when the diff is created. Replace a side and the
  header updates, but the tab keeps the name it was opened under.
- `Refresh` diffs the buffers, which is what the panes display. When a file
  changes on disk, the editor's own reload has to land first — if a refresh
  looks one edit behind, run it again.

## How it works

Both sides are opened as ordinary file buffers and handed to a **composite
buffer** in `side-by-side` layout, aligned by hunks from `computeLineDiff`
(the editor's native patience diff). The header is a one-line widget panel in
the same buffer group; the host hit-tests clicks against it and reports which
button was hit in which panel, which is what keeps several open diffs
independent of one another.

No `ops` string is passed with the hunks: that would classify each line as a
deletion *or* an addition and split a modified line across two rows. Leaving
it off lets the host pair the two sides positionally, so an edited line sits
beside its old self.
