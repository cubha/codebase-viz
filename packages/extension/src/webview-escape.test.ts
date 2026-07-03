import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeJson, escapeHtml } from './webview-escape.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webviewTs = fs.readFileSync(path.join(__dirname, 'webview.ts'), 'utf8')

describe('safeJson (ST1)', () => {
  it('JSON 직렬화 결과의 </script> 이스케이프 시퀀스를 무력화한다', () => {
    const out = safeJson({ x: '</script><script>alert(1)</script>' })
    expect(out).not.toContain('</script>')
  })

  it('이스케이프해도 원본 값으로 역직렬화 가능하다', () => {
    const value = { x: '</script><script>alert(1)</script>', n: 1 }
    const roundTrip = JSON.parse(safeJson(value).replace(/\\u003c/g, '<')) as typeof value
    expect(roundTrip).toEqual(value)
  })

  it('특수문자가 없는 값은 표준 JSON과 동일하다', () => {
    expect(safeJson({ a: 1, b: 'x' })).toBe(JSON.stringify({ a: 1, b: 'x' }))
  })
})

describe('escapeHtml (ST1)', () => {
  it('HTML 특수문자를 엔티티로 치환한다', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('& < > " \' 전부 치환한다', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('특수문자가 없는 문자열은 그대로 반환한다', () => {
    expect(escapeHtml('plain text')).toBe('plain text')
  })
})

describe('CSP nonce (ST3)', () => {
  it('CSP script-src가 nonce 기반이며 unsafe-inline/unsafe-eval을 포함하지 않는다', () => {
    const meta = webviewTs.match(/Content-Security-Policy[\s\S]*?script-src[^;]*;/)
    expect(meta, 'CSP script-src 지시문을 찾을 수 없음').not.toBeNull()
    const scriptSrc = meta?.[0] ?? ''
    expect(scriptSrc).toMatch(/'nonce-\$\{nonce\}'/)
    expect(scriptSrc).not.toMatch(/unsafe-inline/)
    expect(scriptSrc).not.toMatch(/unsafe-eval/)
  })

  it('mermaid src 스크립트 태그와 인라인 스크립트 태그 모두 nonce 속성을 받는다', () => {
    expect(webviewTs).toMatch(/<script nonce="\$\{nonce\}" src="\$\{mermaidUri\.toString\(\)\}">/)
    expect(webviewTs).toMatch(/\.replace\('<script>', `<script nonce="\$\{nonce\}">`\)/)
  })
})

describe('buildFallbackHtml mermaid 설정 (SEC-4)', () => {
  it('fallback 경로도 htmlLabels:false를 명시해 diagram label의 raw HTML 렌더를 막는다', () => {
    const fallbackFn = webviewTs.match(/buildFallbackHtml[\s\S]*?mermaid\.initialize\([\s\S]*?\);/)
    expect(fallbackFn, 'buildFallbackHtml 내 mermaid.initialize 호출을 찾을 수 없음').not.toBeNull()
    expect(fallbackFn?.[0]).toMatch(/htmlLabels\s*:\s*false/)
  })
})

describe('buildFallbackHtml CSP (ST3)', () => {
  it('fallback 경로에도 nonce 기반 CSP가 있고 onclick 속성이 없다', () => {
    const fallbackFn = webviewTs.match(/private buildFallbackHtml[\s\S]*?\n  }/)
    expect(fallbackFn, 'buildFallbackHtml 메서드를 찾을 수 없음').not.toBeNull()
    const body = fallbackFn?.[0] ?? ''
    const scriptSrc = body.match(/script-src[^;]*;/)
    expect(scriptSrc, 'script-src 지시문을 찾을 수 없음').not.toBeNull()
    expect(scriptSrc?.[0]).toMatch(/'nonce-\$\{nonce\}'/)
    expect(scriptSrc?.[0]).not.toMatch(/unsafe-inline/)
    expect(body).not.toMatch(/onclick=/)
  })
})
