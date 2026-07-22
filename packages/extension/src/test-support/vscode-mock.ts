import { vi } from 'vitest'

/**
 * vitest용 'vscode' 모듈 mock. esbuild.mjs가 'vscode'를 external 처리하므로
 * 프로덕션 번들에는 전혀 영향 없음 — vitest.config.ts의 resolve.alias에서만 사용된다.
 * 실제 vscode 확장 호스트 API 중 extension.ts/sidebarProvider.ts/panelProvider.ts/webview.ts가
 * 런타임에 참조하는 값(workspace/window/commands/env/Uri/ConfigurationTarget/ViewColumn)만 구현한다.
 * 나머지(WebviewView, ExtensionContext 등)는 타입 전용 참조라 런타임 값이 필요 없다.
 */

export interface MockUri {
  fsPath: string
  scheme: string
  toString(): string
}

export function makeUri(fsPath: string): MockUri {
  return {
    fsPath,
    scheme: fsPath.startsWith('http') ? 'https' : 'file',
    toString: () => fsPath,
  }
}

export const Uri = {
  file: vi.fn((fsPath: string) => makeUri(fsPath)),
  parse: vi.fn((value: string) => makeUri(value)),
  joinPath: vi.fn((base: MockUri, ...segments: string[]) => makeUri([base.fsPath, ...segments].join('/'))),
}

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 }
export const ViewColumn = { Active: -1, Beside: -2, One: 1 }

export interface MockConfiguration {
  get: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

export function makeConfiguration(values: Record<string, unknown> = {}): MockConfiguration {
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => (key in values ? values[key] : defaultValue)),
    update: vi.fn(async () => undefined),
  }
}

export const workspace = {
  workspaceFolders: undefined as readonly { uri: MockUri; name: string }[] | undefined,
  getConfiguration: vi.fn((_section?: string) => makeConfiguration()),
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  fs: { writeFile: vi.fn(async () => undefined) },
}

export interface MockWebview {
  options: unknown
  html: string
  cspSource: string
  postMessage: ReturnType<typeof vi.fn>
  asWebviewUri: ReturnType<typeof vi.fn>
  onDidReceiveMessage: ReturnType<typeof vi.fn>
  __fireMessage(msg: unknown): void
}

export function makeWebview(): MockWebview {
  let listener: ((msg: unknown) => unknown) | undefined
  return {
    options: undefined,
    html: '',
    cspSource: 'vscode-webview://mock-csp-source',
    postMessage: vi.fn(async () => true),
    asWebviewUri: vi.fn((uri: MockUri) => makeUri(`vscode-webview://mock/${uri.fsPath}`)),
    onDidReceiveMessage: vi.fn((cb: (msg: unknown) => unknown) => {
      listener = cb
      return { dispose: vi.fn() }
    }),
    __fireMessage(msg: unknown) {
      void listener?.(msg)
    },
  }
}

export interface MockWebviewView {
  webview: MockWebview
  viewType: string
}

export function makeWebviewView(viewType = 'mock.view'): MockWebviewView {
  return { webview: makeWebview(), viewType }
}

export interface MockWebviewPanel {
  webview: MockWebview
  reveal: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  onDidDispose: ReturnType<typeof vi.fn>
  __fireDispose(): void
}

export function makeWebviewPanel(): MockWebviewPanel {
  let disposeListener: (() => unknown) | undefined
  return {
    webview: makeWebview(),
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn((cb: () => unknown) => {
      disposeListener = cb
      return { dispose: vi.fn() }
    }),
    __fireDispose() {
      disposeListener?.()
    },
  }
}

export const window = {
  showQuickPick: vi.fn(async () => undefined),
  showWarningMessage: vi.fn(async () => undefined),
  showErrorMessage: vi.fn(async () => undefined),
  showInformationMessage: vi.fn(async () => undefined),
  showInputBox: vi.fn(async () => undefined),
  showSaveDialog: vi.fn(async () => undefined),
  createWebviewPanel: vi.fn(() => makeWebviewPanel()),
  registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
}

export const commands = {
  executeCommand: vi.fn(async () => undefined),
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
}

export const env = {
  language: 'en',
  openExternal: vi.fn(async () => true),
}

export function resetVscodeMock(): void {
  vi.clearAllMocks()
  workspace.workspaceFolders = undefined
  workspace.getConfiguration.mockImplementation((_section?: string) => makeConfiguration())
  window.createWebviewPanel.mockImplementation(() => makeWebviewPanel())
  window.registerWebviewViewProvider.mockImplementation(() => ({ dispose: vi.fn() }))
  env.language = 'en'
}
