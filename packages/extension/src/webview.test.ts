import { describe, it, expect, beforeEach, vi } from 'vitest'
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

describe('CodebaseVizPanel dispose', () => {
  it('panel dispose 시 singleton 인스턴스를 해제한다', () => {
    CodebaseVizPanel.createOrShow(EXT_URI)
    const created = vscode.window.createWebviewPanel.mock.results[0]?.value
    expect(CodebaseVizPanel.getInstance()).toBeDefined()
    created.__fireDispose()
    expect(CodebaseVizPanel.getInstance()).toBeUndefined()
  })
})
