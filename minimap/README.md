# Minimap

Run **Minimap: Toggle** from the command palette. The plugin opens a narrow pane
to the right of the active editor. It follows the design of
[scroll.nvim](https://github.com/mihovilrak/scroll.nvim). Each Unicode Braille
cell covers two dot columns and four source lines. Each dot covers three text
columns. Long files scroll through the map instead of being compressed into one
screen.

Each cell uses the most common syntax color in its source area. The plugin
checks this color against the current theme background and raises low contrast.
Text without a syntax color uses the theme's muted line-number color. The
highlighted background shows the source viewport. An underline shows the source
cursor row.

Click a map row or drag the cursor through the map to scroll the source file.
Run **Minimap: Toggle** again to close the pane.

Fresh's plugin API cannot draw inside the right edge of an existing editor pane.
This plugin therefore uses a separate, narrow editor pane.
