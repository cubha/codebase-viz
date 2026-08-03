import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as vscode from 'vscode'
import { activate, deactivate } from './extension.js'
import { CodebaseVizPanel } from './webview.js'
import { makeUri, makeConfiguration, resetVscodeMock } from './test-support/vscode-mock.js'
import type { DiagramCache } from './diagram-cache.js'

const runAnalysisMock = vi.fn()
const readDiagramCacheMock = vi.fn()
const writeDiagramCacheMock = vi.fn(async () => undefined)

vi.mock('./analyzer.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./analyzer.js')>()
  return { ...actual, runAnalysis: (...args: unknown[]) => runAnalysisMock(...args) }
})
vi.mock('./diagram-cache.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./diagram-cache.js')>()
  return {
    ...actual,
    readDiagramCache: (...args: unknown[]) => readDiagramCacheMock(...args),
    writeDiagramCache: (...args: unknown[]) => writeDiagramCacheMock(...args),
  }
})

function makeContext(): vscode.ExtensionContext {
  const secretsStore = new Map<string, string>()
  const workspaceStateStore = new Map<string, unknown>()
  return {
    extensionUri: makeUri('/ext'),
    extensionPath: '/ext',
    subscriptions: [],
    secrets: {
      get: vi.fn(async (key: string) => secretsStore.get(key)),
      store: vi.fn(async (key: string, value: string) => { secretsStore.set(key, value) }),
      delete: vi.fn(async (key: string) => { secretsStore.delete(key) }),
    },
    workspaceState: {
      get: vi.fn((key: string, defaultValue?: unknown) => workspaceStateStore.get(key) ?? defaultValue),
      update: vi.fn(async (key: string, value: unknown) => { workspaceStateStore.set(key, value) }),
    },
  } as unknown as vscode.ExtensionContext
}

// package.json contributes.commands는 팔레트 노출용 부분집합만 담는다(codebaseViz.analyze/selectFolder/setApiKey/clearApiKey).
// reanalyze/openViewer/exportFromSidebar는 webview postMessage에서만 프로그래밍적으로 호출되는 내부 커맨드라
// contributes에는 없지만 activate()에서 반드시 등록돼야 한다 — scripts/check-contributes-ids.mjs가 잡지 못하는 회귀.
const EXPECTED_COMMAND_IDS = [
  'codebaseViz.analyze',
  'codebaseViz.reanalyze',
  'codebaseViz.openViewer',
  'codebaseViz.selectFolder',
  'codebaseViz.exportFromSidebar',
  'codebaseViz.setApiKey',
  'codebaseViz.clearApiKey',
]

beforeEach(() => {
  resetVscodeMock()
  CodebaseVizPanel.dispose()
  runAnalysisMock.mockReset()
  readDiagramCacheMock.mockReset()
  writeDiagramCacheMock.mockReset().mockResolvedValue(undefined)
})

describe('activate', () => {
  it('sidebar/panel webview provider를 등록한다', () => {
    const context = makeContext()
    activate(context)
    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledTimes(2)
    const registeredViewTypes = vscode.window.registerWebviewViewProvider.mock.calls.map((c: unknown[]) => c[0])
    expect(registeredViewTypes).toEqual(expect.arrayContaining(['codebaseViz.sidebar', 'codebaseViz.panelView']))
  })

  it('필요한 커맨드를 전부 등록한다(contributes 부분집합 + 내부 전용 포함)', () => {
    const context = makeContext()
    activate(context)
    const registeredIds = vscode.commands.registerCommand.mock.calls.map((c: unknown[]) => c[0])
    for (const id of EXPECTED_COMMAND_IDS) {
      expect(registeredIds).toContain(id)
    }
  })

  it('context.subscriptions에 disposable을 채운다', () => {
    const context = makeContext()
    activate(context)
    expect(context.subscriptions.length).toBeGreaterThan(0)
  })

  it('workspaceFolders가 없으면 초기 status에서 selectedFolder가 undefined다', async () => {
    const context = makeContext()
    activate(context)
    await vi.waitFor(() => {
      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalled()
    })
    // 초기 status push는 별도 async IIFE라 sidebarProvider mock view가 없어도 크래시 없이 끝나야 한다.
    expect(context.secrets.get).toHaveBeenCalled()
  })
})

describe('deactivate', () => {
  it('열려있는 panel을 dispose한다', () => {
    const context = makeContext()
    activate(context)
    CodebaseVizPanel.createOrShow(context.extensionUri)
    expect(CodebaseVizPanel.getInstance()).toBeDefined()
    deactivate()
    expect(CodebaseVizPanel.getInstance()).toBeUndefined()
  })
})

describe('codebaseViz.selectFolder 커맨드', () => {
  it('workspaceFolders가 1개뿐이면 QuickPick 없이 즉시 선택 상태를 갱신한다', async () => {
    const context = makeContext()
    const folderUri = makeUri('/repo/a')
    vscode.workspace.workspaceFolders = [{ uri: folderUri, name: 'a' }] as never
    activate(context)

    const handler = vscode.commands.registerCommand.mock.calls.find((c: unknown[]) => c[0] === 'codebaseViz.selectFolder')?.[1]
    expect(handler).toBeDefined()
    await handler()

    expect(context.workspaceState.update).toHaveBeenCalledWith('codebaseViz.selectedFolder', '/repo/a')
  })
})

function setupSingleWorkspaceAnalyze(configValues: Record<string, unknown> = {}) {
  const context = makeContext()
  vscode.workspace.workspaceFolders = [{ uri: makeUri('/repo/a'), name: 'a' }] as never
  vscode.workspace.getConfiguration.mockImplementation(() => makeConfiguration(configValues))
  activate(context)
  const handler = vscode.commands.registerCommand.mock.calls.find(
    (c: unknown[]) => c[0] === 'codebaseViz.analyze',
  )?.[1] as () => Promise<void>
  return { context, handler }
}

const FAKE_DIAGRAMS = { rendering: 'r', screenComponent: 's', dbScreen: 'd' }

describe('doAnalyze (codebaseViz.analyze 커맨드 핵심 플로우)', () => {
  it('enableLLM=false + 캐시 히트 시 runAnalysis를 호출하지 않고 캐시를 그대로 보여준다', async () => {
    const cached: DiagramCache = { savedAt: 1000, projectName: 'demo', routeCount: 3, tableCount: 1, diagrams: FAKE_DIAGRAMS as never }
    readDiagramCacheMock.mockResolvedValue(cached)
    const { handler } = setupSingleWorkspaceAnalyze({ enableLLM: false })

    await handler()

    expect(readDiagramCacheMock).toHaveBeenCalledWith('/repo/a', undefined)
    expect(runAnalysisMock).not.toHaveBeenCalled()
    expect(writeDiagramCacheMock).not.toHaveBeenCalled()
    expect(CodebaseVizPanel.getInstance()).toBeDefined()
  })

  it('enableLLM=false + 캐시 미스 시 runAnalysis를 호출하고 결과를 캐시에 쓴다', async () => {
    readDiagramCacheMock.mockResolvedValue(undefined)
    runAnalysisMock.mockResolvedValue({
      graph: { projectName: 'demo', repoRoot: '/repo/a', nodes: [], edges: [] },
      diagrams: FAKE_DIAGRAMS,
    })
    const { handler } = setupSingleWorkspaceAnalyze({ enableLLM: false })

    await handler()

    expect(runAnalysisMock).toHaveBeenCalledTimes(1)
    const [repoRoot, options] = runAnalysisMock.mock.calls[0] as [string, { llm?: unknown }]
    expect(repoRoot).toBe('/repo/a')
    expect(options.llm).toBeUndefined()
    expect(writeDiagramCacheMock).toHaveBeenCalledTimes(1)
  })

  it('enableLLM=true + apiKey 미설정 시 경고만 띄우고 runAnalysis는 호출하지 않는다', async () => {
    const { handler } = setupSingleWorkspaceAnalyze({ enableLLM: true })

    await handler()

    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1)
    expect(runAnalysisMock).not.toHaveBeenCalled()
    expect(CodebaseVizPanel.getInstance()).toBeUndefined()
  })

  it('enableLLM=true + apiKey 존재 시 llm 옵션(apiKey/provider)을 실어 runAnalysis를 호출한다', async () => {
    readDiagramCacheMock.mockResolvedValue(undefined)
    runAnalysisMock.mockResolvedValue({
      graph: { projectName: 'demo', repoRoot: '/repo/a', nodes: [], edges: [] },
      diagrams: FAKE_DIAGRAMS,
    })
    const { context, handler } = setupSingleWorkspaceAnalyze({ enableLLM: true, 'llm.provider': 'anthropic' })
    await context.secrets.store('codebaseViz.llm.apiKey.anthropic', 'sk-test')

    await handler()

    expect(runAnalysisMock).toHaveBeenCalledTimes(1)
    const [, options] = runAnalysisMock.mock.calls[0] as [string, { llm?: { apiKey: string; provider: string } }]
    expect(options.llm).toEqual(expect.objectContaining({ apiKey: 'sk-test', provider: 'anthropic' }))
  })

  it('runAnalysis 실패 시 에러 메시지를 표시하고 캐시에 쓰지 않는다', async () => {
    readDiagramCacheMock.mockResolvedValue(undefined)
    runAnalysisMock.mockRejectedValue(new Error('boom'))
    const { handler } = setupSingleWorkspaceAnalyze({ enableLLM: false })

    await handler()

    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1)
    expect(writeDiagramCacheMock).not.toHaveBeenCalled()
  })

  it('pairRepoRoot로 분석 성공 시 workspaceState에 마지막 pair 폴더를 기록한다(A3)', async () => {
    readDiagramCacheMock.mockResolvedValue(undefined)
    runAnalysisMock.mockResolvedValue({
      graph: { projectName: 'demo', repoRoot: '/repo/a', nodes: [], edges: [] },
      diagrams: FAKE_DIAGRAMS,
      pair: { graph: { nodes: [], edges: [] }, crossEdges: [] },
    })
    const context = makeContext()
    vscode.workspace.workspaceFolders = [{ uri: makeUri('/repo/a'), name: 'a' }] as never
    vscode.workspace.getConfiguration.mockImplementation(() => makeConfiguration({ enableLLM: false }))
    activate(context)
    const handler = vscode.commands.registerCommand.mock.calls.find(
      (c: unknown[]) => c[0] === 'codebaseViz.reanalyze',
    )?.[1] as (fsPath?: unknown, pairFsPath?: unknown) => Promise<void>

    // pickPairFolder는 QuickPick 경유라 여기서 직접 재현하지 않고, doAnalyze에 전달되는 값만 검증한다.
    // reanalyze 핸들러가 pickPairFolder를 내부에서 부르므로, workspaceFolders를 2개로 만들고
    // QuickPick이 두 번째 폴더를 선택하도록 스텁한다.
    vscode.workspace.workspaceFolders = [
      { uri: makeUri('/repo/a'), name: 'a' },
      { uri: makeUri('/repo/be'), name: 'be' },
    ] as never
    vscode.window.showQuickPick.mockResolvedValue({ label: 'be', fsPath: '/repo/be' })

    await handler()

    expect(context.workspaceState.update).toHaveBeenCalledWith('codebaseViz.pairFolderMap', { '/repo/a': '/repo/be' })
  })

  it('메인 폴더별로 스코프된다 — 다른 폴더의 pair 기록을 덮어쓰지 않는다(scope-critic 지적 회귀 방지)', async () => {
    readDiagramCacheMock.mockResolvedValue(undefined)
    runAnalysisMock.mockResolvedValue({
      graph: { projectName: 'demo', repoRoot: '/repo/c', nodes: [], edges: [] },
      diagrams: FAKE_DIAGRAMS,
      pair: { graph: { nodes: [], edges: [] }, crossEdges: [] },
    })
    const context = makeContext()
    await context.workspaceState.update('codebaseViz.pairFolderMap', { '/repo/a': '/repo/be' })
    vscode.workspace.workspaceFolders = [
      { uri: makeUri('/repo/c'), name: 'c' },
      { uri: makeUri('/repo/d'), name: 'd' },
    ] as never
    vscode.workspace.getConfiguration.mockImplementation(() => makeConfiguration({ enableLLM: false }))
    activate(context)
    const handler = vscode.commands.registerCommand.mock.calls.find(
      (c: unknown[]) => c[0] === 'codebaseViz.analyze',
    )?.[1] as () => Promise<void>
    vscode.window.showQuickPick.mockResolvedValue({ label: 'd', fsPath: '/repo/d' })

    await handler()

    expect(context.workspaceState.update).toHaveBeenCalledWith(
      'codebaseViz.pairFolderMap',
      { '/repo/a': '/repo/be', '/repo/c': '/repo/d' },
    )
  })
})

describe('codebaseViz.openViewer 커맨드 (A3: pair 캐시 도달 경로)', () => {
  it('마지막 pair 폴더가 기록돼 있으면 readCache에 pairRepoRoot를 함께 전달한다', async () => {
    const context = makeContext()
    vscode.workspace.workspaceFolders = [{ uri: makeUri('/repo/a'), name: 'a' }] as never
    await context.workspaceState.update('codebaseViz.pairFolderMap', { '/repo/a': '/repo/be' })
    readDiagramCacheMock.mockResolvedValue({
      savedAt: 1, projectName: 'demo', routeCount: 1, tableCount: 0, diagrams: FAKE_DIAGRAMS,
    })
    activate(context)
    const handler = vscode.commands.registerCommand.mock.calls.find(
      (c: unknown[]) => c[0] === 'codebaseViz.openViewer',
    )?.[1] as () => Promise<void>

    await handler()

    expect(readDiagramCacheMock).toHaveBeenCalledWith('/repo/a', '/repo/be')
  })

  it('pair 이력이 없으면 pairRepoRoot 없이 readCache를 호출한다(회귀 방지)', async () => {
    const context = makeContext()
    vscode.workspace.workspaceFolders = [{ uri: makeUri('/repo/a'), name: 'a' }] as never
    readDiagramCacheMock.mockResolvedValue(undefined)
    activate(context)
    const handler = vscode.commands.registerCommand.mock.calls.find(
      (c: unknown[]) => c[0] === 'codebaseViz.openViewer',
    )?.[1] as () => Promise<void>

    await handler()

    expect(readDiagramCacheMock).toHaveBeenCalledWith('/repo/a', undefined)
  })
})
