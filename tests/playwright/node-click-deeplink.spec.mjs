/**
 * Wave A ST5 — T1 딥링크 완결: viewer.html 클릭 위임 + 드래그 억제 E2E 검증.
 * ST1~ST4가 만든 nodeMap 사이드채널 + openNode 메시지 프로토콜을, 실제 클릭/드래그
 * 이벤트로 배선했는지 확인한다(순수 로직이 아닌 DOM 배선이라 TDD 제외, E2E로 검증).
 *
 * Usage: npx playwright test tests/playwright/node-click-deeplink.spec.mjs
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
  const tmpPath = path.join(os.tmpdir(), `codebase-viz-node-click-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  fs.writeFileSync(tmpPath, withLocalMermaid, 'utf8')
  return 'file://' + tmpPath
}

const SID = 'route_app_blog_page_tsx_page'
const NODE_MAP = { [SID]: { f: 'app/blog/page.tsx', l: 12, c: 'verified', n: '/blog' } }

async function loadWithVsApiMock(page, diagrams) {
  const url = buildHarness()
  await page.addInitScript(({ d, nm }) => {
    window.__posted = []
    window.acquireVsCodeApi = () => ({ postMessage: msg => window.__posted.push(msg) })
    window.__CODEBASE_VIZ_DIAGRAMS__ = { ...d, nodeMap: nm }
    window.__CODEBASE_VIZ_META__ = { projectName: 'ClickTest', routeCount: 1, tableCount: 0 }
  }, { d: diagrams, nm: NODE_MAP })
  await page.goto(url)
  await page.waitForSelector('#i-r svg', { timeout: 10000 })
  await page.waitForTimeout(300)
}

test.describe('Wave A ST5 — T1 딥링크 클릭 배선', () => {
  test('nodeMap에 매핑된 노드를 클릭하면 openNode 메시지를 postMessage한다', async ({ page }) => {
    const diagram = `graph TD\n  ${SID}["/blog"]\n`
    await loadWithVsApiMock(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    await page.locator('#i-r svg .node').first().click()
    const posted = await page.evaluate(() => window.__posted)
    expect(posted).toEqual([{ type: 'openNode', id: SID }])
  })

  test('클릭 시 150ms 정도 outline 펄스 클래스가 붙었다 사라진다', async ({ page }) => {
    const diagram = `graph TD\n  ${SID}["/blog"]\n`
    await loadWithVsApiMock(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    const nodeEl = page.locator('#i-r svg .node').first()
    await nodeEl.click()
    await expect(nodeEl).toHaveClass(/node-click-pulse/)
    await page.waitForTimeout(250)
    await expect(nodeEl).not.toHaveClass(/node-click-pulse/)
  })

  test('nodeMap에 없는 노드(sid 미매핑)를 클릭해도 무반응이다', async ({ page }) => {
    const diagram = `graph TD\n  unmapped_node_id["orphan"]\n`
    await loadWithVsApiMock(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    await page.locator('#i-r svg .node').first().click()
    const posted = await page.evaluate(() => window.__posted)
    expect(posted).toEqual([])
  })

  test('노드 위에서 드래그(팬) 후 놓으면 클릭으로 오인해 점프하지 않는다', async ({ page }) => {
    const diagram = `graph TD\n  ${SID}["/blog"]\n`
    await loadWithVsApiMock(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    const nodeEl = page.locator('#i-r svg .node').first()
    const box = await nodeEl.boundingBox()
    const startX = box.x + box.width / 2, startY = box.y + box.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 40, startY + 40, { steps: 5 })
    await page.mouse.up()

    const posted = await page.evaluate(() => window.__posted)
    expect(posted).toEqual([])
  })

  test('row-mode(다중 청크)에서도 클릭이 chunk-local로 정상 동작한다', async ({ page }) => {
    const CHUNK_SEPARATOR = '%%--CHUNK--%%'
    const diagram = [
      `graph TD\n  chunk_a_only["A"]`,
      `graph TD\n  ${SID}["/blog"]`,
    ].join(`\n${CHUNK_SEPARATOR}\n`)
    await loadWithVsApiMock(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    await expect(page.locator('#i-r .row-diagram')).toHaveCount(2)
    await page.locator('#i-r .row-diagram').nth(1).locator('.node').first().click()
    const posted = await page.evaluate(() => window.__posted)
    expect(posted).toEqual([{ type: 'openNode', id: SID }])
  })
})
