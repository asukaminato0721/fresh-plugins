# Minimap

This plugin shows a compact map of the active file in the sidebar. The vertical mark shows the visible part of the file. Select a map row with the mouse to scroll to that part of the file. Press Enter on a selected row to return keyboard focus to the editor.

Run **Minimap: Toggle** from the command palette to show or hide the map. The map opens only when you run this command. Set **Plugin Settings → minimap → rows** to change its height. The default is 18 rows.

The plugin reads files up to 1 MiB. For a larger file, it shows a size message instead of scanning the file.
