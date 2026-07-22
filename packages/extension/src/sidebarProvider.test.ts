import { describe, it, expect } from 'vitest'
import * as vscode from 'vscode'
import { SidebarProvider } from './sidebarProvider.js'
import { makeWebviewView, makeUri, resetVscodeMock } from './test-support/vscode-mock.js'

function setup() {
  resetVscodeMock()
  const provider = new SidebarProvider(makeUri('/ext') as unknown as vscode.Uri)
  const view = makeWebviewView(SidebarProvider.viewType)
  provider.resolveWebviewView(view as unknown as vscode.WebviewView, {} as never, {} as never)
  return { provider, view }
}

describe('SidebarProvider.resolveWebviewView', () => {
  it('scripts를 활성화하고 CSP nonce가 포함된 html을 세팅한다', () => {
    const { view } = setup()
    expect(view.webview.options).toEqual({ enableScripts: true })
    expect(view.webview.html).toContain('Content-Security-Policy')
    expect(view.webview.html).toMatch(/<script nonce="/)
  })
})

describe('SidebarProvider 메시지 디스패치', () => {
  it.each([
    ['analyze', 'codebaseViz.analyze'],
    ['reanalyze', 'codebaseViz.reanalyze'],
    ['openViewer', 'codebaseViz.openViewer'],
    ['setApiKey', 'codebaseViz.setApiKey'],
    ['clearApiKey', 'codebaseViz.clearApiKey'],
  ])('%s 메시지는 %s 커맨드를 실행한다', async (type, expectedCommand) => {
    const { view } = setup()
    view.webview.__fireMessage({ type })
    await Promise.resolve()
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(expectedCommand)
  })

  it('exportRequest는 value를 그대로 실어 exportFromSidebar 커맨드를 실행한다', async () => {
    const { view } = setup()
    view.webview.__fireMessage({ type: 'exportRequest', value: 'svg' })
    await Promise.resolve()
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('codebaseViz.exportFromSidebar', 'svg')
  })

  it('selectFolder는 value를 그대로 실어 selectFolder 커맨드를 실행한다', async () => {
    const { view } = setup()
    view.webview.__fireMessage({ type: 'selectFolder', value: '/repo/b' })
    await Promise.resolve()
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('codebaseViz.selectFolder', '/repo/b')
  })

  it('toggleLLM은 codebaseViz.enableLLM 설정을 Global로 업데이트한다', async () => {
    const { view } = setup()
    view.webview.__fireMessage({ type: 'toggleLLM', value: true })
    await Promise.resolve()
    const config = vscode.workspace.getConfiguration.mock.results.at(-1)?.value
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('codebaseViz')
    expect(config?.update).toHaveBeenCalledWith('enableLLM', true, vscode.ConfigurationTarget.Global)
  })

  it('openExternal은 https URL만 vscode.env.openExternal로 전달한다', async () => {
    const { view } = setup()
    view.webview.__fireMessage({ type: 'openExternal', value: 'javascript:alert(1)' })
    await Promise.resolve()
    expect(vscode.env.openExternal).not.toHaveBeenCalled()

    view.webview.__fireMessage({ type: 'openExternal', value: 'https://aistudio.google.com/app/apikey' })
    await Promise.resolve()
    expect(vscode.env.openExternal).toHaveBeenCalledTimes(1)
  })

  it('알 수 없는 메시지 타입(__proto__ 등)은 무시한다', async () => {
    const { view } = setup()
    view.webview.__fireMessage({ type: '__proto__' })
    await Promise.resolve()
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
  })
})

describe('SidebarProvider.updateStatus', () => {
  it('status 병합 후 webview로 postMessage한다', () => {
    const { provider, view } = setup()
    provider.updateStatus({ projectName: 'demo', routeCount: 3 })
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status', projectName: 'demo', routeCount: 3 }),
    )
    provider.updateStatus({ tableCount: 5 })
    expect(view.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'status', projectName: 'demo', routeCount: 3, tableCount: 5 }),
    )
  })
})

describe('SidebarProvider.refreshLocale', () => {
  it('view가 있으면 html을 재생성하고 status를 다시 push한다', () => {
    const { provider, view } = setup()
    expect(view.webview.html).toContain('Content-Security-Policy')
    provider.refreshLocale()
    // nonce는 매 렌더마다 새로 생성되므로 내용은 다르지만 문서 구조는 유지된다.
    expect(view.webview.html).toContain('Content-Security-Policy')
    expect(view.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status' }))
  })

  it('view가 없으면(resolveWebviewView 이전) 아무 동작도 하지 않는다', () => {
    resetVscodeMock()
    const provider = new SidebarProvider(makeUri('/ext') as unknown as vscode.Uri)
    expect(() => provider.refreshLocale()).not.toThrow()
  })
})
