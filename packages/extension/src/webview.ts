import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'
import type { IRGraph } from '@codebase-viz/types'

export class CodeSightPanel {
  private static instance: CodeSightPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private disposables: vscode.Disposable[] = []

  private constructor(
    private readonly extensionUri: vscode.Uri,
    panel: vscode.WebviewPanel,
  ) {
    this.panel = panel
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
  }

  static createOrShow(extensionUri: vscode.Uri): CodeSightPanel {
    if (CodeSightPanel.instance !== undefined) {
      CodeSightPanel.instance.panel.reveal(vscode.ViewColumn.Beside)
      return CodeSightPanel.instance
    }

    const panel = vscode.window.createWebviewPanel(
      'codesight',
      'CodeSight',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    )

    CodeSightPanel.instance = new CodeSightPanel(extensionUri, panel)
    return CodeSightPanel.instance
  }

  static dispose(): void {
    CodeSightPanel.instance?.dispose()
  }

  showLoading(): void {
    this.panel.webview.html = this.buildHtml('<div class="loading">Analyzing project...</div>', undefined)
  }

  showError(message: string): void {
    this.panel.webview.html = this.buildHtml(`<div class="error">Error: ${message}</div>`, undefined)
  }

  updateGraph(graph: IRGraph): void {
    this.panel.webview.html = this.buildHtml(undefined, graph)
  }

  private buildHtml(statusHtml: string | undefined, graph: IRGraph | undefined): string {
    const graphJson = graph !== undefined ? JSON.stringify(graph) : 'null'

    // Try to load web-viewer template; fallback to inline
    const viewerPath = path.join(this.extensionUri.fsPath, '..', '..', 'web-viewer', 'index.html')
    let template: string | undefined
    try {
      template = fs.readFileSync(viewerPath, 'utf8')
    } catch {
      template = undefined
    }

    if (template !== undefined && graph !== undefined) {
      // Inject IR data into web-viewer template
      return template.replace(
        '</head>',
        `<script>window.__CODESIGHT_GRAPH__ = ${graphJson};</script></head>`,
      )
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeSight</title>
  <style>
    body { font-family: system-ui; background: #060810; color: #7dd3fc; padding: 2rem; }
    .loading { color: #86efac; font-size: 1.2rem; }
    .error { color: #fb923c; font-size: 1rem; }
    pre { background: #0c1a30; padding: 1rem; border-radius: 4px; overflow: auto; font-size: 0.75rem; }
  </style>
</head>
<body>
  ${statusHtml ?? ''}
  ${graph !== undefined ? `<pre>${JSON.stringify(graph, null, 2)}</pre>` : ''}
</body>
</html>`
  }

  private dispose(): void {
    CodeSightPanel.instance = undefined
    this.panel.dispose()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}
