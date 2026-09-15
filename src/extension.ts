import * as vscode from "vscode";
import { extractGraph } from "./parser/extractGraph";
import { tryTitleEdit } from "./parser/titleEdit";
import type {
  HostToWebviewMessage,
  SourceLoc,
  WebviewToHostMessage,
} from "./shared/graph";

const VIEW_TYPE = "cuteCode.structure";

function uriFromArgOrTab(uri?: vscode.Uri): vscode.Uri | undefined {
  if (uri instanceof vscode.Uri) return uri;
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  return vscode.window.activeTextEditor?.document.uri;
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new StructureEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand("cuteCode.openStructureView", async (uri?: vscode.Uri) => {
      const target = uriFromArgOrTab(uri);
      if (!target) {
        void vscode.window.showWarningMessage("Open a JavaScript file to show Cute Code.");
        return;
      }
      await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
    }),
    vscode.commands.registerCommand("cuteCode.showSource", async (uri?: vscode.Uri) => {
      const target = uriFromArgOrTab(uri);
      if (!target) {
        void vscode.window.showWarningMessage("No file to show as source.");
        return;
      }
      await vscode.commands.executeCommand("vscode.openWith", target, "default");
    })
  );
}

export function deactivate() {}

class StructureEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webviewPanel.webview.html = getHtml(this.context.extensionUri, webviewPanel.webview);

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let suppressDocPushUntil = 0;

    const post = (message: HostToWebviewMessage) => {
      void webviewPanel.webview.postMessage(message);
    };

    const pushGraph = () => {
      const result = extractGraph(document.getText(), document.fileName);
      if (!result.ok) {
        post({ type: "setError", error: result.error });
        return;
      }
      post({ type: "setGraph", graph: result.graph });
    };

    const schedulePush = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (Date.now() < suppressDocPushUntil) return;
        pushGraph();
      }, 300);
    };

    const renameTitle = async (nodeId: string, nameLoc: SourceLoc, newText: string) => {
      if (newText.length === 0) {
        post({
          type: "renameTitleResult",
          ok: false,
          nodeId,
          message: "Title cannot be empty.",
        });
        return;
      }

      const preview = tryTitleEdit(document.getText(), nameLoc, newText, document.fileName);
      if (!preview.ok) {
        post({
          type: "renameTitleResult",
          ok: false,
          nodeId,
          message: preview.error.message,
        });
        return;
      }

      const start = new vscode.Position(
        Math.max(0, nameLoc.startLine - 1),
        nameLoc.startCol
      );
      const end = new vscode.Position(Math.max(0, nameLoc.endLine - 1), nameLoc.endCol);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(start, end), newText);

      suppressDocPushUntil = Date.now() + 500;
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        suppressDocPushUntil = 0;
        post({
          type: "renameTitleResult",
          ok: false,
          nodeId,
          message: "Could not apply edit to the document.",
        });
        return;
      }

      post({
        type: "renameTitleResult",
        ok: true,
        nodeId,
        graph: preview.graph,
      });
    };

    const subs: vscode.Disposable[] = [
      webviewPanel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
        void (async () => {
          if (msg.type === "ready") {
            pushGraph();
            return;
          }
          if (msg.type === "selectNode" && msg.loc) {
            await revealLoc(msg.loc, document.uri);
            return;
          }
          if (msg.type === "openImport") {
            await openImportSource(msg.source, document.uri);
            return;
          }
          if (msg.type === "renameTitle") {
            await renameTitle(msg.nodeId, msg.nameLoc, msg.newText);
          }
        })();
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== document.uri.toString()) return;
        if (Date.now() < suppressDocPushUntil) return;
        schedulePush();
      }),
    ];

    webviewPanel.onDidDispose(() => {
      for (const d of subs) d.dispose();
      if (debounceTimer) clearTimeout(debounceTimer);
    });
  }
}

/** Reveal a range in a text editor of the same URI, opening beside if needed. */
async function revealLoc(loc: SourceLoc, docUri: vscode.Uri) {
  const doc = await vscode.workspace.openTextDocument(docUri);
  const existing = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === docUri.toString()
  );
  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: existing?.viewColumn ?? vscode.ViewColumn.Beside,
    preserveFocus: true,
    preview: true,
  });

  const start = new vscode.Position(Math.max(0, loc.startLine - 1), loc.startCol);
  const end = new vscode.Position(Math.max(0, loc.endLine - 1), loc.endCol);
  const range = new vscode.Range(start, end);
  editor.selection = new vscode.Selection(start, start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

async function openImportSource(source: string, fromDoc?: vscode.Uri) {
  const trimmed = source.trim();
  if (!trimmed) {
    void vscode.window.showWarningMessage("Import has no module path.");
    return;
  }

  // Relative / absolute path from the active graph file
  if (trimmed.startsWith(".") || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    if (!fromDoc) {
      void vscode.window.showWarningMessage("No source file to resolve the import from.");
      return;
    }
    const dir = vscode.Uri.joinPath(fromDoc, "..");
    const bases = [trimmed, trimmed.replace(/\/$/, "")];
    const suffixes = [
      "",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".ts",
      ".tsx",
      "/index.js",
      "/index.jsx",
      "/index.ts",
      "/index.tsx",
    ];
    for (const base of bases) {
      for (const suffix of suffixes) {
        const candidate = vscode.Uri.joinPath(dir, base + suffix);
        try {
          const stat = await vscode.workspace.fs.stat(candidate);
          if (stat.type === vscode.FileType.File) {
            const doc = await vscode.workspace.openTextDocument(candidate);
            await vscode.window.showTextDocument(doc, { preview: false });
            return;
          }
        } catch {
          // try next
        }
      }
    }
    void vscode.window.showWarningMessage(`Could not find file for import "${trimmed}".`);
    return;
  }

  // Bare package specifier — best-effort search under node_modules
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage(
      `Package import "${trimmed}" — open a workspace to resolve node_modules.`
    );
    return;
  }
  const pkgCandidates = [
    `node_modules/${trimmed}.js`,
    `node_modules/${trimmed}/index.js`,
    `node_modules/${trimmed}/package.json`,
  ];
  for (const rel of pkgCandidates) {
    const uri = vscode.Uri.joinPath(folder.uri, rel);
    try {
      await vscode.workspace.fs.stat(uri);
      if (rel.endsWith("package.json")) {
        const raw = await vscode.workspace.fs.readFile(uri);
        const pkg = JSON.parse(Buffer.from(raw).toString("utf8")) as {
          main?: string;
          module?: string;
        };
        const entry = pkg.module ?? pkg.main ?? "index.js";
        const entryUri = vscode.Uri.joinPath(uri, "..", entry);
        const doc = await vscode.workspace.openTextDocument(entryUri);
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      return;
    } catch {
      // try next
    }
  }
  void vscode.window.showWarningMessage(`Could not open package import "${trimmed}".`);
}

function getHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview.css"));
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Cute Code</title>
  <style>
    html, body, #root { height: 100%; width: 100%; margin: 0; background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #ccc); }
    #boot { padding: 24px; font-family: var(--vscode-font-family, sans-serif); }
  </style>
</head>
<body>
  <div id="root"><div id="boot">Loading Cute Code…</div></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
