import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { CodebaseVizPanel } from './webview.js'
import { makeUri, resetVscodeMock } from './test-support/vscode-mock.js'
import type { IRGraph } from '@codebase-viz/types'
import type { DiagramSet } from '@codebase-viz/renderer'

const EXT_URI = makeUri('/ext') as unknown as vscode.Uri

const EMPTY_DIAGRAMS: DiagramSet = { rendering: '', screenComponent: '', dbScreen: '' } as unknown as DiagramSet

function makeGraph(overrides: Partial<IRGraph> = {}): IRGraph {
  return {
    repoRoot: '/repo',
    projectName: 'demo',
    nodes: [],
    edges: [],
    ...overrides,
  } as unknown as IRGraph
}

beforeEach(() => {
  resetVscodeMock()
  CodebaseVizPanel.dispose()
})

describe('CodebaseVizPanel.createOrShow', () => {
  it('처음 호출 시 새 webview panel을 만든다', () => {
    CodebaseVizPanel.createOrShow(EXT_URI)
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1)
  })

  it('이미 열려있으면 재사용하고 reveal만 호출한다', () => {
    const first = CodebaseVizPanel.createOrShow(EXT_URI)
    const second = CodebaseVizPanel.createOrShow(EXT_URI)
    expect(second).toBe(first)
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1)
  })
})

describe('CodebaseVizPanel.triggerExport', () => {
  it('panel webview로 triggerExport 메시지를 postMessage한다', () => {
    const panel = CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    panel.triggerExport('svg')
    expect(created.webview.postMessage).toHaveBeenCalledWith({ type: 'triggerExport', format: 'svg' })
  })
})

describe('CodebaseVizPanel export 메시지 핸들링', () => {
  it('유효한 export 메시지 수신 시 showSaveDialog → fs.writeFile 순으로 저장한다', async () => {
    vscode.window.showSaveDialog.mockResolvedValueOnce(makeUri('/repo/out.svg'))
    CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value

    created.webview.__fireMessage({ type: 'export', format: 'svg', data: '<svg/>', filename: 'out.svg' })
    await vi.waitFor(() => expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1))

    expect(vscode.window.showSaveDialog).toHaveBeenCalled()
    const [uri, bytes] = vscode.workspace.fs.writeFile.mock.calls[0]
    expect(uri.fsPath).toBe('/repo/out.svg')
    expect(Buffer.from(bytes).toString('utf8')).toBe('<svg/>')
  })

  it('파일명의 경로 이동 시퀀스를 sanitize한다', async () => {
    vscode.window.showSaveDialog.mockResolvedValueOnce(makeUri('/repo/safe.svg'))
    CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value

    created.webview.__fireMessage({ type: 'export', format: 'svg', data: '<svg/>', filename: '../../etc/passwd.svg' })
    await vi.waitFor(() => expect(vscode.window.showSaveDialog).toHaveBeenCalledTimes(1))

    const opts = vscode.window.showSaveDialog.mock.calls[0][0]
    expect(opts.defaultUri.fsPath).not.toContain('..')
  })

  it('showSaveDialog가 취소(undefined)되면 writeFile을 호출하지 않는다', async () => {
    vscode.window.showSaveDialog.mockResolvedValueOnce(undefined)
    CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value

    created.webview.__fireMessage({ type: 'export', format: 'svg', data: '<svg/>', filename: 'out.svg' })
    await vi.waitFor(() => expect(vscode.window.showSaveDialog).toHaveBeenCalledTimes(1))

    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
  })

  it('reanalyze 메시지는 codebaseViz.reanalyze 커맨드를 실행한다', async () => {
    CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value

    created.webview.__fireMessage({ type: 'reanalyze' })
    await vi.waitFor(() => expect(vscode.commands.executeCommand).toHaveBeenCalledWith('codebaseViz.reanalyze'))
  })
})

describe('CodebaseVizPanel.updateGraph / showCached', () => {
  it('updateGraph는 그래프에서 route/table count를 계산해 html을 갱신한다', async () => {
    const panel = CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    const graph = makeGraph({
      nodes: [
        { kind: 'route', id: 'r1' },
        { kind: 'route', id: 'r2' },
        { kind: 'table', id: 't1' },
      ] as unknown as IRGraph['nodes'],
    })
    await panel.updateGraph(graph, EMPTY_DIAGRAMS)
    expect(created.webview.html.length).toBeGreaterThan(0)
  })
})

describe('CodebaseVizPanel META.isPair (Wave B T4)', () => {
  // 실제 media/viewer.html 템플릿을 읽게 하려고 extensionUri를 이 패키지 루트로 지정한다
  // (가짜 경로면 fs.readFile 실패 → buildFallbackHtml로 폴백해 META 주입 자체를 검증 못한다).
  const REAL_EXT_URI = makeUri(path.resolve(__dirname, '..')) as unknown as vscode.Uri

  it('pairRepoRoot가 지정된 분석이면 META.isPair=true를 주입한다', async () => {
    const panel = CodebaseVizPanel.createOrShow(REAL_EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    await panel.updateGraph(makeGraph(), EMPTY_DIAGRAMS, '/pair-be-repo')
    expect(created.webview.html).toMatch(/__CODEBASE_VIZ_META__\s*=\s*\{[^}]*"isPair":true/)
  })

  it('pairRepoRoot 없는 단일모드 분석이면 META.isPair=false를 주입한다', async () => {
    const panel = CodebaseVizPanel.createOrShow(REAL_EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    await panel.updateGraph(makeGraph(), EMPTY_DIAGRAMS)
    expect(created.webview.html).toMatch(/__CODEBASE_VIZ_META__\s*=\s*\{[^}]*"isPair":false/)
  })

  it('showCached도 pairRepoRoot를 넘기면 META.isPair=true를 주입한다', async () => {
    const panel = CodebaseVizPanel.createOrShow(REAL_EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    await panel.showCached(
      { projectName: 'demo', routeCount: 0, tableCount: 0, diagrams: EMPTY_DIAGRAMS, savedAt: 0 },
      '/repo',
      '/pair-be-repo',
    )
    expect(created.webview.html).toMatch(/__CODEBASE_VIZ_META__\s*=\s*\{[^}]*"isPair":true/)
  })
})

describe('CodebaseVizPanel openNode 메시지 핸들링 (Wave A ST4 — T1 딥링크)', () => {
  const DIAGRAMS_WITH_MAP: DiagramSet = {
    rendering: '', screenComponent: '', dbScreen: '',
    nodeMap: {
      fe_sid: { f: 'src/app/blog/page.tsx', l: 12, c: 'verified' },
      be_sid: { f: 'src/main/Ctrl.java', l: 3, c: 'verified', r: 'pair' },
    },
  } as unknown as DiagramSet

  it('FE nodeMap 히트 시 repoRoot 기준으로 파일을 열고 (line-1)로 이동한다', async () => {
    const panel = CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    await panel.updateGraph(makeGraph(), DIAGRAMS_WITH_MAP)

    created.webview.__fireMessage({ type: 'openNode', id: 'fe_sid' })
    await vi.waitFor(() => expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1))

    const openedUri = vscode.workspace.openTextDocument.mock.calls[0][0]
    expect(openedUri.fsPath).toBe('/repo/src/app/blog/page.tsx')
    const opts = vscode.window.showTextDocument.mock.calls[0][1]
    expect(opts.selection.startLine).toBe(11)
  })

  it('r:"pair" 엔트리는 pairRepoRoot 기준으로 해석한다', async () => {
    const panel = CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    await panel.updateGraph(makeGraph(), DIAGRAMS_WITH_MAP, '/be-repo')

    created.webview.__fireMessage({ type: 'openNode', id: 'be_sid' })
    await vi.waitFor(() => expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1))

    const openedUri = vscode.workspace.openTextDocument.mock.calls[0][0]
    expect(openedUri.fsPath).toBe('/be-repo/src/main/Ctrl.java')
  })

  it('pairRepoRoot 없이 r:"pair" 엔트리를 클릭하면 무반응(no-op)한다', async () => {
    const panel = CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    await panel.updateGraph(makeGraph(), DIAGRAMS_WITH_MAP) // pairRepoRoot 미지정

    created.webview.__fireMessage({ type: 'openNode', id: 'be_sid' })
    await vi.waitFor(() => expect(created.webview.__fireMessage).toBeDefined())
    await new Promise(r => setTimeout(r, 20))
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled()
  })

  it('nodeMap에 없는 id는 무반응한다', async () => {
    const panel = CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    await panel.updateGraph(makeGraph(), DIAGRAMS_WITH_MAP)

    created.webview.__fireMessage({ type: 'openNode', id: 'no_such_id' })
    await new Promise(r => setTimeout(r, 20))
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled()
  })

  it('id가 "__proto__"/"constructor" 등 프로토타입 체인 키여도 무반응한다(security-auditor S6)', async () => {
    const panel = CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    await panel.updateGraph(makeGraph(), DIAGRAMS_WITH_MAP)

    created.webview.__fireMessage({ type: 'openNode', id: '__proto__' })
    created.webview.__fireMessage({ type: 'openNode', id: 'constructor' })
    await new Promise(r => setTimeout(r, 20))
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled()
  })

  it('openTextDocument가 실패(파일 부재 등)해도 예외 없이 무반응한다', async () => {
    vscode.workspace.openTextDocument.mockRejectedValueOnce(new Error('ENOENT'))
    const panel = CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    await panel.updateGraph(makeGraph(), DIAGRAMS_WITH_MAP)

    created.webview.__fireMessage({ type: 'openNode', id: 'fe_sid' })
    await vi.waitFor(() => expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1))
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled()
  })
})

describe('CodebaseVizPanel dispose', () => {
  it('panel dispose 시 singleton 인스턴스를 해제한다', () => {
    CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    expect(CodebaseVizPanel.getInstance()).toBeDefined()
    created.__fireDispose()
    expect(CodebaseVizPanel.getInstance()).toBeUndefined()
  })
})
