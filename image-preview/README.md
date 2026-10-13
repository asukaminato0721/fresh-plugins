# Image Preview

Preview PNG, JPEG, GIF, WebP, BMP, TIFF, ICO, and AVIF files in Fresh. The
plugin displays colored Unicode cells in a read-only tab. It uses existing
plugin APIs and requires no editor changes.

## Install

Install [Chafa](https://hpjansson.org/chafa/) or
[ImageMagick](https://imagemagick.org/). The plugin tries `chafa` first, then
`magick`, then ImageMagick's `convert` command. You need only one renderer.

Open the command palette with `Ctrl+P`. Run **Package: Install from URL**. Enter
this URL:

```text
https://github.com/asukaminato0721/fresh-plugins#image-preview
```

Restart Fresh. Open an image file from the command line or the file explorer. A
preview tab opens automatically. The original file buffer remains available.

## Use

- **Image Preview: Show** previews the current image file.
- **Image Preview: Open** prompts for a local image path. Relative paths use the
  workspace directory.
- **Image Preview: Refresh** renders the image again after a change on disk.
- **Image Preview: View Bytes** returns to the original file buffer.
- **Image Preview: Close** closes the preview tab.

In a preview, press `r` to refresh, `b` to view the original bytes, or `q` to
close. Use **Image Preview: Show** to return from the original file to the
preview.

The image fits the current pane and keeps its aspect ratio. Resize the pane to
render it at the new size. The layout assumes a terminal cell ratio of 1:2.
Transparent pixels blend with the active theme's background color. Changing the
theme renders visible previews again. GIF and other animated images show a still
frame.

## Configure

Settings are optional. This example disables automatic previews and selects
ImageMagick. Put it in Fresh's `config.json`:

```json
{
  "plugins": {
    "image-preview": {
      "enabled": true,
      "settings": {
        "autoOpen": false,
        "renderer": "imagemagick"
      }
    }
  }
}
```

Set `renderer` to `auto`, `chafa`, or `imagemagick`. Use `chafaCommand` or
`magickCommand` to select an executable by name or absolute path. `maxWidth` and
`maxHeight` limit the image's size in character cells. Defaults are 200 columns
and 100 rows.

## Display

Chafa runs in `symbols` mode with full color. The plugin converts its ANSI color
codes into Fresh text overlays. ImageMagick provides RGB pixels instead. The
plugin pairs two pixel rows in each upper-half block (`▀`). Both paths keep
foreground and background colors, including black pixels.

The plugin disables terminal probing in Chafa 1.16 and newer. Chafa therefore
does not compete with Fresh for terminal input.

The preview uses character cells. It does not transmit Kitty, Sixel, or iTerm
graphics sequences. Those sequences do not pass through Fresh's text-buffer API.
Local files are supported. Inline Markdown images, remote URLs, and animation
playback are outside this version's scope.

## Test

Run from the repository root. The integration tests require ImageMagick.

```sh
deno test --no-check --allow-run --allow-read --allow-write image-preview/tests/
```

To test the Chafa renderer with a real executable, also set `CHAFA_TEST_COMMAND`
to its name or absolute path and add `--allow-env` to the test command.
