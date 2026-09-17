# Cute Code

Visual structural AST view of JavaScript — functions, classes, calls, and returns as interconnected blocks.

## Install

1. Open the Extensions view in VS Code or Cursor
2. Search for **Cute Code** and install
3. Or install from a local package: `code --install-extension cute-code-0.3.0.vsix`

## Usage

1. Open a `.js`, `.jsx`, `.mjs`, or `.cjs` file
2. Click the hierarchy icon in the editor title bar, or run **Cute Code: Open Structure View** from the Command Palette
3. The tab switches to the structure graph
4. Click a block to reveal its source beside the graph
5. Click the code icon in the title bar (or run **Cute Code: Show Source**) to return to the text editor

## Features

- Same-tab structure view with a title-bar toggle back to source
- Parses the file with Babel
- Blocks for module, functions, arrows, classes/methods, imports, exports, bindings, and call sites
- Declarations along the top; calls are separate blocks with a dashed **def** thread to the declaration
- Expand declarations to see bindings, nested decls, and calls; jump from a call to its definition
- `const` / `let` / `var` bindings thread into the calls that use them
- Class stacks with drag reorder (visual only)
- Auto-refresh on edit (300ms debounce)
- Parse errors shown in the graph tab with line/column when available

Editing titles can write back to source. Broader graph → source edits are on the roadmap.

## Developing

1. `npm install`
2. `npm run build`
3. Open this folder in VS Code / Cursor
4. Press **F5** (launch config **Run Extension**)
5. In the Extension Development Host window, open `examples/sample.js`
6. Use the hierarchy icon or **Cute Code: Open Structure View**

If you run the command in your normal window (without F5), the extension is not loaded from this repo.

### Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Bundle extension host + webview |
| `npm run watch` | Rebuild on change |
| `npm test` | Unit tests |
| `npm run package` | Build a `.vsix` with `@vscode/vsce` |

### Architecture

- `src/extension.ts` — custom text editor, title-bar toggle, editor sync, reveal-on-click
- `src/parser/extractGraph.ts` — Babel parse + structural extraction
- `src/shared/graph.ts` — Graph IR + host/webview messages
- `src/webview/` — React Flow UI with dagre layout

## License

MIT
