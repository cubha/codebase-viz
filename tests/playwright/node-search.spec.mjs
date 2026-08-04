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

  test('Tab3(ERD)에는 검색바가 없다', async ({ page }) => {
    await loadHarness(page, { rendering: 'graph TD\n  a["a"]', screenComponent: '', dbScreen: 'erDiagram' })
    await expect(page.locator('#p-d .search-input')).toHaveCount(0)
  })
})
