# Cute Code

VS Code extension that turns a JavaScript file into a **structural block graph**: functions, classes, methods, and imports as nodes; calls, parameters, and returns as edges.

V1 is **visual only** (editor → graph). The graph IR and webview message protocol reserve slots for future bidirectional edits (graph → source).

## Features

- **Title-bar toggle** on a `.js` / `.jsx` / `.mjs` / `.cjs` tab — hierarchy icon opens Cute Code in that same tab; code icon returns to the text editor
- Parses the file with Babel
- Blocks for module, functions, arrows, classes/methods, imports, exports, bindings, and call sites
- Declarations along the top; calls are separate blocks with a dashed **def** thread to the declaration
- Double-click a declaration to expand (bindings, nested decls, calls); double-click a call to jump to its definition
- `const` / `let` / `var` bindings thread into the calls that use them (scoped inside expanded functions)
- Class stacks with drag reorder (visual only)
- Click a block to reveal its source range in the other editor group (graph stays open)
- Auto-refresh on edit (300ms debounce)
- Parse errors shown in the graph tab with line/column when available

## Run (Extension Development Host)

1. `npm install`
2. `npm run build`
3. Open this folder in VS Code / Cursor
4. Press **F5** (launch config **Run Extension**) — a new Extension Development Host window opens
5. In **that** window, open `examples/sample.js`
6. Click the hierarchy icon in the editor title bar, or Command Palette → **Cute Code: Open Structure View**

The JS tab switches to the structure graph. Click a block to open/reveal source beside it. Click the code icon in the title bar to return to the text editor. If you only run the command in your normal window (without F5), the extension is not loaded.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Bundle extension host + webview |
| `npm run watch` | Rebuild on change |
| `npm test` | Extractor unit tests |

## Architecture

- `src/extension.ts` — custom text editor, title-bar toggle, editor sync, reveal-on-click
- `src/parser/extractGraph.ts` — Babel parse + structural extraction
- `src/shared/graph.ts` — Graph IR + host/webview messages (`setGraph`, `selectNode`, `ready`; reserved `applyEdit` / `graphChanged`)
- `src/webview/` — React Flow UI with dagre layout

## Bidirectional roadmap

Not in v1, but prepared:

- Stable node IDs and `loc` on every structural node
- Typed messages already include `applyEdit` / `graphChanged` stubs
- Future work: map graph ops back to AST ranges and apply `WorkspaceEdit`s

## License

MIT
