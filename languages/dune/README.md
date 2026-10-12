# Dune language pack

Syntax highlighting for `.dune` files in Fresh. No editor rebuild is required.

Stanzas, fields, actions, variables, comments, strings, and atoms.

## Installation

1. Open the command palette with `Ctrl+P` and type `>`.
2. Select **Package: Install from URL**.
3. Enter `https://github.com/sinelaw/fresh-plugins#languages/dune`.
4. Restart Fresh if the new grammar is not available.

For local development, enter the absolute path to this directory instead of the URL.
Select **Dune** with **Set Language** to use the grammar in an open buffer.

## File detection

The package registers `.dune` files through `fresh.grammar.extensions`.

The package manifest supports extensions, but it cannot register filename patterns.
Use the configuration below for standard Dune filenames.
The optional `ocaml` entry enables `.ocamlinit` with Fresh's existing OCaml grammar.
This package does not replace the OCaml grammar.

Merge these entries into the `languages` object in your Fresh configuration.
Preserve any existing entries and settings.
Use `.fresh/config.json` for settings that apply to one project.

```json
{
  "languages": {
    "dune": {
      "extensions": [
        "dune"
      ],
      "filenames": [
        "dune",
        "dune-project",
        "dune-workspace",
        "dune-workspace.*",
        "*.dune"
      ],
      "grammar": "Dune"
    },
    "ocaml": {
      "filenames": [
        ".ocamlinit"
      ],
      "grammar": "OCaml"
    }
  }
}
```

## Validation

Install Python 3, `jsonschema`, and `PyYAML`. Run `./validate.sh`.
The script checks the manifest against the official Fresh schema and checks the grammar structure.
Set `FRESH_PACKAGE_SCHEMA` to a local schema path for offline validation.

Install the package locally. Open `examples/example.dune` to check highlighting in Fresh.
Run **Show Warnings** to check for grammar errors.

## Scope

This package supplies a grammar and language settings. It does not install an LSP server or formatter.

## Attribution and license

The grammar is copied unchanged from [Fresh PR #3026](https://github.com/sinelaw/fresh/pull/3026),
by asukaminato0721, at commit `9b572ca385885bdd02adae20bed5471350a3763d`.
The package retains the source repository's GPL-2.0 license as `GPL-2.0-only`.
See [LICENSE](LICENSE) and [grammars/LICENSE](grammars/LICENSE).
