import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const viewerHtml = fs.readFileSync(path.join(__dirname, '..', 'media', 'viewer.html'), 'utf8')

function extractFn(name: string): string {
  const re = new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`)
  const m = viewerHtml.match(re)
  if (m === null) throw new Error(`${name}() 함수를 viewer.html에서 찾을 수 없음`)
  return m[0]
}

function extractConst(name: string): string {
  const re = new RegExp(`^const ${name} = .*$`, 'm')
  const m = viewerHtml.match(re)
  if (m === null) throw new Error(`${name} 상수를 viewer.html에서 찾을 수 없음`)
  return m[0]
}

function loadFuzzyScore(): (query: string, text: string, abbrevText?: string) => number | null {
  const src = [
    extractConst('WORD_BOUNDARY_RE'),
    extractConst('TIER1_BASE'),
    extractConst('TIER2_BASE'),
    extractConst('TIER3_BASE'),
    extractFn('wordInitials'),
    extractFn('substringScore'),
    extractFn('fuzzyScore'),
  ].join('\n')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${src}\nreturn fuzzyScore;`) as () => (query: string, text: string, abbrevText?: string) => number | null
  return factory()
}

function loadDebounce(): <A extends unknown[]>(fn: (...args: A) => void, ms: number) => (...args: A) => void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${extractFn('debounce')}\nreturn debounce;`) as () => <A extends unknown[]>(fn: (...args: A) => void, ms: number) => (...args: A) => void
  return factory()
}

describe('viewer.html fuzzyScore() — T3 검색 매칭 규약 (v1.2.62 재작성)', () => {
  const fuzzyScore = loadFuzzyScore()

  it('빈 쿼리는 전체 매치(점수 0)로 취급한다', () => {
    expect(fuzzyScore('', '/blog/[slug]/page.tsx')).toBe(0)
    expect(fuzzyScore('   ', '/blog/[slug]/page.tsx')).toBe(0)
  })

  it('대소문자를 무시하고 매치한다', () => {
    expect(fuzzyScore('BLOG', '/blog/page.tsx')).not.toBeNull()
    expect(fuzzyScore('blog', '/BLOG/PAGE.TSX')).not.toBeNull()
  })

  // 이 스펙이 v1.2.61 결함의 회귀 방지 핵심 — 임의 subsequence 매칭이 "연관 없는 대상도
  // 활성화"의 직접 원인이었다(사용자 보고). 문자만 순서대로 흩어진 것은 매치가 아니다.
  it('문자가 흩어진 임의 부분열은 매치되지 않는다(오탐 회귀 방지)', () => {
    // v1.2.61에서는 셋 다 매치됐다 — 순서만 맞으면 성립하는 subsequence였기 때문.
    expect(fuzzyScore('user', '/dashboard/settings/profile-editor')).toBeNull() // u…s…e…r 존재
    expect(fuzzyScore('bgt', '/blog/page.tsx')).toBeNull() // b…g…t 존재하지만 단어경계 아님
    expect(fuzzyScore('acd', '/api/components/edit')).toBeNull() // a…c…d 존재하지만 단어경계 아님
    expect(fuzzyScore('sve', '/services/view')).toBeNull() // s…v…e 존재
  })

  it('순서를 지키지 않는 문자열은 당연히 매치 실패다', () => {
    expect(fuzzyScore('golb', '/blog/page.tsx')).toBeNull()
  })

  it('Tier 1 — 연속 부분문자열은 매치한다', () => {
    expect(fuzzyScore('user', '/users')).not.toBeNull()
    expect(fuzzyScore('user', 'UserProfileCard')).not.toBeNull()
    expect(fuzzyScore('rofile', 'UserProfileCard')).not.toBeNull() // 단어 중간 매치도 허용
  })

  it('단어 경계에서 시작하는 매치가 단어 중간 매치보다 높은 점수를 받는다', () => {
    const atBoundary = fuzzyScore('page', '/blog/page.tsx') as number
    const midWord = fuzzyScore('log', '/blog/page.tsx') as number
    expect(atBoundary).not.toBeNull()
    expect(midWord).not.toBeNull()
    expect(atBoundary > midWord).toBe(true)
  })

  it('매치 품질이 같으면 쿼리 대비 텍스트가 짧을수록(관련성 높을수록) 우선한다', () => {
    const short = fuzzyScore('user', '/users') as number
    const long = fuzzyScore('user', '/api/v2/internal/user-management-service') as number
    expect(short > long).toBe(true)
  })

  it('Tier 2 — 공백 구분 다중 term은 전부 포함(AND)될 때만 매치한다', () => {
    expect(fuzzyScore('user detail', '/api/user/detail')).not.toBeNull()
    expect(fuzzyScore('user detail', '/api/user/list')).toBeNull() // detail 없음
    expect(fuzzyScore('detail user', '/api/user/detail')).not.toBeNull() // 순서 무관
  })

  it('Tier 1(연속 매치)이 Tier 2(다중 term)보다 높은 점수를 받는다', () => {
    const tier1 = fuzzyScore('user', '/api/user/detail') as number
    const tier2 = fuzzyScore('api detail', '/api/user/detail') as number
    expect(tier1 > tier2).toBe(true)
  })

  it('Tier 3 — 단어경계 약어는 매치하되 비경계 문자 매칭은 불허한다', () => {
    expect(fuzzyScore('upc', 'UserProfileCard')).not.toBeNull() // U-P-C 각 단어 시작
    expect(fuzzyScore('aud', '/api/user/detail')).not.toBeNull() // a-u-d 각 세그먼트 시작
    expect(fuzzyScore('urc', 'UserProfileCard')).toBeNull() // 'r'은 단어 시작이 아님
  })

  it('1글자 쿼리는 약어로 취급하지 않는다(부분문자열로만 매치)', () => {
    expect(fuzzyScore('u', '/users')).not.toBeNull() // 부분문자열로 매치
    expect(fuzzyScore('u', 'ProfileCard')).toBeNull() // 약어 폴백 없음
  })

  it('Tier 1 > Tier 3 — 약어 매치는 실제 부분문자열 매치보다 낮게 정렬된다', () => {
    const direct = fuzzyScore('upc', '/upcoming') as number
    const abbrev = fuzzyScore('upc', 'UserProfileCard') as number
    expect(direct > abbrev).toBe(true)
  })

  // 렌더된 라벨에는 장식(📁 · SSR · 🔗 · "2 routes")이 섞인다. 그 장식 단어의 이니셜까지 약어
  // 후보가 되면 '2r' 같은 무의미 쿼리가 매치돼 사용자가 보고한 오탐이 되살아난다.
  it('Tier 3 약어는 라벨 장식이 아니라 의미 있는 이름에서만 이니셜을 뽑는다', () => {
    const label = '/blog/archive 📁 /archive · 2 routes'
    expect(fuzzyScore('2r', label)).not.toBeNull() // abbrevText 미지정 시엔 장식까지 포함(하위호환)
    expect(fuzzyScore('2r', label, '/blog/archive')).toBeNull() // 이름으로 좁히면 탈락
    expect(fuzzyScore('ba', label, '/blog/archive')).not.toBeNull() // 진짜 약어는 살아남는다
  })

  it('동일 쿼리로 후보를 점수 내림차순 정렬하면 결정론적 순서를 얻는다', () => {
    const candidates = ['auxuserx', '/users', 'zzzz', 'UserSettingsCard']
    const scored = candidates
      .map(c => ({ c, s: fuzzyScore('user', c) }))
      .filter((x): x is { c: string; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s || a.c.localeCompare(b.c))
    // 'zzzz'는 탈락. '/users'가 경계+최고밀도로 1위.
    expect(scored[0]?.c).toBe('/users')
    expect(scored.map(x => x.c)).not.toContain('zzzz')
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
