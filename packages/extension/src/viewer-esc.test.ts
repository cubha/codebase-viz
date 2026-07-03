import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const viewerHtml = fs.readFileSync(path.join(__dirname, '..', 'media', 'viewer.html'), 'utf8')

function loadEsc(): (s: unknown) => string {
  const m = viewerHtml.match(/const ESC_MAP[\s\S]*?function esc\(s\)\s*\{[\s\S]*?\n\}/)
  if (m === null) throw new Error('esc() 함수를 viewer.html에서 찾을 수 없음')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${m[0]}\nreturn esc;`) as () => (s: unknown) => string
  return factory()
}

describe('viewer.html esc() (ST1)', () => {
  const esc = loadEsc()

  it('HTML 특수문자를 엔티티로 치환한다', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('null/undefined는 빈 문자열로 처리한다', () => {
    expect(esc(null)).toBe('')
    expect(esc(undefined)).toBe('')
  })

  it('숫자 등 비문자열도 문자열화 후 처리한다', () => {
    expect(esc(42)).toBe('42')
  })
})

describe('viewer.html 사이드바·에러 삽입 지점 esc() 적용 (ST1)', () => {
  it('buildSidebar의 table/column/FK/usedBy 필드 삽입에 esc()가 적용된다', () => {
    const m = viewerHtml.match(/function buildSidebar\([\s\S]*?\n\}/)
    expect(m, 'buildSidebar 함수를 찾을 수 없음').not.toBeNull()
    const body = m?.[0] ?? ''
    // 삽입 지점(c.name/c.type/f.col/f.toTable/u.name/name)이 esc(...)로 감싸여 있는지 확인.
    expect(body).toMatch(/esc\(c\.name\)/)
    expect(body).toMatch(/esc\(c\.type\)/)
    expect(body).toMatch(/esc\(f\.col\)/)
    expect(body).toMatch(/esc\(f\.toTable\)/)
    expect(body).toMatch(/esc\(u\.name\)/)
    expect(body).toMatch(/esc\(name\)/)
  })

  it('renderTab/renderDbView/renderChunkedInto의 e.message 삽입에 esc()가 적용된다', () => {
    const rawUnescaped = viewerHtml.match(/\+e\.message\+/g)
    expect(rawUnescaped, `esc() 미적용 e.message 삽입 발견: ${JSON.stringify(rawUnescaped)}`).toBeNull()
    const escaped = viewerHtml.match(/esc\(e\.message\)/g)
    expect(escaped?.length ?? 0).toBeGreaterThan(0)
  })
})
