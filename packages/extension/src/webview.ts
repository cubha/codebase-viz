import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as crypto from 'node:crypto'
import type { IRGraph } from '@codebase-viz/types'
import type { DiagramSet } from '@codebase-viz/renderer'
import { dictForLocale, resolveLocale } from './i18n/dict.js'
import { safeJson, escapeHtml } from './webview-escape.js'
import {
  isValidExportMessage,
  sanitizeExportFilename,
  isValidOpenNodeMessage,
  resolveWithinRoot,
  type ValidExportMessage,
} from './message-guard.js'

interface ViewerParams {
  projectName: string
  routeCount: number
  tableCount: number
  diagrams: DiagramSet
  cachedAt?: number
  repoRoot: string
  pairRepoRoot?: string
}

export class CodebaseVizPanel {
  private static instance: CodebaseVizPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private disposables: vscode.Disposable[] = []
  private lastParams?: ViewerParams

  private constructor(
    private readonly extensionUri: vscode.Uri,
    panel: vscode.WebviewPanel,
  ) {
    this.panel = panel
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
    this.panel.webview.onDidReceiveMessage(
      (msg: unknown) => {
        if (isValidExportMessage(msg)) {
          void this.handleExport(msg)
        } else if (isValidOpenNodeMessage(msg)) {
          void this.handleOpenNode(msg.id)
        } else if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as { type?: unknown }).type === 'reanalyze'
        ) {
          void vscode.commands.executeCommand('codebaseViz.reanalyze')
        }
      },
      null,
      this.disposables,
    )
  }

  static getInstance(): CodebaseVizPanel | undefined {
    return CodebaseVizPanel.instance
  }

  static createOrShow(extensionUri: vscode.Uri): CodebaseVizPanel {
    if (CodebaseVizPanel.instance !== undefined) {
      CodebaseVizPanel.instance.panel.reveal(vscode.ViewColumn.Beside)
      return CodebaseVizPanel.instance
    }

    const panel = vscode.window.createWebviewPanel(
      'codebaseViz',
      'Codebase Visualizer',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    )

    CodebaseVizPanel.instance = new CodebaseVizPanel(extensionUri, panel)
    return CodebaseVizPanel.instance
  }

  static dispose(): void {
    CodebaseVizPanel.instance?.dispose()
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

  async updateGraph(graph: IRGraph, diagrams: DiagramSet, pairRepoRoot?: string): Promise<void> {
    this.lastParams = {
      projectName: graph.projectName ?? path.basename(graph.repoRoot),
      routeCount: graph.nodes.filter(n => n.kind === 'route').length,
      tableCount: graph.nodes.filter(n => n.kind === 'table').length,
      diagrams,
      repoRoot: graph.repoRoot,
      ...(pairRepoRoot !== undefined ? { pairRepoRoot } : {}),
    }
    this.panel.webview.html = await this.buildViewerHtmlImpl(this.lastParams)
  }

  async showCached(
    data: { projectName: string; routeCount: number; tableCount: number; diagrams: DiagramSet; savedAt: number },
    repoRoot: string,
    pairRepoRoot?: string,
  ): Promise<void> {
    this.lastParams = {
      projectName: data.projectName,
      routeCount: data.routeCount,
      tableCount: data.tableCount,
      diagrams: data.diagrams,
      cachedAt: data.savedAt,
      repoRoot,
      ...(pairRepoRoot !== undefined ? { pairRepoRoot } : {}),
    }
    this.panel.webview.html = await this.buildViewerHtmlImpl(this.lastParams)
  }

  async refreshLocale(): Promise<void> {
    // language 설정 변경 시 캐시된 lastParams로 viewer를 새 locale로 다시 렌더.
    if (this.lastParams !== undefined) {
      this.panel.webview.html = await this.buildViewerHtmlImpl(this.lastParams)
    }
  }

  // T1 딥링크: 웹뷰가 보낸 sanitized id로 lastParams.diagrams.nodeMap을 조회해 소스로 점프한다.
  // 웹뷰는 경로를 전혀 공급하지 않는다 — id만 받고 파일경로는 확장이 자체 nodeMap에서 해석한다.
  private async handleOpenNode(id: string): Promise<void> {
    const params = this.lastParams
    if (params === undefined) return
    const nodeMap = params.diagrams.nodeMap
    // webview가 보낸 id는 신뢰 불가 — '__proto__'/'constructor' 등으로 프로토타입 체인을 조회해
    // entry가 undefined가 아닌 것처럼 보이는 것을 막기 위해 own-property만 허용한다.
    const entry = nodeMap !== undefined && Object.prototype.hasOwnProperty.call(nodeMap, id) ? nodeMap[id] : undefined
    if (entry === undefined) return // 명시적 no-op: nodeMap 미스(subgraph wrapper 등)는 조용히 무시
    const root = entry.r === 'pair' ? params.pairRepoRoot : params.repoRoot
    if (root === undefined) return
    const absPath = resolveWithinRoot(root, entry.f)
    if (absPath === undefined) return
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath))
      const line = Math.max(0, entry.l - 1)
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(line, 0, line, 0),
        viewColumn: vscode.ViewColumn.One,
      })
    } catch {
      // 파일 부재 등 — 잘못된 점프보다 무반응이 안전하다(Less is More).
    }
  }

  private async handleExport(msg: ValidExportMessage): Promise<void> {
    const filterMap: Record<string, Record<string, string[]>> = {
      svg: { 'SVG Image': ['svg'] },
      png: { 'PNG Image': ['png'] },
      md: { Markdown: ['md'] },
    }
    const filename = sanitizeExportFilename(msg.filename)
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri
    const defaultUri = workspaceUri
      ? vscode.Uri.joinPath(workspaceUri, filename)
      : vscode.Uri.file(filename)

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
    void vscode.window.showInformationMessage(`Codebase Viz: 저장 완료 — ${path.basename(uri.fsPath)}`)
  }

  private async buildViewerHtmlImpl(params: ViewerParams): Promise<string> {
    const webview = this.panel.webview
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mermaid.min.js'),
    )

    const viewerPath = path.join(this.extensionUri.fsPath, 'media', 'viewer.html')
    let template: string | undefined
    try {
      template = await fs.readFile(viewerPath, 'utf8')
    } catch {
      template = undefined
    }

    const { projectName, routeCount, tableCount, diagrams, cachedAt } = params
    const cspSource = webview.cspSource
    const setting = vscode.workspace.getConfiguration('codebaseViz').get<string>('language', 'auto')
    const locale = resolveLocale(setting, vscode.env.language)
    const dict = dictForLocale(locale)
    // 매 렌더마다 새 nonce — CSP script-src에서 'unsafe-inline'/'unsafe-eval'을 대체한다.
    // unsafe-eval 제거는 mermaid.min.js에 eval(/new Function( 사용이 없음을 grep + Playwright
    // 실측(tests/playwright/csp.spec.mjs)으로 확인한 뒤 적용했다(v1.2.58 ST3).
    const nonce = crypto.randomBytes(16).toString('base64')

    const injection = [
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${cspSource}; style-src 'unsafe-inline'; font-src data:; img-src ${cspSource} data: blob:;">`,
      `<script nonce="${nonce}">`,
      `window.__CODEBASE_VIZ_DIAGRAMS__ = ${safeJson(diagrams)};`,
      `window.__CODEBASE_VIZ_META__ = ${safeJson({ projectName, routeCount, tableCount, cachedAt })};`,
      `window.__CODEBASE_VIZ_I18N__ = ${safeJson(dict)};`,
      `</script>`,
    ].join('\n')

    if (template !== undefined) {
      return template
        .replace('<head>', `<head>\n${injection}`)
        .replace(
          '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>',
          `<script nonce="${nonce}" src="${mermaidUri.toString()}"></script>`,
        )
        .replace('<script>', `<script nonce="${nonce}">`)
        .replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/g, '')
    }

    return this.buildFallbackHtml(diagrams, projectName, mermaidUri.toString())
  }

  private buildLoadingHtml(): string {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>body{font-family:monospace;background:#060810;color:#86efac;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:14px;}
.dot{animation:blink 1.2s infinite alternate}@keyframes blink{to{opacity:.2}}</style></head>
<body><div>Codebase Viz: Analyzing project<span class="dot">...</span></div></body></html>`
  }

  private buildErrorHtml(message: string): string {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>body{font-family:monospace;background:#060810;color:#fb923c;padding:2rem;margin:0;font-size:13px;}
pre{background:#1a0800;padding:1rem;border-radius:4px;overflow:auto;border:1px solid #c2410c;}</style></head>
<body><div>Analysis failed</div><pre>${escapeHtml(message)}</pre></body></html>`
  }

  private buildFallbackHtml(diagrams: DiagramSet, projectName: string, mermaidSrc: string): string {
    const diagramsJson = safeJson(diagrams)
    const nonce = crypto.randomBytes(16).toString('base64')
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:;">
<script nonce="${nonce}" src="${mermaidSrc}"></script>
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
<header><div class="logo">Codebase <em>Visualizer</em></div><span style="font-size:11px;color:#475569">${escapeHtml(projectName)}</span></header>
<div class="tabs">
  <div class="tab active" data-tab-idx="0">Rendering Architecture</div>
  <div class="tab" data-tab-idx="1">Screen–Component</div>
  <div class="tab" data-tab-idx="2">Data Flow</div>
</div>
<div class="panels">
  <div class="panel active" id="p0"><div id="d0">Rendering...</div></div>
  <div class="panel" id="p1"><div id="d1">Rendering...</div></div>
  <div class="panel" id="p2"><div id="d2">Rendering...</div></div>
</div>
<script nonce="${nonce}">
const D = ${diagramsJson};
const keys = ['rendering','screenComponent','dbScreen'];
mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'dark',maxTextSize:1000000,maxEdges:2000,flowchart:{htmlLabels:false}});
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
document.querySelectorAll('[data-tab-idx]').forEach(el => {
  el.addEventListener('click', () => switchTab(parseInt(el.dataset.tabIdx, 10)));
});
renderAll();
</script></body></html>`
  }

  private dispose(): void {
    CodebaseVizPanel.instance = undefined
    this.panel.dispose()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}
