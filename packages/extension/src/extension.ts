import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { CodeSightPanel } from './webview.js'
import { SidebarProvider, type StatusInfo } from './sidebarProvider.js'
import { PanelProvider } from './panelProvider.js'
import { runAnalysis } from './analyzer.js'
import { detectStack } from '@codebase-viz/llm'
import type { IRGraph } from '@codebase-viz/types'
import { setWasmDir } from '@codebase-viz/core'
import type { DiagramSet } from '@codebase-viz/renderer'

async function getStackStatus(workspaceRoot: string): Promise<Pick<StatusInfo, 'framework' | 'parsingLevel' | 'llmRecommended'>> {
  try {
    const stack = await detectStack(workspaceRoot)
    return {
      framework: stack.framework,
      parsingLevel: stack.parsingLevel,
      llmRecommended: stack.llmRecommended,
    }
  } catch {
    return {}
  }
}

interface DiagramCache {
  savedAt: number
  projectName: string
  routeCount: number
  tableCount: number
  diagrams: DiagramSet
}

let sidebarProvider: SidebarProvider | undefined
let panelProvider: PanelProvider | undefined

function readCache(repoRoot: string): DiagramCache | undefined {
  try {
    const file = path.join(repoRoot, '.codesight', 'cache.json')
    if (!fs.existsSync(file)) return undefined
    return JSON.parse(fs.readFileSync(file, 'utf8')) as DiagramCache
  } catch {
    return undefined
  }
}

function writeCache(repoRoot: string, graph: IRGraph, diagrams: DiagramSet): void {
  try {
    const dir = path.join(repoRoot, '.codesight')
    fs.mkdirSync(dir, { recursive: true })
    const data: DiagramCache = {
      savedAt: Date.now(),
      projectName: graph.projectName ?? path.basename(repoRoot),
      routeCount: graph.nodes.filter(n => n.kind === 'route').length,
      tableCount: graph.nodes.filter(n => n.kind === 'table').length,
      diagrams,
    }
    fs.writeFileSync(path.join(dir, 'cache.json'), JSON.stringify(data))
  } catch {
    // non-fatal
  }
}

async function doAnalyze(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  forceRefresh = false,
): Promise<void> {
  const config = vscode.workspace.getConfiguration('codesight')
  const enableLLM = config.get<boolean>('enableLLM', false)
  const model = config.get<string>('model', 'claude-sonnet-4-6')

  let apiKey: string | undefined
  if (enableLLM) {
    apiKey = await context.secrets.get('codesight.anthropicKey')
    if (apiKey === undefined || apiKey === '') {
      const action = await vscode.window.showWarningMessage(
        'CodeSight: LLM analysis enabled but no API key found. Set one first.',
        'Set API Key',
      )
      if (action === 'Set API Key') {
        await vscode.commands.executeCommand('codesight.setApiKey')
      }
      return
    }
  }

  const panel = CodeSightPanel.createOrShow(context.extensionUri)

  const stackStatus = await getStackStatus(workspaceRoot)

  if (!forceRefresh) {
    const cached = readCache(workspaceRoot)
    if (cached !== undefined) {
      panel.showCached(cached)
      sidebarProvider?.updateStatus({
        projectName: cached.projectName,
        cachedAt: cached.savedAt,
        routeCount: cached.routeCount,
        tableCount: cached.tableCount,
        analyzing: false,
        hasCache: true,
        ...stackStatus,
      })
      panelProvider?.setResult(cached)
      return
    }
  }

  try {
    sidebarProvider?.updateStatus({ analyzing: true, hasCache: false, ...stackStatus })
    panelProvider?.setAnalyzing(true, path.basename(workspaceRoot))
    panel.showLoading()

    const { graph, diagrams } = await runAnalysis(
      workspaceRoot,
      apiKey !== undefined ? { apiKey, model } : undefined,
    )
    writeCache(workspaceRoot, graph, diagrams)
    panel.updateGraph(graph, diagrams)

    const result = {
      projectName: graph.projectName ?? path.basename(workspaceRoot),
      routeCount: graph.nodes.filter(n => n.kind === 'route').length,
      tableCount: graph.nodes.filter(n => n.kind === 'table').length,
      cachedAt: Date.now(),
    }
    sidebarProvider?.updateStatus({ ...result, analyzing: false, hasCache: true, ...stackStatus })
    panelProvider?.setAnalyzing(false)
    panelProvider?.setResult(result)

    if (!enableLLM) {
      void vscode.window.showInformationMessage(
        'CodeSight: Static analysis complete. Enable LLM analysis for richer results.',
        'Set API Key',
      ).then(action => {
        if (action === 'Set API Key') {
          void vscode.commands.executeCommand('codesight.setApiKey')
        }
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    sidebarProvider?.updateStatus({ analyzing: false })
    panelProvider?.setAnalyzing(false)
    panelProvider?.log(`오류: ${message}`)
    void vscode.window.showErrorMessage(`CodeSight: Analysis failed — ${message}`)
    panel.showError(message)
  }
}

export function activate(context: vscode.ExtensionContext): void {
  setWasmDir(path.join(context.extensionPath, 'dist', 'wasm'))
  sidebarProvider = new SidebarProvider(context.extensionUri)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider),
  )

  panelProvider = new PanelProvider(context.extensionUri)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PanelProvider.viewType, panelProvider),
  )

  // Push initial status
  void (async () => {
    const hasApiKey = (await context.secrets.get('codesight.anthropicKey') ?? '') !== ''
    const llmEnabled = vscode.workspace.getConfiguration('codesight').get<boolean>('enableLLM', false)
    const workspaceRoot = getWorkspaceRoot()
    const cached = workspaceRoot !== undefined ? readCache(workspaceRoot) : undefined
    const stackStatus = workspaceRoot !== undefined ? await getStackStatus(workspaceRoot) : {}

    sidebarProvider?.updateStatus({
      hasApiKey,
      llmEnabled,
      hasCache: cached !== undefined,
      projectName: cached?.projectName,
      cachedAt: cached?.savedAt,
      routeCount: cached?.routeCount,
      tableCount: cached?.tableCount,
      ...stackStatus,
    })
  })()

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('codesight.enableLLM')) {
        const llmEnabled = vscode.workspace.getConfiguration('codesight').get<boolean>('enableLLM', false)
        sidebarProvider?.updateStatus({ llmEnabled })
      }
    }),
  )

  context.subscriptions.push(
    // 캐시 없을 때: 분석 실행
    vscode.commands.registerCommand('codesight.analyze', async () => {
      const workspaceRoot = getWorkspaceRoot()
      if (workspaceRoot === undefined) {
        void vscode.window.showErrorMessage('CodeSight: No workspace folder open.')
        return
      }
      await doAnalyze(context, workspaceRoot)
    }),

    // 캐시 있을 때: 강제 재분석
    vscode.commands.registerCommand('codesight.reanalyze', async () => {
      const workspaceRoot = getWorkspaceRoot()
      if (workspaceRoot === undefined) {
        void vscode.window.showErrorMessage('CodeSight: No workspace folder open.')
        return
      }
      await doAnalyze(context, workspaceRoot, true)
    }),

    // 캐시 있을 때: 웹뷰만 열기 (재분석 없음)
    vscode.commands.registerCommand('codesight.openViewer', async () => {
      const workspaceRoot = getWorkspaceRoot()
      if (workspaceRoot === undefined) return
      const cached = readCache(workspaceRoot)
      if (cached === undefined) {
        void vscode.window.showInformationMessage('CodeSight: No analysis cache. Run Analyze first.')
        return
      }
      const panel = CodeSightPanel.createOrShow(context.extensionUri)
      panel.showCached(cached)
    }),

    // 사이드바 Export 버튼 → 웹뷰에 triggerExport 전달
    vscode.commands.registerCommand('codesight.exportFromSidebar', (format: unknown) => {
      const fmt = format as 'png' | 'svg' | 'md'
      const panel = CodeSightPanel.getInstance()
      if (panel === undefined) {
        // 웹뷰가 열려있지 않으면 먼저 열고 export
        void vscode.commands.executeCommand('codesight.openViewer').then(() => {
          setTimeout(() => CodeSightPanel.getInstance()?.triggerExport(fmt), 800)
        })
        return
      }
      panel.triggerExport(fmt)
    }),

    vscode.commands.registerCommand('codesight.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your Anthropic API key',
        password: true,
        placeHolder: 'sk-ant-api03-...',
      })
      if (key !== undefined && key !== '') {
        await context.secrets.store('codesight.anthropicKey', key)
        sidebarProvider?.updateStatus({ hasApiKey: true })
        void vscode.window.showInformationMessage('CodeSight: API key saved securely.')
      }
    }),

    vscode.commands.registerCommand('codesight.clearApiKey', async () => {
      await context.secrets.delete('codesight.anthropicKey')
      sidebarProvider?.updateStatus({ hasApiKey: false })
      void vscode.window.showInformationMessage('CodeSight: API key cleared.')
    }),
  )
}

export function deactivate(): void {
  CodeSightPanel.dispose()
}

function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders
  if (folders === undefined || folders.length === 0) return undefined
  return folders[0]?.uri.fsPath
}
