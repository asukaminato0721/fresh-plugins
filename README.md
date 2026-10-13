# Fresh plugins

This repository contains plugins for [Fresh](https://github.com/sinelaw/fresh).

| Plugin | Description | Documentation |
| --- | --- | --- |
| Minimap | A code minimap on the right, with syntax colors and mouse navigation. | [Minimap](minimap/README.md) |
| Git Review | Review working changes, unsaved edits, staged changes, and commits. | [Git Review](git-review/README.md) |
| DAP | Debug with breakpoints, stepping, and a variable panel. | [DAP](dap/README.md) |
| Image Preview | Preview images with Chafa or ImageMagick. | [Image Preview](image-preview/README.md) |

## Install

Open the command palette with `Ctrl+P`. Run **Package: Install from URL**.
Enter one of these URLs:

```text
https://github.com/asukaminato0721/fresh-plugins#minimap
https://github.com/asukaminato0721/fresh-plugins#git-review
https://github.com/asukaminato0721/fresh-plugins#dap
https://github.com/asukaminato0721/fresh-plugins#image-preview
```

Restart Fresh after installation. DAP also requires Python 3, a debug adapter,
and adapter settings. See the [DAP configuration](dap/README.md#configure).

These plugins use existing plugin APIs. They require no editor changes.
The repository also contains packages from the upstream Fresh plugins repository.
