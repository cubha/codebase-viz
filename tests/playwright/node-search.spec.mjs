/**
 * Wave A ST8 — T3 검색 완결: viewer.html 검색바 UI + dim 필터 E2E 검증.
 * ST7의 fuzzyScore를 실제 DOM에 배선한 것 — 순수 로직 아닌 UI 배선이라 TDD 제외, E2E로 검증.
 *
 * Usage: npx playwright test tests/playwright/node-search.spec.mjs
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIEWER_PATH = path.resolve(__dirname, '../../packages/extension/media/viewer.html')
const MERMAID_LOCAL = path.resolve(__dirname, '../../packages/extension/media/mermaid.min.js')

function buildHarness() {
  const template = fs.readFileSync(VIEWER_PATH, 'utf8')
  const withLocalMermaid = template.replace(
    '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>',
    `<script src="file://${MERMAID_LOCAL}"></script>`,
  )
  const tmpPath = path.join(os.tmpdir(), `codebase-viz-node-search-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  fs.writeFileSync(tmpPath, withLocalMermaid, 'utf8')
  return 'file://' + tmpPath
}

async function loadHarness(page, diagrams) {
  const url = buildHarness()
  await page.addInitScript(d => {
    window.__CODEBASE_VIZ_DIAGRAMS__ = d
    window.__CODEBASE_VIZ_META__ = { projectName: 'SearchTest', routeCount: 2, tableCount: 0 }
    // 확장은 항상 i18n dict를 주입한다 — 하니스도 동일 조건으로 맞춰야 카운트 문구를 검증할 수 있다.
    window.__CODEBASE_VIZ_I18N__ = { 'search.matchCount': '{n}건 일치', 'search.noMatch': '일치 없음' }
  }, diagrams)
  await page.goto(url)
  await page.waitForSelector('#i-r svg', { timeout: 10000 })
  await page.waitForTimeout(300)
}

test.describe('Wave A ST8 — T3 검색바 + dim 필터', () => {
  test('쿼리 입력 시 미매칭 노드만 dim(opacity 0.15) 처리한다', async ({ page }) => {
    const diagram = `graph TD\n  route_blog["blog"]\n  route_about["about"]\n`
    await loadHarness(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    await page.fill('#search-r', 'blog')
    const blogNode = page.locator('#i-r svg .node').filter({ hasText: 'blog' })
    const aboutNode = page.locator('#i-r svg .node').filter({ hasText: 'about' })
    await expect(aboutNode).toHaveClass(/node-dim/, { timeout: 2000 })
    await expect(blogNode).not.toHaveClass(/node-dim/)
  })

  test('검색어를 지우면 모든 dim이 해제된다', async ({ page }) => {
    const diagram = `graph TD\n  route_blog["blog"]\n  route_about["about"]\n`
    await loadHarness(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    await page.fill('#search-r', 'blog')
    const aboutNode = page.locator('#i-r svg .node').filter({ hasText: 'about' })
    await expect(aboutNode).toHaveClass(/node-dim/, { timeout: 2000 })

    await page.fill('#search-r', '')
    await expect(aboutNode).not.toHaveClass(/node-dim/, { timeout: 2000 })
  })

  test('ESC 키는 검색어를 지우고 dim을 해제하며 입력 포커스를 블러한다', async ({ page }) => {
    const diagram = `graph TD\n  route_blog["blog"]\n  route_about["about"]\n`
    await loadHarness(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    const input = page.locator('#search-r')
    await input.fill('blog')
    const aboutNode = page.locator('#i-r svg .node').filter({ hasText: 'about' })
    await expect(aboutNode).toHaveClass(/node-dim/, { timeout: 2000 })

    await input.press('Escape')
    await expect(input).toHaveValue('')
    await expect(aboutNode).not.toHaveClass(/node-dim/, { timeout: 2000 })
    await expect(input).not.toBeFocused()
  })

  test('row-mode(다중 청크) 전체에 걸쳐 검색이 동작한다', async ({ page }) => {
    const CHUNK_SEPARATOR = '%%--CHUNK--%%'
    const diagram = [
      `graph TD\n  route_blog["blog"]`,
      `graph TD\n  route_about["about"]`,
    ].join(`\n${CHUNK_SEPARATOR}\n`)
    await loadHarness(page, { rendering: diagram, screenComponent: '', dbScreen: '' })
    await expect(page.locator('#i-r .row-diagram')).toHaveCount(2)

    await page.fill('#search-r', 'about')
    const blogNode = page.locator('#i-r .node').filter({ hasText: 'blog' })
    const aboutNode = page.locator('#i-r .node').filter({ hasText: 'about' })
    await expect(blogNode).toHaveClass(/node-dim/, { timeout: 2000 })
    await expect(aboutNode).not.toHaveClass(/node-dim/)
  })

  test('nodeMap 표시명(n)이 있으면 그 값으로 검색하고, 없으면 렌더된 텍스트로 폴백한다', async ({ page }) => {
    const sid = 'route_app_blog_page_tsx_page'
    const diagram = `graph TD\n  ${sid}["displayed-label"]\n  unmapped_node["orphan-label"]\n`
    await loadHarness(page, {
      rendering: diagram, screenComponent: '', dbScreen: '',
      nodeMap: { [sid]: { f: 'x', l: 1, c: 'verified', n: '/blog-route' } },
    })

    // nodeMap.n 검색: 렌더된 라벨("displayed-label")이 아니라 n("/blog-route")로 매치돼야 한다.
    await page.fill('#search-r', 'blog-route')
    const mapped = page.locator('#i-r svg .node').filter({ hasText: 'displayed-label' })
    const unmapped = page.locator('#i-r svg .node').filter({ hasText: 'orphan-label' })
    await expect(unmapped).toHaveClass(/node-dim/, { timeout: 2000 })
    await expect(mapped).not.toHaveClass(/node-dim/)

    // 미매핑 노드는 렌더된 텍스트("orphan-label")로 폴백 검색된다.
    await page.fill('#search-r', 'orphan')
    await expect(mapped).toHaveClass(/node-dim/, { timeout: 2000 })
    await expect(unmapped).not.toHaveClass(/node-dim/)
  })

  // ── v1.2.62: 매칭 규칙 엄격화 + 매칭 타깃 하이라이트 ──────────────────────────
  test('매칭 노드에 node-match 하이라이트가, 미매칭에는 node-dim이 붙는다', async ({ page }) => {
    const diagram = `graph TD\n  route_blog["/blog"]\n  route_about["/about"]\n`
    await loadHarness(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    await page.fill('#search-r', 'blog')
    const blogNode = page.locator('#i-r svg .node').filter({ hasText: 'blog' })
    const aboutNode = page.locator('#i-r svg .node').filter({ hasText: 'about' })
    await expect(blogNode).toHaveClass(/node-match/, { timeout: 2000 })
    await expect(blogNode).not.toHaveClass(/node-dim/)
    await expect(aboutNode).toHaveClass(/node-dim/)
    await expect(aboutNode).not.toHaveClass(/node-match/)
  })

  // v1.2.61 결함 회귀 — 임의 subsequence 매칭이 무관 노드까지 살려두어 dim이 무력화됐다.
  test('흩어진 문자 매칭은 더 이상 살아남지 않는다(오탐 회귀)', async ({ page }) => {
    const diagram = `graph TD\n  n1["/users"]\n  n2["/dashboard/settings/profile-editor"]\n`
    await loadHarness(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    await page.fill('#search-r', 'user')
    const hit = page.locator('#i-r svg .node').filter({ hasText: '/users' })
    const noise = page.locator('#i-r svg .node').filter({ hasText: 'profile-editor' })
    await expect(hit).toHaveClass(/node-match/, { timeout: 2000 })
    await expect(noise).toHaveClass(/node-dim/)
  })

  test('하위에 매치가 없는 subgraph(cluster)도 함께 dim된다', async ({ page }) => {
    const diagram = `graph TD\n  subgraph G_BLOG["blog group"]\n    n_blog["/blog"]\n  end\n  subgraph G_ADMIN["admin group"]\n    n_admin["/admin"]\n  end\n`
    await loadHarness(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    await page.fill('#search-r', 'blog')
    await page.waitForTimeout(300)
    const dimmed = await page.evaluate(() =>
      [...document.querySelectorAll('#i-r svg .cluster')]
        .map(c => ({ id: c.id, dim: c.classList.contains('node-dim') })))
    const blog = dimmed.find(c => c.id.endsWith('G_BLOG'))
    const admin = dimmed.find(c => c.id.endsWith('G_ADMIN'))
    expect(blog.dim).toBe(false)
    expect(admin.dim).toBe(true)
  })

  test('매치 건수가 검색바 옆에 표시되고, 0건이면 "일치 없음"을 표시한다', async ({ page }) => {
    const diagram = `graph TD\n  n1["/blog"]\n  n2["/blog/archive"]\n  n3["/about"]\n`
    await loadHarness(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    await page.fill('#search-r', 'blog')
    await expect(page.locator('#count-r')).toHaveText(/2/, { timeout: 2000 })

    await page.fill('#search-r', 'zzzznope')
    await expect(page.locator('#count-r')).toHaveClass(/zero/, { timeout: 2000 })

    await page.fill('#search-r', '')
    await expect(page.locator('#count-r')).toHaveText('', { timeout: 2000 })
  })

  test('ESC는 match/dim/카운트를 모두 초기화한다', async ({ page }) => {
    const diagram = `graph TD\n  n1["/blog"]\n  n2["/about"]\n`
    await loadHarness(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    const input = page.locator('#search-r')
    await input.fill('blog')
    const blogNode = page.locator('#i-r svg .node').filter({ hasText: 'blog' })
    await expect(blogNode).toHaveClass(/node-match/, { timeout: 2000 })

    await input.press('Escape')
    await expect(blogNode).not.toHaveClass(/node-match/, { timeout: 2000 })
    await expect(page.locator('#i-r svg .node').filter({ hasText: 'about' })).not.toHaveClass(/node-dim/)
    await expect(page.locator('#count-r')).toHaveText('')
  })

  // 클래스 존재 assertion으로는 "구분이 되는가"를 증명하지 못한다(사용자 보고는 지각 문제였다).
  // 실제 렌더 계산값 + 스크린샷으로 대비를 남긴다.
  test('매칭/미매칭의 실제 렌더 대비를 계산값과 스크린샷으로 남긴다', async ({ page }) => {
    const diagram = [
      'graph TD',
      '  classDef ssr fill:#0d1a0d,stroke:#16a34a,color:#86efac',
      '  classDef pkg fill:#0c1018,stroke:#475569,color:#cbd5e1',
      '  subgraph G_BLOG["📁 /blog · 4 routes"]',
      '    n_blog["📁 /blog · 4 routes"]:::pkg',
      '    n_blogarch["archive · SSR<br/>🔗 /blog/archive"]:::ssr',
      '  end',
      '  subgraph G_ADMIN["📁 /admin · 3 routes"]',
      '    n_users["users · SSR<br/>🔗 /admin/users"]:::ssr',
      '    n_settings["settings · SSR<br/>🔗 /admin/settings"]:::ssr',
      '  end',
      '  n_home["/ · SSR"]:::ssr',
      '  n_home --> n_blog',
      '  n_home --> n_users',
    ].join('\n')
    await loadHarness(page, { rendering: diagram, screenComponent: '', dbScreen: '' })
    await page.screenshot({ path: 'tests/playwright/screenshots/search-before.png' })

    await page.fill('#search-r', 'blog')
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'tests/playwright/screenshots/search-after.png' })

    const styles = await page.evaluate(() =>
      [...document.querySelectorAll('#i-r svg .node')].map(n => {
        const shape = n.querySelector('rect,polygon,circle,ellipse,path')
        const cs = getComputedStyle(shape)
        return {
          match: n.classList.contains('node-match'),
          width: cs.strokeWidth,
          glow: cs.filter,
          opacity: getComputedStyle(n).opacity,
          gray: getComputedStyle(n).filter,
        }
      }))
    const hit = styles.filter(s => s.match)
    const miss = styles.filter(s => !s.match)
    expect(hit.length).toBeGreaterThan(0)
    expect(miss.length).toBeGreaterThan(0)
    for (const h of hit) {
      expect(h.width).toBe('2.5px')
      expect(h.glow).toContain('drop-shadow') // 굵기만으로는 약하다 — glow가 실제 적용돼야 한다
      expect(Number(h.opacity)).toBe(1)
    }
    for (const m of miss) {
      expect(Number(m.opacity)).toBeLessThanOrEqual(0.08)
      expect(m.gray).toContain('grayscale')
    }
  })

  // v1.2.63 D8: react-router FE Tab3(flow)에는 검색바가 생겼지만, erDiagram(테이블 기반) Tab3는
  // 여전히 검색 대상이 아니다(.node가 없는 구조적 한계) — 엘리먼트 자체는 DOM에 존재하되(다른 탭과
  // 마크업 구조를 통일) display:none으로 숨겨진다. "부재"가 아니라 "숨김"으로 검증을 갱신한다.
  test('Tab3(ERD)에는 검색바가 보이지 않는다', async ({ page }) => {
    await loadHarness(page, { rendering: 'graph TD\n  a["a"]', screenComponent: '', dbScreen: 'erDiagram' })
    await page.locator('.tab[data-t="d"]').click()
    await page.waitForTimeout(300)
    await expect(page.locator('#search-wrap-d')).toBeHidden()
  })
})
