# Polkit rules highlighting

Use Fresh's JavaScript grammar for polkit `.rules` files.

## Installation

1. Open the command palette with `Ctrl+P` and type `>`.
2. Select **Package: Install from https://github.com/sinelaw/fresh-plugins#polkit**.
3. Enter `https://github.com/sinelaw/fresh-plugins#polkit`.
4. Restart Fresh to load the package.

For local development, enter the absolute path to this package directory.

The plugin detects files immediately inside `polkit-1/rules.d/` whose names end
in `.rules`. This includes `/etc/polkit-1/rules.d/` and
`/usr/share/polkit-1/rules.d/`, plus the same directory structure in a project.
It handles files open at startup, package reload, and newly opened files.

Only files with the `text` language are changed. Existing language choices are
preserved. Other `.rules` files, including udev rules, are not claimed.
The plugin does not modify `config.json` or execute policy files.

For a policy file outside these paths, use **Set Language → JavaScript**.
Keep plugins enabled for automatic detection.

## Validation

Run `node --test tests/detection.test.cjs` (Node.js 18 or later).
Open `examples/polkit-1/rules.d/50-example.rules` in Fresh to check highlighting.
The example is for editing only. Do not install it as a system policy.

## Reference and license

Polkit documents the rules format in [polkit(8)](https://polkit.pages.freedesktop.org/polkit/polkit.8.html).
The plugin is MIT licensed. See [LICENSE](LICENSE).
Related: [Fresh #3520](https://github.com/sinelaw/fresh/issues/3520).
