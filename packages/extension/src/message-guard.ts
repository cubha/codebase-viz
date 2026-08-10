import * as path from 'node:path'
import type { NodeMap } from '@codebase-viz/renderer'

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

// Wave A T1(딥링크): 웹뷰는 sanitized node id 문자열만 보낸다 — 경로는 절대 신뢰하지 않고
// 확장이 자기 nodeMap(lastParams.diagrams.nodeMap)으로 직접 조회해 해석한다.
export interface ValidOpenNodeMessage {
  type: 'openNode'
  id: string
}

export function isValidOpenNodeMessage(msg: unknown): msg is ValidOpenNodeMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const m = msg as Record<string, unknown>
  return m.type === 'openNode' && typeof m.id === 'string' && m.id.length > 0
}

// nodeMap 엔트리의 repo-relative file은 우리 자신의 분석 산출물이라 통제된 입력이지만,
// 방어적으로 root 이탈(`..` 상위 이동)을 한 번 더 차단한다. 이탈 시 undefined(명시적 no-op).
export function resolveWithinRoot(root: string, relativeFile: string): string | undefined {
  const resolved = path.resolve(root, relativeFile)
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined
  return resolved
}

export interface OpenNodeTarget {
  absPath: string
  line: number // 0-based (vscode.Range 기준)
}

// handleOpenNode(webview.ts)의 vscode 비의존 로직 전량. vscode API 호출부(openTextDocument/
// showTextDocument)만 호출부에 남기고 판정을 여기로 모아 단위테스트 가능하게 한다 — 이 모듈의
// 다른 함수들과 같은 규약(웹뷰에서 온 신뢰 불가 입력을 순수 함수로 검증).
// 실패는 전부 undefined = 조용한 no-op: 잘못된 파일로 점프하는 것보다 무반응이 안전하다.
export function resolveOpenNodeTarget(
  nodeMap: NodeMap | undefined,
  id: string,
  repoRoot: string,
  pairRepoRoot: string | undefined,
): OpenNodeTarget | undefined {
  // 웹뷰가 보낸 id는 신뢰 불가 — '__proto__'/'constructor' 등으로 프로토타입 체인을 조회해
  // entry가 undefined가 아닌 것처럼 보이는 것을 막기 위해 own-property만 허용한다.
  const entry = nodeMap !== undefined && Object.prototype.hasOwnProperty.call(nodeMap, id) ? nodeMap[id] : undefined
  if (entry === undefined) return undefined
  const root = entry.r === 'pair' ? pairRepoRoot : repoRoot
  if (root === undefined) return undefined
  const absPath = resolveWithinRoot(root, entry.f)
  if (absPath === undefined) return undefined
  return { absPath, line: Math.max(0, entry.l - 1) }
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
