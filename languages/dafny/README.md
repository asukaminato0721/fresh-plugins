# Dafny language pack

Syntax highlighting for `.dfy` files in Fresh. No editor rebuild is required.

Declarations, verification clauses, nested comments, attributes, normal and verbatim strings, types, numbers, calls, and operators.

## Installation

1. Open the command palette with `Ctrl+P` and type `>`.
2. Select **Package: Install from URL**.
3. Enter `https://github.com/sinelaw/fresh-plugins#languages/dafny`.
4. Restart Fresh if the new grammar is not available.

For local development, enter the absolute path to this directory instead of the URL.
Select **Dafny** with **Set Language** to use the grammar in an open buffer.

## File detection

The package registers `.dfy` files through `fresh.grammar.extensions`.


## Validation

Install Python 3, `jsonschema`, and `PyYAML`. Run `./validate.sh`.
The script checks the manifest against the official Fresh schema and checks the grammar structure.
Set `FRESH_PACKAGE_SCHEMA` to a local schema path for offline validation.

Install the package locally. Open `examples/verified.dfy` to check highlighting in Fresh.
Run **Show Warnings** to check for grammar errors.

## Scope

This package supplies a grammar and language settings. It does not install an LSP server or formatter.

## Attribution and license

The grammar is copied unchanged from [Fresh PR #3026](https://github.com/sinelaw/fresh/pull/3026),
by asukaminato0721, at commit `9b572ca385885bdd02adae20bed5471350a3763d`.
The package retains the source repository's GPL-2.0 license as `GPL-2.0-only`.
See [LICENSE](LICENSE) and [grammars/LICENSE](grammars/LICENSE).
