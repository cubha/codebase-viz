import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'
import type { IRGraph } from '@codebase-viz/types'
import type { DiagramSet } from '@codebase-viz/renderer'

interface ViewerParams {
  projectName: string
  routeCount: number
  tableCount: number
  diagrams: DiagramSet
  cachedAt?: number
}

interface ExportMessage {
  type: 'export'
  format: 'svg' | 'png' | 'md'
  data: string
  filename: string
}

export class CodeSightPanel {
  private static instance: CodeSightPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private disposables: vscode.Disposable[] = []
  private reanalyzeCallback: (() => void) | undefined

  private constructor(
    private readonly extensionUri: vscode.Uri,
    panel: vscode.WebviewPanel,
  ) {
    this.panel = panel
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
    this.panel.webview.onDidReceiveMessage(
      (msg: { type: string } & Partial<ExportMessage>) => {
        if (msg.type === 'export') {
          void this.handleExport(msg as ExportMessage)
        } else if (msg.type === 'reanalyze') {
          this.reanalyzeCallback?.()
        }
      },
      null,
      this.disposables,
    )
  }

  static getInstance(): CodeSightPanel | undefined {
    return CodeSightPanel.instance
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

  setReanalyzeCallback(cb: () => void): void {
    this.reanalyzeCallback = cb
  }

  showLoading(): void {
    this.panel.webview.html = this.buildLoadingHtml()
  }

  showError(message: string): void {
    this.panel.webview.html = this.buildErrorHtml(message)
  }

  triggerExport(format: 'png' | 'svg' | 'md'): void {
    this.panel.webview.postMessage({ type: 'triggerExport', format })
  }

  updateGraph(graph: IRGraph, diagrams: DiagramSet): void {
    this.panel.webview.html = this.buildViewerHtmlImpl({
      projectName: graph.projectName ?? path.basename(graph.repoRoot),
      routeCount: graph.nodes.filter(n => n.kind === 'route').length,
      tableCount: graph.nodes.filter(n => n.kind === 'table').length,
      diagrams,
    })
  }

  showCached(data: { projectName: string; routeCount: number; tableCount: number; diagrams: DiagramSet; savedAt: number }): void {
    this.panel.webview.html = this.buildViewerHtmlImpl({
      projectName: data.projectName,
      routeCount: data.routeCount,
      tableCount: data.tableCount,
      diagrams: data.diagrams,
      cachedAt: data.savedAt,
    })
  }

  private async handleExport(msg: ExportMessage): Promise<void> {
    const filterMap: Record<string, Record<string, string[]>> = {
      svg: { 'SVG Image': ['svg'] },
      png: { 'PNG Image': ['png'] },
      md: { Markdown: ['md'] },
    }
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri
    const defaultUri = workspaceUri
      ? vscode.Uri.joinPath(workspaceUri, msg.filename)
      : vscode.Uri.file(msg.filename)

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: filterMap[msg.format] ?? {},
    })
    if (uri === undefined) return

    let bytes: Uint8Array
    if (msg.format === 'png') {
      const b64 = msg.data.replace(/^data:image\/png;base64,/, '')
      bytes = Buffer.from(b64, 'base64')
    } else {
      bytes = Buffer.from(msg.data, 'utf8')
    }

    await vscode.workspace.fs.writeFile(uri, bytes)
    void vscode.window.showInformationMessage(`CodeSight: 저장 완료 — ${path.basename(uri.fsPath)}`)
  }

  private buildViewerHtmlImpl(params: ViewerParams): string {
    const webview = this.panel.webview
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mermaid.min.js'),
    )

    const viewerPath = path.join(this.extensionUri.fsPath, 'media', 'viewer.html')
    let template: string | undefined
    try {
      template = fs.readFileSync(viewerPath, 'utf8')
    } catch {
      template = undefined
    }

    const { projectName, routeCount, tableCount, diagrams, cachedAt } = params
    const cspSource = webview.cspSource

    const injection = [
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${cspSource}; style-src 'unsafe-inline'; font-src data:; img-src ${cspSource} data: blob:;">`,
      `<script>`,
      `window.__CODESIGHT_DIAGRAMS__ = ${JSON.stringify(diagrams)};`,
      `window.__CODESIGHT_META__ = ${JSON.stringify({ projectName, routeCount, tableCount, cachedAt })};`,
      `</script>`,
    ].join('\n')

    if (template !== undefined) {
      return template
        .replace('<head>', `<head>\n${injection}`)
        .replace(
          'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js',
          mermaidUri.toString(),
        )
        .replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/g, '')
    }

    return this.buildFallbackHtml(diagrams, projectName, mermaidUri.toString())
  }

  private buildLoadingHtml(): string {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>body{font-family:monospace;background:#060810;color:#86efac;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:14px;}
.dot{animation:blink 1.2s infinite alternate}@keyframes blink{to{opacity:.2}}</style></head>
<body><div>CodeSight: Analyzing project<span class="dot">...</span></div></body></html>`
  }

  private buildErrorHtml(message: string): string {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>body{font-family:monospace;background:#060810;color:#fb923c;padding:2rem;margin:0;font-size:13px;}
pre{background:#1a0800;padding:1rem;border-radius:4px;overflow:auto;border:1px solid #c2410c;}</style></head>
<body><div>Analysis failed</div><pre>${message}</pre></body></html>`
  }

  private buildFallbackHtml(diagrams: DiagramSet, projectName: string, mermaidSrc: string): string {
    const diagramsJson = JSON.stringify(diagrams)
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<script src="${mermaidSrc}"></script>
<style>
body{font-family:monospace;background:#060810;color:#e2e8f0;margin:0;padding:0;height:100vh;overflow:hidden;}
header{padding:0 24px;height:52px;background:rgba(6,8,16,.92);border-bottom:1px solid #162035;display:flex;align-items:center;gap:14px;}
.logo{font-size:15px;font-weight:700;color:#e2e8f0}.logo em{font-style:normal;color:#38bdf8}
.tabs{display:flex;padding:0 24px;background:rgba(6,8,16,.88);border-bottom:1px solid #162035;}
.tab{padding:13px 18px;font-size:11px;color:#475569;cursor:pointer;border-bottom:2px solid transparent;}
.tab.active{color:#38bdf8;border-bottom-color:#38bdf8;}
.panels{height:calc(100vh - 96px);}
.panel{display:none;height:100%;overflow:auto;padding:2rem;}
.panel.active{display:block;}
svg{max-width:100%;}
</style></head>
<body>
<header><div class="logo">Code<em>Sight</em></div><span style="font-size:11px;color:#475569">${projectName}</span></header>
<div class="tabs">
  <div class="tab active" onclick="switchTab(0)">Rendering Architecture</div>
  <div class="tab" onclick="switchTab(1)">Screen–Component</div>
  <div class="tab" onclick="switchTab(2)">DB–Screen</div>
</div>
<div class="panels">
  <div class="panel active" id="p0"><div id="d0">Rendering...</div></div>
  <div class="panel" id="p1"><div id="d1">Rendering...</div></div>
  <div class="panel" id="p2"><div id="d2">Rendering...</div></div>
</div>
<script>
const D = ${diagramsJson};
const keys = ['rendering','screenComponent','dbScreen'];
mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'dark',maxTextSize:1000000,maxEdges:2000});
async function renderAll(){
  for(let i=0;i<3;i++){
    try{const{svg}=await mermaid.render('m'+i,D[keys[i]]);document.getElementById('d'+i).innerHTML=svg;}
    catch(e){document.getElementById('d'+i).textContent='Render error: '+e.message;}
  }
}
function switchTab(i){
  document.querySelectorAll('.tab').forEach((t,j)=>t.classList.toggle('active',j===i));
  document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',j===i));
}
renderAll();
</script></body></html>`
  }

  private dispose(): void {
    CodeSightPanel.instance = undefined
    this.panel.dispose()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}
