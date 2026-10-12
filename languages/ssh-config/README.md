# SSH Config language pack

OpenSSH client configuration highlighting for Fresh.
Highlights directive names, Host and Match blocks, comments, strings, numbers,
patterns, environment variables, and percent tokens. Directive names are case-insensitive.
Unknown directive names receive the same style as known directives; this is not a validator.

## Installation

1. Open the command palette with `Ctrl+P` and type `>`.
2. Select **Package: Install from https://github.com/sinelaw/fresh-plugins#languages/ssh-config**.
3. Enter `https://github.com/sinelaw/fresh-plugins#languages/ssh-config`.
4. Restart Fresh to load the package.

For local development, enter the absolute path to this package directory.

## File detection

The grammar handles `.ssh_config` files. The included script also detects:

- `~/.ssh/config` (and any path ending in `/.ssh/config`).
- Files named `ssh_config`, including `/etc/ssh/ssh_config`.

The script selects the grammar when a matching file has the `text` language.
It handles files open at startup, package reload, and newly opened files.
It preserves an existing language choice and does not change `config.json`.
Keep plugins enabled for this filename detection.

For an Include file in another directory, use **Set Language → ssh-config**.
Generic `config` and `.conf` files are not claimed. This package targets the SSH
client configuration, not `sshd_config`, authorized keys, or known hosts.
This is an optional package; it does not add built-in support to Fresh.

## Validation

Run `./validate.sh` with Python 3, `jsonschema`, and `PyYAML` installed.
Set `FRESH_PACKAGE_SCHEMA` to a local schema file to validate offline.
Run `node --test tests/detection.test.cjs` for file detection tests.
Open `examples/ssh_config` in Fresh to check highlighting.

## Reference and license

The standalone grammar follows [OpenSSH ssh_config(5)](https://man.openbsd.org/ssh_config).
Package code and grammar use the MIT license. See [LICENSE](LICENSE).
Related: [Fresh #3260](https://github.com/sinelaw/fresh/issues/3260).
