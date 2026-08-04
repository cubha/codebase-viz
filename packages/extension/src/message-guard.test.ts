import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import {
  isHttpsUrl,
  sanitizeExportFilename,
  isValidExportMessage,
  isAllowedSidebarMessageType,
  isValidOpenNodeMessage,
  resolveWithinRoot,
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
