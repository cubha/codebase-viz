import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const viewerHtml = fs.readFileSync(path.join(__dirname, '..', 'media', 'viewer.html'), 'utf8')

function loadFuzzyScore(): (query: string, text: string) => number | null {
  const m = viewerHtml.match(/function fuzzyScore\(query, text\)\s*\{[\s\S]*?\n\}/)
  if (m === null) throw new Error('fuzzyScore() 함수를 viewer.html에서 찾을 수 없음')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${m[0]}\nreturn fuzzyScore;`) as () => (query: string, text: string) => number | null
  return factory()
}

function loadDebounce(): <A extends unknown[]>(fn: (...args: A) => void, ms: number) => (...args: A) => void {
  const m = viewerHtml.match(/function debounce\(fn, ms\)\s*\{[\s\S]*?\n\}/)
  if (m === null) throw new Error('debounce() 함수를 viewer.html에서 찾을 수 없음')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${m[0]}\nreturn debounce;`) as () => <A extends unknown[]>(fn: (...args: A) => void, ms: number) => (...args: A) => void
  return factory()
}

describe('viewer.html fuzzyScore() (Wave A ST7 — T3 검색 코어)', () => {
  const fuzzyScore = loadFuzzyScore()

  it('빈 쿼리는 전체 매치(점수 0)로 취급한다', () => {
    expect(fuzzyScore('', '/blog/[slug]/page.tsx')).toBe(0)
  })

  it('대소문자를 무시하고 매치한다', () => {
    expect(fuzzyScore('BLOG', '/blog/page.tsx')).not.toBeNull()
    expect(fuzzyScore('blog', '/BLOG/PAGE.TSX')).not.toBeNull()
  })

  it('순서를 지키지 않는 부분열은 매치 실패(null)다', () => {
    expect(fuzzyScore('golb', '/blog/page.tsx')).toBeNull()
  })

  it('쿼리 문자가 전부 순서대로 나타나면 흩어져 있어도 매치한다(subsequence)', () => {
    expect(fuzzyScore('bpt', '/blog/page.tsx')).not.toBeNull() // b(log) p(age) t(sx)
  })

  it('연속 매치가 흩어진 매치보다 높은 점수를 받는다', () => {
    const contiguous = fuzzyScore('blog', '/blog/page.tsx')
    const scattered = fuzzyScore('bpt', '/blog/page.tsx')
    expect(contiguous).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect((contiguous as number) > (scattered as number)).toBe(true)
  })

  it('단어 경계(/,_,.,-,공백) 뒤에서 시작하는 매치가 중간 매치보다 높은 점수를 받는다', () => {
    const atBoundary = fuzzyScore('page', '/blog/page.tsx') // '/'뒤에서 시작
    const midWord = fuzzyScore('log', '/blog/page.tsx') // 'b' 다음(경계 아님)
    expect(atBoundary).not.toBeNull()
    expect(midWord).not.toBeNull()
    expect((atBoundary as number) > (midWord as number)).toBe(true)
  })

  it('동일 쿼리로 후보 목록을 점수 내림차순 정렬하면 결정론적 순서를 얻는다', () => {
    // '/users': 경계(/) 직후 'user' 연속 매치(고득점). 'auxuserx': 'u'가 비경계 위치에서
    // 시작하는 연속 매치(저득점, 경계 보너스 없음). 'zzzz': 매치 자체 실패(제외 대상).
    const candidates = ['auxuserx', '/users', 'zzzz']
    const scored = candidates
      .map(c => ({ c, s: fuzzyScore('user', c) }))
      .filter((x): x is { c: string; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s || a.c.localeCompare(b.c))
    expect(scored.map(x => x.c)).toEqual(['/users', 'auxuserx'])
  })

  it('경계+연속 매치 품질이 같아도 쿼리 대비 텍스트가 짧을수록(관련성 높을수록) 우선한다', () => {
    const short = fuzzyScore('user', '/users')
    const long = fuzzyScore('user', '/api/v2/internal/user-management-service')
    expect(short).not.toBeNull()
    expect(long).not.toBeNull()
    expect((short as number) > (long as number)).toBe(true)
  })
})

describe('viewer.html debounce() (Wave A ST8 — 검색 input coalescing)', () => {
  it('120ms 이내 연속 호출은 마지막 인자로 1회만 실행된다', () => {
    vi.useFakeTimers()
    try {
      const debounce = loadDebounce()
      const calls: string[] = []
      const debounced = debounce((v: string) => calls.push(v), 120)

      debounced('b')
      vi.advanceTimersByTime(40)
      debounced('bl')
      vi.advanceTimersByTime(40)
      debounced('blo')
      vi.advanceTimersByTime(40)
      debounced('blog')
      expect(calls).toEqual([]) // 아직 debounce 대기 중 — 실행 안 됨

      vi.advanceTimersByTime(120)
      expect(calls).toEqual(['blog']) // 마지막 값만, 정확히 1회
    } finally {
      vi.useRealTimers()
    }
  })

  it('호출 간격이 delay보다 크면 각각 독립 실행된다', () => {
    vi.useFakeTimers()
    try {
      const debounce = loadDebounce()
      const calls: string[] = []
      const debounced = debounce((v: string) => calls.push(v), 120)

      debounced('a')
      vi.advanceTimersByTime(150)
      debounced('b')
      vi.advanceTimersByTime(150)
      expect(calls).toEqual(['a', 'b'])
    } finally {
      vi.useRealTimers()
    }
  })
})
