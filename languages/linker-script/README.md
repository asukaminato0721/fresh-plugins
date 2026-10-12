# Linker Script language pack

GNU linker script highlighting for `.ld` and `.lds` files.
Supports commands, symbols, the location counter, integer literals, and block comments.

## Installation

1. Open the command palette with `Ctrl+P` and type `>`.
2. Select **Package: Install from https://github.com/sinelaw/fresh-plugins#languages/linker-script**.
3. Enter `https://github.com/sinelaw/fresh-plugins#languages/linker-script`.
4. Restart Fresh to load the package.

For local development, enter the absolute path to this package directory.

Use **Set Language → Linker Script** for scripts with other filenames.
This package provides highlighting. It does not run the linker.

## Validation

Run `./validate.sh` with Python 3, `jsonschema`, and `PyYAML` installed.
Set `FRESH_PACKAGE_SCHEMA` to a local schema file to validate offline.
Open `examples/memory.ld` in Fresh to check highlighting.

## Attribution

The grammar is adapted from [jbw3/SublimeTextLinkerSyntax](https://github.com/jbw3/SublimeTextLinkerSyntax)
at commit `041d15667eca429afd4ff3df3b8f8617a66fc410` (MIT).
Changes add `.lds` detection and common GNU ld commands.
The upstream copyright and license are in [grammars/LICENSE](grammars/LICENSE).
Package code is MIT licensed. See [LICENSE](LICENSE).

Related: [Fresh #3268](https://github.com/sinelaw/fresh/issues/3268).
