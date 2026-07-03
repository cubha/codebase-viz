import { describe, it, expect } from 'vitest'
import {
  isHttpsUrl,
  sanitizeExportFilename,
  isValidExportMessage,
  isAllowedSidebarMessageType,
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
