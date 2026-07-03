import * as vscode from 'vscode'
import * as path from 'node:path'
import { CodebaseVizPanel } from './webview.js'
import { SidebarProvider, type StatusInfo } from './sidebarProvider.js'
import { PanelProvider } from './panelProvider.js'
import { runAnalysis } from './analyzer.js'
import { resolveSelectedFolder } from './folder-utils.js'
import { readDiagramCache, writeDiagramCache, type DiagramCache } from './diagram-cache.js'
import { detectStack, DEFAULT_LLM_PROVIDER, type LLMProvider } from '@codebase-viz/llm'
import type { IRGraph } from '@codebase-viz/types'
import { t, resolveLocale } from './i18n/dict.js'

function getLocale() {
  const setting = vscode.workspace.getConfiguration('codebaseViz').get<string>('language', 'auto')
  return resolveLocale(setting, vscode.env.language)
}

function getProvider(): LLMProvider {
  const val = vscode.workspace.getConfiguration('codebaseViz').get<string>('llm.provider', DEFAULT_LLM_PROVIDER)
  if (val === 'google' || val === 'openai') return val
  return DEFAULT_LLM_PROVIDER
}

function apiKeySlot(provider: LLMProvider): string {
  return `codebaseViz.llm.apiKey.${provider}`
}
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

let sidebarProvider: SidebarProvider | undefined
let panelProvider: PanelProvider | undefined

const STATE_KEY_SELECTED_FOLDER = 'codebaseViz.selectedFolder'

function listWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
  return vscode.workspace.workspaceFolders ?? []
}

function getWorkspaceRoot(context?: vscode.ExtensionContext): string | undefined {
  const folders = listWorkspaceFolders()
  const saved = context?.workspaceState.get<string>(STATE_KEY_SELECTED_FOLDER)
  return resolveSelectedFolder(folders, saved)
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = listWorkspaceFolders()
  if (folders.length === 0) return undefined
  if (folders.length === 1) return folders[0]
  const items = folders.map(f => ({ label: f.name, description: f.uri.fsPath, folder: f }))
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t('pick.selectWorkspace', getLocale()),
  })
  return picked?.folder
}

function buildFolderList(): { name: string; fsPath: string }[] {
  return listWorkspaceFolders().map(f => ({ name: f.name, fsPath: f.uri.fsPath }))
}

async function pickPairFolder(mainFsPath: string): Promise<string | undefined> {
  const others = listWorkspaceFolders().filter(f => f.uri.fsPath !== mainFsPath)
  if (others.length === 0) return undefined

  const SKIP_LABEL = '$(close) Skip — single project only'
  const items: { label: string; description?: string; fsPath?: string }[] = [
    { label: SKIP_LABEL },
    ...await Promise.all(others.map(async f => {
      let description = f.uri.fsPath
      try {
        const stack = await detectStack(f.uri.fsPath)
        description = `${stack.framework} · ${f.uri.fsPath}`
      } catch { /* ignore */ }
      return { label: f.name, description, fsPath: f.uri.fsPath }
    })),
  ]

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t('pick.selectPair', getLocale()),
  })
  if (picked === undefined || picked.label === SKIP_LABEL) return undefined
  return picked.fsPath
}

async function readCache(repoRoot: string, pairRepoRoot?: string): Promise<DiagramCache | undefined> {
  return readDiagramCache(repoRoot, pairRepoRoot)
}

async function writeCache(repoRoot: string, graph: IRGraph, diagrams: DiagramSet, pairRepoRoot?: string): Promise<void> {
  const data: DiagramCache = {
    savedAt: Date.now(),
    projectName: graph.projectName ?? path.basename(repoRoot),
    routeCount: graph.nodes.filter(n => n.kind === 'route').length,
    tableCount: graph.nodes.filter(n => n.kind === 'table').length,
    diagrams,
  }
  await writeDiagramCache(repoRoot, data, pairRepoRoot)
}

async function doAnalyze(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  forceRefresh = false,
  pairRepoRoot?: string,
): Promise<void> {
  const config = vscode.workspace.getConfiguration('codebaseViz')
  const enableLLM = config.get<boolean>('enableLLM', false)
  // codebaseViz.model default는 ""(빈 문자열) — 사용자가 명시 지정한 경우만 전달.
  // 빈 문자열은 llm/client.ts의 provider별 DEFAULT_MODELS로 fallback.
  const modelRaw = config.get<string>('model', '')
  const model = modelRaw.trim().length > 0 ? modelRaw.trim() : undefined
  const provider = getProvider()

  let apiKey: string | undefined
  if (enableLLM) {
    apiKey = await context.secrets.get(apiKeySlot(provider))
    if (apiKey === undefined || apiKey === '') {
      const setKeyLabel = t('msg.btnSetApiKey', getLocale())
      const action = await vscode.window.showWarningMessage(
        t('msg.llmNoApiKey', getLocale()),
        setKeyLabel,
      )
      if (action === setKeyLabel) {
        await vscode.commands.executeCommand('codebaseViz.setApiKey')
      }
      return
    }
  }

  const panel = CodebaseVizPanel.createOrShow(context.extensionUri)

  const stackStatus = await getStackStatus(workspaceRoot)

  if (!forceRefresh) {
    const cached = await readCache(workspaceRoot, pairRepoRoot)
    if (cached !== undefined) {
      await panel.showCached(cached)
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

    const groupingCfg = vscode.workspace.getConfiguration('codebaseViz.grouping')
    const grouping = {
      maxNodesPerGroup: groupingCfg.get<number>('maxNodesPerGroup', 30),
      maxDepth: groupingCfg.get<number>('maxDepth', 8),
    }
    const { graph, diagrams } = await runAnalysis(workspaceRoot, {
      ...(apiKey !== undefined ? { llm: { apiKey, ...(model !== undefined ? { model } : {}), provider } } : {}),
      grouping,
      ...(pairRepoRoot !== undefined ? { pairRepoRoot } : {}),
    })
    await writeCache(workspaceRoot, graph, diagrams, pairRepoRoot)
    await panel.updateGraph(graph, diagrams)

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
      const setKeyLabel = t('msg.btnSetApiKey', getLocale())
      void vscode.window.showInformationMessage(
        t('msg.staticComplete', getLocale()),
        setKeyLabel,
      ).then(action => {
        if (action === setKeyLabel) {
          void vscode.commands.executeCommand('codebaseViz.setApiKey')
        }
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    sidebarProvider?.updateStatus({ analyzing: false })
    panelProvider?.setAnalyzing(false)
    panelProvider?.log(t('panel.error', getLocale(), { message }))
    void vscode.window.showErrorMessage(t('msg.analysisFailed', getLocale(), { message }))
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
    const hasApiKey = (await context.secrets.get(apiKeySlot(getProvider())) ?? '') !== ''
    const llmEnabled = vscode.workspace.getConfiguration('codebaseViz').get<boolean>('enableLLM', false)
    const workspaceRoot = getWorkspaceRoot(context)
    const cached = workspaceRoot !== undefined ? await readCache(workspaceRoot) : undefined
    const stackStatus = workspaceRoot !== undefined ? await getStackStatus(workspaceRoot) : {}

    sidebarProvider?.updateStatus({
      hasApiKey,
      llmEnabled,
      provider: getProvider(),
      hasCache: cached !== undefined,
      projectName: cached?.projectName,
      cachedAt: cached?.savedAt,
      routeCount: cached?.routeCount,
      tableCount: cached?.tableCount,
      folders: buildFolderList(),
      selectedFolder: workspaceRoot,
      ...stackStatus,
    })
  })()

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const root = getWorkspaceRoot(context)
      sidebarProvider?.updateStatus({
        folders: buildFolderList(),
        selectedFolder: root,
      })
    }),
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('codebaseViz.enableLLM')) {
        const llmEnabled = vscode.workspace.getConfiguration('codebaseViz').get<boolean>('enableLLM', false)
        sidebarProvider?.updateStatus({ llmEnabled })
      }
      if (e.affectsConfiguration('codebaseViz.llm.provider')) {
        const provider = getProvider()
        void context.secrets.get(apiKeySlot(provider)).then(key => {
          sidebarProvider?.updateStatus({ provider, hasApiKey: (key ?? '') !== '' })
        })
      }
      // language 변경 시 모든 webview를 새 locale로 즉시 다시 렌더 (reload 불필요).
      if (e.affectsConfiguration('codebaseViz.language')) {
        sidebarProvider?.refreshLocale()
        void CodebaseVizPanel.getInstance()?.refreshLocale()
      }
    }),
  )

  context.subscriptions.push(
    // 캐시 없을 때: 분석 실행 (multi-root 시 2단계 QuickPick)
    vscode.commands.registerCommand('codebaseViz.analyze', async () => {
      const workspaceRoot = getWorkspaceRoot(context)
      if (workspaceRoot === undefined) {
        void vscode.window.showErrorMessage(t('msg.noWorkspace', getLocale()))
        return
      }
      const pairRepoRoot = await pickPairFolder(workspaceRoot)
      await doAnalyze(context, workspaceRoot, false, pairRepoRoot)
    }),

    // 캐시 있을 때: 강제 재분석 (multi-root 시 2단계 QuickPick)
    vscode.commands.registerCommand('codebaseViz.reanalyze', async () => {
      const workspaceRoot = getWorkspaceRoot(context)
      if (workspaceRoot === undefined) {
        void vscode.window.showErrorMessage(t('msg.noWorkspace', getLocale()))
        return
      }
      const pairRepoRoot = await pickPairFolder(workspaceRoot)
      await doAnalyze(context, workspaceRoot, true, pairRepoRoot)
    }),

    // 캐시 있을 때: 웹뷰만 열기 (재분석 없음)
    vscode.commands.registerCommand('codebaseViz.openViewer', async () => {
      const workspaceRoot = getWorkspaceRoot(context)
      if (workspaceRoot === undefined) return
      const cached = await readCache(workspaceRoot)
      if (cached === undefined) {
        void vscode.window.showInformationMessage(t('msg.noCacheRunFirst', getLocale()))
        return
      }
      const panel = CodebaseVizPanel.createOrShow(context.extensionUri)
      await panel.showCached(cached)
    }),

    // 멀티 워크스페이스: 폴더 선택
    vscode.commands.registerCommand('codebaseViz.selectFolder', async (fsPath?: unknown) => {
      let target: vscode.WorkspaceFolder | undefined
      if (typeof fsPath === 'string') {
        target = listWorkspaceFolders().find(f => f.uri.fsPath === fsPath)
      }
      if (target === undefined) {
        target = await pickWorkspaceFolder()
      }
      if (target === undefined) return
      await context.workspaceState.update(STATE_KEY_SELECTED_FOLDER, target.uri.fsPath)
      const cached = await readCache(target.uri.fsPath)
      const stackStatus = await getStackStatus(target.uri.fsPath)
      sidebarProvider?.updateStatus({
        selectedFolder: target.uri.fsPath,
        folders: buildFolderList(),
        hasCache: cached !== undefined,
        projectName: cached?.projectName,
        cachedAt: cached?.savedAt,
        routeCount: cached?.routeCount,
        tableCount: cached?.tableCount,
        ...stackStatus,
      })
    }),

    // 사이드바 Export 버튼 → 웹뷰에 triggerExport 전달
    vscode.commands.registerCommand('codebaseViz.exportFromSidebar', (format: unknown) => {
      const fmt = format as 'png' | 'svg' | 'md'
      const panel = CodebaseVizPanel.getInstance()
      if (panel === undefined) {
        // 웹뷰가 열려있지 않으면 먼저 열고 export
        void vscode.commands.executeCommand('codebaseViz.openViewer').then(() => {
          setTimeout(() => CodebaseVizPanel.getInstance()?.triggerExport(fmt), 800)
        })
        return
      }
      panel.triggerExport(fmt)
    }),

    vscode.commands.registerCommand('codebaseViz.setApiKey', async () => {
      const provider = getProvider()
      const locale = getLocale()
      const providerLabel = provider === 'google' ? 'Google Gemini' : provider === 'openai' ? 'OpenAI' : 'Anthropic'
      const placeholderMap: Record<LLMProvider, string> = {
        anthropic: 'sk-ant-api03-...',
        google: 'AIza...',
        openai: 'sk-...',
      }
      const key = await vscode.window.showInputBox({
        prompt: t('msg.setApiKeyPrompt', locale, { provider: providerLabel }),
        password: true,
        placeHolder: placeholderMap[provider],
      })
      if (key !== undefined && key !== '') {
        await context.secrets.store(apiKeySlot(provider), key)
        sidebarProvider?.updateStatus({ hasApiKey: true })
        void vscode.window.showInformationMessage(t('msg.apiKeySaved', getLocale()))
      }
    }),

    vscode.commands.registerCommand('codebaseViz.clearApiKey', async () => {
      await context.secrets.delete(apiKeySlot(getProvider()))
      sidebarProvider?.updateStatus({ hasApiKey: false })
      void vscode.window.showInformationMessage(t('msg.apiKeyCleared', getLocale()))
    }),
  )
}

export function deactivate(): void {
  CodebaseVizPanel.dispose()
}
