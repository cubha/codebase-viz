import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..', '..', '..')
const webviewTs = fs.readFileSync(path.join(__dirname, 'webview.ts'), 'utf8')
const viewerHtml = fs.readFileSync(path.join(__dirname, '..', 'media', 'viewer.html'), 'utf8')

// webview.ts가 런타임 정본(canonical) producer다. 아래 3개는 viewer.html을 standalone 구동하는
// 개발용 harness/도구로, 같은 window.__X__ 계약을 각자 하드코딩 seed한다 — webview.ts만 rename하고
// 이들을 빠뜨리면 viewer.html이 새 이름을 읽으려 할 때 이 harness들은 조용히 빈 데이터를 주입한다.
const HARNESS_PRODUCERS = [
  path.join(repoRoot, 'scripts', 'viewer-perf.mjs'),
  path.join(repoRoot, 'scripts', 'render-harness.mjs'),
  path.join(repoRoot, 'packages', 'extension', 'scripts', 'build-gifs.mjs'),
  // Playwright 스펙도 page.addInitScript로 동일 계약을 seed하는 producer다 — ST4 rename 때
  // 정확히 이 두 파일이 빠져 발생한 드리프트를 다시 겪지 않도록 가드 범위에 편입한다.
  path.join(repoRoot, 'tests', 'playwright', 'csp.spec.mjs'),
  path.join(repoRoot, 'tests', 'playwright', 'viewer-overload.spec.mjs'),
]

function extractGlobalNames(source: string): Set<string> {
  const names = new Set<string>()
  const re = /window\.__([A-Za-z0-9_]+)__/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) names.add(m[1])
  return names
}

describe('webview.ts ↔ viewer.html 전역명 쌍 매칭 (ST0)', () => {
  it('webview.ts가 정의하는 모든 window.__X__ 전역은 viewer.html에서 참조된다', () => {
    const defined = extractGlobalNames(webviewTs)
    const referenced = extractGlobalNames(viewerHtml)
    const missing = [...defined].filter(name => !referenced.has(name))
    expect(missing, `viewer.html에서 참조되지 않는 전역: ${missing.join(', ')}`).toEqual([])
  })

  it('viewer.html이 참조하는 모든 window.__X__ 전역은 webview.ts에서 정의된다', () => {
    const defined = extractGlobalNames(webviewTs)
    const referenced = extractGlobalNames(viewerHtml)
    const orphaned = [...referenced].filter(name => !defined.has(name))
    expect(orphaned, `webview.ts에서 정의되지 않는 참조: ${orphaned.join(', ')}`).toEqual([])
  })

  it.each(HARNESS_PRODUCERS)(
    'harness %s가 정의하는 모든 window.__X__ 전역은 viewer.html에서 참조된다',
    harnessPath => {
      const source = fs.readFileSync(harnessPath, 'utf8')
      const defined = extractGlobalNames(source)
      const referenced = extractGlobalNames(viewerHtml)
      const missing = [...defined].filter(name => !referenced.has(name))
      expect(missing, `${harnessPath}: viewer.html에서 참조되지 않는 전역: ${missing.join(', ')}`).toEqual([])
    },
  )
})
