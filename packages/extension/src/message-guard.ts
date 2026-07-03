// webview postMessage 핸들러가 신뢰할 수 없는(webview 컨텍스트에서 온) 메시지를 처리하기 전
// 검증하는 순수 함수 모음. openExternal은 https만 허용해 javascript:/vscode:/file: 스킴 등으로
// 임의 명령 실행·로컬 파일 접근을 유도하는 것을 막는다.
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

// showSaveDialog의 기본 제안 파일명으로 쓰이므로 경로 구분자·상위 디렉터리 이동 시퀀스를 제거한다.
export function sanitizeExportFilename(name: string): string {
  return name.replace(/[/\\]/g, '_').replace(/\.\./g, '_')
}

export type ExportFormat = 'svg' | 'png' | 'md'
const EXPORT_FORMATS: readonly ExportFormat[] = ['svg', 'png', 'md']

export interface ValidExportMessage {
  type: 'export'
  format: ExportFormat
  data: string
  filename: string
}

export function isValidExportMessage(msg: unknown): msg is ValidExportMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const m = msg as Record<string, unknown>
  return (
    m.type === 'export' &&
    typeof m.format === 'string' &&
    EXPORT_FORMATS.includes(m.format as ExportFormat) &&
    typeof m.data === 'string' &&
    typeof m.filename === 'string'
  )
}

const SIDEBAR_MESSAGE_TYPES = new Set([
  'ready',
  'analyze',
  'reanalyze',
  'openViewer',
  'exportRequest',
  'setApiKey',
  'clearApiKey',
  'toggleLLM',
  'selectFolder',
  'setLanguage',
  'setProvider',
  'openExternal',
])

export function isAllowedSidebarMessageType(type: unknown): boolean {
  return typeof type === 'string' && SIDEBAR_MESSAGE_TYPES.has(type)
}
