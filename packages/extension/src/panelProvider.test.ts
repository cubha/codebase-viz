import { describe, it, expect } from 'vitest'
import type * as vscode from 'vscode'
import { PanelProvider } from './panelProvider.js'
import { makeWebviewView, makeUri, resetVscodeMock } from './test-support/vscode-mock.js'

function setup() {
  resetVscodeMock()
  const provider = new PanelProvider(makeUri('/ext') as unknown as vscode.Uri)
  const view = makeWebviewView(PanelProvider.viewType)
  provider.resolveWebviewView(view as unknown as vscode.WebviewView, {} as never, {} as never)
  return { provider, view }
}

describe('PanelProvider.resolveWebviewView', () => {
  it('scripts를 활성화하고 CSP nonce가 포함된 html을 세팅한다', () => {
    const { view } = setup()
    expect(view.webview.options).toEqual({ enableScripts: true })
    expect(view.webview.html).toContain('Content-Security-Policy')
    expect(view.webview.html).toMatch(/<script nonce="/)
  })

  it('resolve 이전에 쌓인 로그를 flush한다', () => {
    resetVscodeMock()
    const provider = new PanelProvider(makeUri('/ext') as unknown as vscode.Uri)
    provider.log('before-resolve')
    const view = makeWebviewView(PanelProvider.viewType)
    provider.resolveWebviewView(view as unknown as vscode.WebviewView, {} as never, {} as never)
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: expect.stringContaining('before-resolve') }),
    )
  })
})

describe('PanelProvider.log', () => {
  it('postMessage로 log 타입 메시지를 전달한다', () => {
    const { provider, view } = setup()
    provider.log('hello')
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'hello' }),
    )
  })

  it('버퍼가 200개를 초과하면 가장 오래된 로그부터 버린다', () => {
    resetVscodeMock()
    const provider = new PanelProvider(makeUri('/ext') as unknown as vscode.Uri)
    for (let i = 0; i < 205; i++) provider.log(`msg-${i}`)
    const view = makeWebviewView(PanelProvider.viewType)
    provider.resolveWebviewView(view as unknown as vscode.WebviewView, {} as never, {} as never)
    const flushedMessages = view.webview.postMessage.mock.calls
      .map(([msg]: [{ type: string; message: string }]) => msg)
      .filter((msg: { type: string }) => msg.type === 'log')
      .map((msg: { message: string }) => msg.message)
    expect(flushedMessages.length).toBe(200)
    expect(flushedMessages[0]).toContain('msg-5')
    expect(flushedMessages.at(-1)).toContain('msg-204')
  })
})

describe('PanelProvider.setAnalyzing / setResult', () => {
  it('setAnalyzing(true)는 state 메시지 postMessage + 로그를 남긴다', () => {
    const { provider, view } = setup()
    provider.setAnalyzing(true, 'demo')
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'state', analyzing: true, projectName: 'demo' }),
    )
    expect(view.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'log' }))
  })

  it('setAnalyzing(false)는 로그를 남기지 않는다', () => {
    const { provider, view } = setup()
    provider.setAnalyzing(false)
    const logCalls = view.webview.postMessage.mock.calls.filter(([msg]: [{ type: string }]) => msg.type === 'log')
    expect(logCalls.length).toBe(0)
  })

  it('setResult는 result 메시지 postMessage + 완료 로그를 남긴다', () => {
    const { provider, view } = setup()
    provider.setResult({ projectName: 'demo', routeCount: 10, tableCount: 4, cachedAt: 123 })
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'result', projectName: 'demo', routeCount: 10, tableCount: 4 }),
    )
    expect(view.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'log' }))
  })
})
