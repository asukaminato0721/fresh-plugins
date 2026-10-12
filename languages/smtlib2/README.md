# SMT-LIB 2 language pack

Syntax highlighting for `.smt2` files in Fresh. No editor rebuild is required.

Solver commands, declarations, sorts, attributes, quoted symbols, strings, bit-vector literals, numbers, operators, and comments. Includes common Z3 commands.

## Installation

1. Open the command palette with `Ctrl+P` and type `>`.
2. Select **Package: Install from URL**.
3. Enter `https://github.com/sinelaw/fresh-plugins#languages/smtlib2`.
4. Restart Fresh if the new grammar is not available.

For local development, enter the absolute path to this directory instead of the URL.
Select **SMT-LIB 2** with **Set Language** to use the grammar in an open buffer.

## File detection

The package registers `.smt2` files through `fresh.grammar.extensions`.

The package does not claim `.smt`, which SMT-LIB 1 uses.
Select **SMT-LIB 2** with the **Set Language** command for other filenames.
The built-in aliases from Fresh PR #3026 are not part of this package.

## Validation

Install Python 3, `jsonschema`, and `PyYAML`. Run `./validate.sh`.
The script checks the manifest against the official Fresh schema and checks the grammar structure.
Set `FRESH_PACKAGE_SCHEMA` to a local schema path for offline validation.

Install the package locally. Open `examples/constraints.smt2` to check highlighting in Fresh.
Run **Show Warnings** to check for grammar errors.

## Scope

This package supplies a grammar and language settings. It does not install an LSP server or formatter.

## Attribution and license

The grammar is copied unchanged from [Fresh PR #3026](https://github.com/sinelaw/fresh/pull/3026),
by asukaminato0721, at commit `9b572ca385885bdd02adae20bed5471350a3763d`.
The package retains the source repository's GPL-2.0 license as `GPL-2.0-only`.
See [LICENSE](LICENSE) and [grammars/LICENSE](grammars/LICENSE).
