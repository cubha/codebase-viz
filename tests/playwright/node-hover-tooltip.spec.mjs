/**
 * Wave A ST6 — T2 hover 완결: viewer.html hover tooltip E2E 검증.
 * ST1의 nodeMap을 그대로 재사용하고(별도 데이터 구조 신설 없음), ST5와 동일한
 * .node 위임 경로(NODE_ID_RE)를 공유한다. UI/비결정 위치라 TDD 제외, E2E로 검증.
 *
 * Usage: npx playwright test tests/playwright/node-hover-tooltip.spec.mjs
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
  const tmpPath = path.join(os.tmpdir(), `codebase-viz-node-hover-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  fs.writeFileSync(tmpPath, withLocalMermaid, 'utf8')
  return 'file://' + tmpPath
}

const SID = 'route_app_blog_page_tsx_page'

async function loadWithNodeMap(page, diagrams, nodeMap) {
  const url = buildHarness()
  await page.addInitScript(({ d, nm }) => {
    window.__CODEBASE_VIZ_DIAGRAMS__ = { ...d, nodeMap: nm }
    window.__CODEBASE_VIZ_META__ = { projectName: 'HoverTest', routeCount: 1, tableCount: 0 }
  }, { d: diagrams, nm: nodeMap })
  await page.goto(url)
  await page.waitForSelector('#i-r svg', { timeout: 10000 })
  await page.waitForTimeout(300)
}

test.describe('Wave A ST6 — T2 hover tooltip', () => {
  test('verified 노드 hover 시 f:l + verified 배지를 보여준다 (inferenceChain 없음)', async ({ page }) => {
    const diagram = `graph TD\n  ${SID}["/blog"]\n`
    await loadWithNodeMap(page, { rendering: diagram, screenComponent: '', dbScreen: '' },
      { [SID]: { f: 'app/blog/page.tsx', l: 12, c: 'verified', n: '/blog' } })

    await page.locator('#i-r svg .node').first().hover()
    const tip = page.locator('#node-tooltip')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('app/blog/page.tsx:12')
    await expect(tip.locator('.tt-conf')).toHaveClass(/tt-verified/)
    await expect(tip.locator('.tt-chain')).toHaveCount(0)
  })

  test('inferred 노드 hover 시 amber 배지 + inferenceChain을 보여준다', async ({ page }) => {
    const diagram = `graph TD\n  ${SID}["/blog"]\n`
    await loadWithNodeMap(page, { rendering: diagram, screenComponent: '', dbScreen: '' },
      { [SID]: { f: 'app/blog/page.tsx', l: 12, c: 'inferred', i: 'heuristic: default export' } })

    await page.locator('#i-r svg .node').first().hover()
    const tip = page.locator('#node-tooltip')
    await expect(tip).toBeVisible()
    await expect(tip.locator('.tt-conf')).toHaveClass(/tt-inferred/)
    await expect(tip.locator('.tt-chain')).toContainText('heuristic: default export')
  })

  test('nodeMap에 없는 노드는 hover해도 tooltip이 보이지 않는다', async ({ page }) => {
    const diagram = `graph TD\n  unmapped_node["orphan"]\n`
    await loadWithNodeMap(page, { rendering: diagram, screenComponent: '', dbScreen: '' }, {})

    await page.locator('#i-r svg .node').first().hover()
    await expect(page.locator('#node-tooltip')).toBeHidden()
  })

  test('노드에서 벗어나면 tooltip이 숨겨진다', async ({ page }) => {
    const diagram = `graph TD\n  ${SID}["/blog"]\n`
    await loadWithNodeMap(page, { rendering: diagram, screenComponent: '', dbScreen: '' },
      { [SID]: { f: 'app/blog/page.tsx', l: 12, c: 'verified' } })

    await page.locator('#i-r svg .node').first().hover()
    await expect(page.locator('#node-tooltip')).toBeVisible()
    await page.mouse.move(5, 5)
    await expect(page.locator('#node-tooltip')).toBeHidden()
  })

  test('filePath에 HTML 태그가 섞여 있어도 이스케이프되어 문자로만 표시된다 (XSS 방지)', async ({ page }) => {
    const diagram = `graph TD\n  ${SID}["/blog"]\n`
    const payload = 'src/evil"><img src=x onerror=alert(1)>.tsx'
    await loadWithNodeMap(page, { rendering: diagram, screenComponent: '', dbScreen: '' },
      { [SID]: { f: payload, l: 1, c: 'verified' } })

    await page.locator('#i-r svg .node').first().hover()
    const tip = page.locator('#node-tooltip')
    await expect(tip).toBeVisible()
    const imgCount = await tip.locator('img').count()
    expect(imgCount).toBe(0)
    await expect(tip.locator('.tt-path')).toContainText(payload)
  })
})
