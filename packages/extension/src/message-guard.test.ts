import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import type { NodeMap } from '@codebase-viz/renderer'
import {
  isHttpsUrl,
  sanitizeExportFilename,
  isValidExportMessage,
  isAllowedSidebarMessageType,
  isValidOpenNodeMessage,
  resolveWithinRoot,
  resolveOpenNodeTarget,
} from './message-guard.js'

describe('isHttpsUrl (ST2)', () => {
  it('https URL은 허용한다', () => {
    expect(isHttpsUrl('https://aistudio.google.com/app/apikey')).toBe(true)
  })
  it('http/javascript/vscode/file 스킴은 거부한다', () => {
    expect(isHttpsUrl('http://example.com')).toBe(false)
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpsUrl('vscode://ext/command')).toBe(false)
    expect(isHttpsUrl('file:///etc/passwd')).toBe(false)
  })
  it('문자열이 아니거나 파싱 불가하면 거부한다', () => {
    expect(isHttpsUrl(undefined)).toBe(false)
    expect(isHttpsUrl(123)).toBe(false)
    expect(isHttpsUrl('not a url')).toBe(false)
  })
})

describe('sanitizeExportFilename (ST2)', () => {
  it('경로 구분자를 치환한다', () => {
    expect(sanitizeExportFilename('a/b\\c.svg')).toBe('a_b_c.svg')
  })
  it('상위 디렉터리 이동 시퀀스를 치환한다', () => {
    expect(sanitizeExportFilename('../../etc/passwd')).toBe('____etc_passwd')
    expect(sanitizeExportFilename('../../etc/passwd')).not.toContain('..')
  })
  it('일반 파일명은 그대로 반환한다', () => {
    expect(sanitizeExportFilename('my-project.svg')).toBe('my-project.svg')
  })
})

describe('isValidExportMessage (ST2)', () => {
  it('올바른 export 메시지를 허용한다', () => {
    expect(isValidExportMessage({ type: 'export', format: 'svg', data: '<svg/>', filename: 'a.svg' })).toBe(true)
  })
  it('알 수 없는 format은 거부한다', () => {
    expect(isValidExportMessage({ type: 'export', format: 'exe', data: 'x', filename: 'a' })).toBe(false)
  })
  it('필드 타입이 틀리면 거부한다', () => {
    expect(isValidExportMessage({ type: 'export', format: 'svg', data: 123, filename: 'a' })).toBe(false)
  })
  it('null/비객체는 거부한다', () => {
    expect(isValidExportMessage(null)).toBe(false)
    expect(isValidExportMessage('x')).toBe(false)
  })
})

describe('isAllowedSidebarMessageType (ST2)', () => {
  it('sidebarProvider의 기존 switch case 전부를 허용한다', () => {
    const known = [
      'ready', 'analyze', 'reanalyze', 'openViewer', 'exportRequest',
      'setApiKey', 'clearApiKey', 'toggleLLM', 'selectFolder', 'setLanguage',
      'setProvider', 'openExternal',
    ]
    for (const type of known) expect(isAllowedSidebarMessageType(type)).toBe(true)
  })
  it('알 수 없는 타입은 거부한다', () => {
    expect(isAllowedSidebarMessageType('__proto__')).toBe(false)
    expect(isAllowedSidebarMessageType(123)).toBe(false)
  })
})

describe('isValidOpenNodeMessage (Wave A ST4 — T1 딥링크)', () => {
  it('id 문자열만 있는 openNode 메시지를 허용한다', () => {
    expect(isValidOpenNodeMessage({ type: 'openNode', id: 'route_app_blog_page_tsx_page' })).toBe(true)
  })
  it('빈 id는 거부한다', () => {
    expect(isValidOpenNodeMessage({ type: 'openNode', id: '' })).toBe(false)
  })
  it('id가 문자열이 아니면 거부한다 — 절대경로/객체 등 임의 데이터를 웹뷰가 주입 못 하게 한다', () => {
    expect(isValidOpenNodeMessage({ type: 'openNode', id: 123 })).toBe(false)
    expect(isValidOpenNodeMessage({ type: 'openNode', id: { f: '/etc/passwd' } })).toBe(false)
  })
  it('type이 다르거나 null/비객체면 거부한다', () => {
    expect(isValidOpenNodeMessage({ type: 'export', id: 'x' })).toBe(false)
    expect(isValidOpenNodeMessage(null)).toBe(false)
    expect(isValidOpenNodeMessage('x')).toBe(false)
  })
})

describe('resolveWithinRoot (Wave A ST4 — T1 딥링크 경로 이탈 차단)', () => {
  const root = path.resolve('/repo')

  it('root 하위 상대경로는 절대경로로 해석한다', () => {
    expect(resolveWithinRoot(root, 'src/app/blog/page.tsx')).toBe(path.join(root, 'src/app/blog/page.tsx'))
  })
  it('상위 디렉터리 이탈(..)은 undefined를 반환한다', () => {
    expect(resolveWithinRoot(root, '../../etc/passwd')).toBeUndefined()
  })
  it('root 밖 절대경로가 섞여 들어와도 undefined를 반환한다', () => {
    expect(resolveWithinRoot(root, path.resolve('/etc/passwd'))).toBeUndefined()
  })
})

// handleOpenNode(webview.ts)의 vscode 비의존 로직 전량 — nodeMap 조회·프로토타입 가드·pair root
// 선택·1-based→0-based 라인 변환. 기존엔 이 조합이 vscode API에 묶여 있어 단위테스트가 불가능했고,
// "webview가 클릭 메시지를 보낸다"까지만 검증되고 "확장이 올바른 파일:라인을 연다"는 미검증이었다.
// vscode 호출(openTextDocument/showTextDocument) 자체만 webview.ts에 남긴다.
describe('resolveOpenNodeTarget — 딥링크 점프 대상 해석 (v1.2.63 검증공백 해소)', () => {
  const repoRoot = path.resolve('/repo')
  const pairRoot = path.resolve('/pair-repo')
  const nodeMap: NodeMap = {
    route_blog: { f: 'src/app/blog/page.tsx', l: 12, c: 'verified' },
    first_line: { f: 'src/index.ts', l: 1, c: 'verified' },
    zero_line: { f: 'src/zero.ts', l: 0, c: 'inferred', i: 'guess' },
    pair_ctrl: { f: 'src/main/java/A.java', l: 30, c: 'verified', r: 'pair' },
    escapee: { f: '../../etc/passwd', l: 1, c: 'verified' },
  }

  it('nodeMap 히트 → 절대경로 + 0-based 라인을 반환한다', () => {
    expect(resolveOpenNodeTarget(nodeMap, 'route_blog', repoRoot, undefined)).toEqual({
      absPath: path.join(repoRoot, 'src/app/blog/page.tsx'),
      line: 11,
    })
  })

  it('1행은 0으로 변환된다(off-by-one 가드)', () => {
    expect(resolveOpenNodeTarget(nodeMap, 'first_line', repoRoot, undefined)?.line).toBe(0)
  })

  it('l이 0/음수여도 line은 0 미만으로 내려가지 않는다', () => {
    expect(resolveOpenNodeTarget(nodeMap, 'zero_line', repoRoot, undefined)?.line).toBe(0)
  })

  it("r:'pair' 엔트리는 pairRepoRoot 기준으로 해석한다", () => {
    expect(resolveOpenNodeTarget(nodeMap, 'pair_ctrl', repoRoot, pairRoot)).toEqual({
      absPath: path.join(pairRoot, 'src/main/java/A.java'),
      line: 29,
    })
  })

  it("r:'pair'인데 pairRepoRoot가 없으면 undefined(잘못된 root로 점프 금지)", () => {
    expect(resolveOpenNodeTarget(nodeMap, 'pair_ctrl', repoRoot, undefined)).toBeUndefined()
  })

  it('nodeMap 미스(subgraph wrapper 등)는 undefined — 조용한 no-op', () => {
    expect(resolveOpenNodeTarget(nodeMap, 'NOT_THERE', repoRoot, undefined)).toBeUndefined()
  })

  it('nodeMap 자체가 없으면 undefined', () => {
    expect(resolveOpenNodeTarget(undefined, 'route_blog', repoRoot, undefined)).toBeUndefined()
  })

  // v1.2.61 security-auditor가 잡은 결함 — 웹뷰가 보낸 id는 신뢰 불가라 프로토타입 체인 키로
  // "entry가 존재하는 것처럼" 보이게 만들 수 있었다. own-property 가드 회귀 방지.
  it('프로토타입 체인 키(__proto__/constructor/toString)는 조회되지 않는다', () => {
    for (const evil of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(resolveOpenNodeTarget(nodeMap, evil, repoRoot, undefined), evil).toBeUndefined()
    }
  })

  it('엔트리 경로가 root를 이탈하면 undefined(resolveWithinRoot 위임)', () => {
    expect(resolveOpenNodeTarget(nodeMap, 'escapee', repoRoot, undefined)).toBeUndefined()
  })
})
