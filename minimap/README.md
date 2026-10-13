# Minimap

Run **Minimap: Toggle** from the command palette. The plugin opens a narrow pane to the right of the active editor. Its map uses the full editor height. Each map row combines all source lines in its range, so dense and sparse parts of the file remain different after downsampling. It uses Fresh's syntax highlights to color sampled code. The vertical mark shows the current viewport.

Click a map row or move the cursor in the map to scroll the source file. Run **Minimap: Toggle** again to close the pane.

Fresh's plugin API cannot draw inside the right edge of an existing editor pane. This plugin therefore uses a separate, narrow editor pane. It also limits whole-file scans to 1 MiB.
