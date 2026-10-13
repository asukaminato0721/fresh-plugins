# RST Compose

Edit `.rst` and `.rest` files in a compose view inside Fresh. This plugin uses
existing editor APIs. It requires no editor changes or external programs. It
addresses [Fresh issue #2625](https://github.com/sinelaw/fresh/issues/2625).

## Install

Requires Fresh 0.5.3 or later.

1. Open the command palette with `Ctrl+P`.
2. Run **Package: Install from URL**.
3. Enter `https://github.com/asukaminato0721/fresh-plugins#rst-compose`.
4. Restart Fresh.

## Use

Open an RST file. Run **RST: Toggle Compose** from the command palette. Run the
same command to return to source view.

Compose edits the original buffer. Saving writes the original RST syntax.
Unsaved edits and undo update the decorations. Move the cursor into a span to
reveal its markup. Move it onto a title or bullet line to reveal that markup.

The plugin provides:

- Title styling with concealed underlines and optional overlines.
- Italic emphasis, bold emphasis, and colored inline literals.
- Bullet glyphs for `-`, `+`, and `*` list markers. Numbered lists retain their
  numbers.
- Styled quoted links. Embedded HTTP and HTTPS links retain their URLs for
  Fresh's link actions.
- Centered page layout, line wrapping, and hidden line numbers.
- Theme colors that follow the active theme, without a fixed background color.

Code blocks, doctests, comments, tables, and unknown directives keep their
source text. No directive runs a process or reads another file. Fresh 0.5.3's
Markdown handler also decorates other compose buffers. This plugin removes those
Markdown decorations from RST buffers. Markdown buffers remain available.

## Settings

Add these settings to Fresh's `config.json`:

```json
{
  "plugins": {
    "rst-compose": {
      "enabled": true,
      "settings": {
        "autoCompose": true,
        "pageWidth": 80,
        "hideLineNumbers": true
      }
    }
  }
}
```

`autoCompose` defaults to `false`. `pageWidth` uses the editor's language or
global page width when omitted. Set it to `0` to use the full pane.
`hideLineNumbers` defaults to `true`. A user setting pinned to the buffer still
wins.

## Scope

The parser follows the common syntax in the
[reStructuredText specification](https://docutils.sourceforge.io/docs/ref/rst/restructuredtext.html).
It is not a Docutils or Sphinx renderer. Inline spans must fit on one source
line. The plugin does not resolve named references, substitutions, or custom
roles. Title adornments leave an empty source row when concealed. Source
paragraphs keep their line breaks. Native wrapping follows the pane and page
width. It does not add hanging list indents. Compose enables wrapping in the
current pane. Wrapping remains enabled when you return to source view. Files
larger than 1 MiB retain source markup to limit parsing work.

## Development

Run the tests:

```sh
deno test --no-check --no-config rst-compose/tests/
```

Check types with Fresh's generated declarations. Do not copy those declarations
into this package. The tests cover the issue example, UTF-8 byte positions,
CRLF, protected blocks, escaped markup, links, cursor scopes, and stale
asynchronous reads. The plugin also received an interactive Fresh 0.5.3 check
for editing, saving, undo, cursor reveal, and source/compose switching.

## License

MIT. See [LICENSE](LICENSE).
