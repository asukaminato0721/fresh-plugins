# DAP

This plugin adds a Debug Adapter Protocol (DAP) client to Fresh. It uses the
plugin APIs available on Fresh main. It requires no editor changes.

## Install

After this package merges, open the command palette with `Ctrl+P`. Run
**Package: Install from URL**. Enter:

```
https://github.com/sinelaw/fresh-plugins#dap
```

For a local checkout, enter the absolute path to its `dap` directory instead.
Restart Fresh after installation.

Install Python 3 and a debug adapter before you start a session. The plugin uses
`python3` for its communication bridge. Set `pythonCommand` in the package
settings if your Python executable has a different name.

## Configure

Create `.vscode/launch.json` in the workspace. This example debugs the active
Python file with debugpy:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: Current File",
      "type": "python",
      "request": "launch",
      "program": "${file}",
      "console": "internalConsole"
    }
  ]
}
```

Install debugpy in your Python environment. Add an adapter entry in the DAP
package settings:

```json
{
  "adapters": [
    {
      "type": "python",
      "command": "python3",
      "args": ["-m", "debugpy.adapter"]
    }
  ]
}
```

In Fresh's `config.json`, these settings belong under `plugins.dap.settings`.
For CodeLLDB, use an adapter entry with `"type": "lldb"` and
`"command": "/path/to/codelldb"`. The launch configuration must use the same
`type`.

Set `configuration` to select a launch configuration by name. The plugin selects
the first configuration if you omit this setting. Set `launchJson` to select a
different configuration file. The plugin accepts JSON comments and trailing
commas. It expands `${file}` and `${workspaceFolder}` in launch settings and
adapter commands.

## Use

Open a source file. Place the cursor on a line. Run **Debug: Toggle Breakpoint**
from the command palette. A red `●` marks the breakpoint. Fresh stores
breakpoints across restarts.

Run **Debug: Start**. When execution stops, Fresh opens the top stack frame. A
green `▶` marks the current source line. A variable panel opens on the right.
The source pane keeps keyboard focus.

The command palette also provides these commands:

- **Debug: Continue**
- **Debug: Pause**
- **Debug: Step Over**
- **Debug: Step Into**
- **Debug: Step Out**
- **Debug: Stop**
- **Debug: Variables**

The variable panel shows the scopes, names, values, and types for the top stack
frame. Select a row with the mouse or the arrow keys. Press `Enter` or `Space`
to expand or collapse it. `Right` expands a row. `Left` collapses it. Nested
objects load when you expand them. Scopes that the adapter marks as expensive
also load only when you expand them.

Press `r` in the panel to refresh. Press `q` to close it. Run **Debug:
Variables** to reopen it. A closed panel stays closed until you reopen it or
start another session.

Values refresh after each pause or step. Expanded rows remain expanded across
steps. The panel clears values when execution continues or the session ends.
Variable names, values, and types use the active theme colors. Variables are
read-only.

Save source files before debugging. Adapters usually execute the files on disk.
The plugin reports unsaved source changes when it sends breakpoints.

## Scope

This version supports one stdio adapter session at a time, with `launch` or
`attach`. It provides breakpoints, source navigation, pause, continue, stepping,
and variables for the top stack frame. It does not provide a stack-frame picker,
watch expressions, variable editing, or a debug console panel. Adapter output
goes to Fresh's diagnostic log. Use `internalConsole`. Adapter requests for
`runInTerminal` are unsupported.

The plugin starts the packaged Python bridge with `spawnBackgroundProcess`. It
writes requests through Fresh's file API. The bridge sends DAP frames to the
adapter and returns JSON lines through process events. Temporary files have
private directories. Session cleanup removes them and terminates the adapter.
The bridge also detects editor shutdown and an expired heartbeat. No duplex
process API or editor patch is required.

The client design references
[Fresh PR #2722](https://github.com/sinelaw/fresh/pull/2722). Its transport is
separate from that PR's editor changes.

## Test

Run these commands from the repository root:

```sh
python3 -B -m unittest discover -s dap/tests -p 'test_*.py'
deno test --allow-run --allow-read --allow-write dap/tests/plugin_test.ts
```

The tests use a local fake adapter. They require no external debug adapter.
