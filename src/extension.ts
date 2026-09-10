import * as vscode from "vscode";
import { extractGraph } from "./parser/extractGraph";
import type {
  HostToWebviewMessage,
  SourceLoc,
  WebviewToHostMessage,
} from "./shared/graph";

const JS_LANGS = new Set(["javascript", "javascriptreact"]);

function isJsDocument(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
  return !!doc && JS_LANGS.has(doc.languageId);
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new StructureViewProvider(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("cuteCode.openStructureView", () => {
      provider.show();
    }),
    provider
  );
}

export function deactivate() {}

class StructureViewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  /** Keep parsing this doc even when the webview steals focus. */
  private trackedDocUri: vscode.Uri | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  show() {
    const preferred = this.resolveJsDocument();
    if (preferred) {
      this.trackedDocUri = preferred.uri;
    }

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      this.pushTrackedDocument();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "cuteCode.structureView",
      "Cute Code",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "media"),
        ],
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panelDisposables.push(
      this.panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
        void this.onMessage(msg);
      }),
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposePanelListeners();
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (isJsDocument(editor?.document)) {
          this.trackedDocUri = editor.document.uri;
          this.schedulePush();
        }
        // Ignore focus loss to the webview / non-JS editors — keep last graph.
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.trackedDocUri && e.document.uri.toString() === this.trackedDocUri.toString()) {
          this.schedulePush();
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (this.trackedDocUri && doc.uri.toString() === this.trackedDocUri.toString()) {
          this.trackedDocUri = undefined;
          this.pushTrackedDocument();
        }
      })
    );

    this.pushTrackedDocument();
  }

  private disposePanelListeners() {
    for (const d of this.panelDisposables) d.dispose();
    this.panelDisposables = [];
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private schedulePush() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.pushTrackedDocument(), 300);
  }

  private post(message: HostToWebviewMessage) {
    void this.panel?.webview.postMessage(message);
  }

  private resolveJsDocument(): vscode.TextDocument | undefined {
    const active = vscode.window.activeTextEditor?.document;
    if (isJsDocument(active)) return active;

    if (this.trackedDocUri) {
      const open = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === this.trackedDocUri!.toString()
      );
      if (isJsDocument(open)) return open;
    }

    return vscode.window.visibleTextEditors.map((e) => e.document).find(isJsDocument);
  }

  private pushTrackedDocument() {
    if (!this.panel) return;

    const doc = this.resolveJsDocument();
    if (!doc) {
      this.post({
        type: "setEmpty",
        reason: "Open a JavaScript file, then run Cute Code: Open Structure View.",
      });
      if (this.panel) this.panel.title = "Cute Code";
      return;
    }

    this.trackedDocUri = doc.uri;
    const base = doc.fileName.split(/[/\\]/).pop() ?? "file";
    if (this.panel) this.panel.title = `Cute Code · ${base}`;

    const result = extractGraph(doc.getText(), doc.fileName);
    if (!result.ok) {
      this.post({ type: "setError", error: result.error });
      return;
    }

    this.post({ type: "setGraph", graph: result.graph });
  }

  private async onMessage(msg: WebviewToHostMessage) {
    if (msg.type === "ready") {
      this.pushTrackedDocument();
      return;
    }

    if (msg.type === "selectNode" && msg.loc) {
      await revealLoc(msg.loc, this.trackedDocUri);
      return;
    }

    if (msg.type === "openImport") {
      await openImportSource(msg.source, this.trackedDocUri);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.css")
    );
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

  dispose() {
    this.panel?.dispose();
    this.disposePanelListeners();
  }
}

async function revealLoc(loc: SourceLoc, docUri?: vscode.Uri) {
  let editor = vscode.window.activeTextEditor;
  if (docUri) {
    const doc = await vscode.workspace.openTextDocument(docUri);
    editor = await vscode.window.showTextDocument(doc, {
      viewColumn: editor?.viewColumn ?? vscode.ViewColumn.One,
      preserveFocus: false,
    });
  }
  if (!editor) return;

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
    const suffixes = ["", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", "/index.js", "/index.jsx", "/index.ts", "/index.tsx"];
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

function getNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
