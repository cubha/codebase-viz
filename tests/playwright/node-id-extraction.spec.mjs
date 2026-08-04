/**
 * Wave A ST3 — mermaid v11 SVG .node id 형식 실측 스파이크.
 *
 * 배경: T1(딥링크)·T2(hover)는 클릭/hover된 SVG 노드에서 sanitized id를 역추출해
 * nodeMap(ST1/ST2)을 조회해야 한다. mermaid의 실제 id 부여 형식은 공식 문서로
 * 확인되지 않으므로 이 스펙으로 고정한다: `<renderId>-flowchart-<sanitizedId>-<seq>`.
 * sanitizeId(packages/renderer/src/helpers/ids.ts)가 `[^a-zA-Z0-9_]→_`라 sanitized id
 * 자체는 '-'를 포함하지 않으므로, `/-flowchart-(.+)-\d+$/` 추출이 모호성 없이 안전하다.
 *
 * Usage: npx playwright test tests/playwright/node-id-extraction.spec.mjs
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIEWER_PATH = path.resolve(__dirname, '../../packages/extension/media/viewer.html')
const MERMAID_LOCAL = path.resolve(__dirname, '../../packages/extension/media/mermaid.min.js')

// ST5/ST6이 실제 채택할 추출 규약 — 여기서 실측 고정, 구현부는 이 정규식을 그대로 재사용해야 한다.
export const NODE_ID_EXTRACT_RE = /-flowchart-(.+)-\d+$/

function buildHarness() {
  const template = fs.readFileSync(VIEWER_PATH, 'utf8')
  const withLocalMermaid = template.replace(
    '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>',
    `<script src="file://${MERMAID_LOCAL}"></script>`,
  )
  const tmpPath = path.join(os.tmpdir(), `codebase-viz-node-id-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  fs.writeFileSync(tmpPath, withLocalMermaid, 'utf8')
  return 'file://' + tmpPath
}

async function loadDiagram(page, diagrams) {
  const url = buildHarness()
  await page.addInitScript((d) => {
    window.__CODEBASE_VIZ_DIAGRAMS__ = d
    window.__CODEBASE_VIZ_META__ = { projectName: 'NodeId-Test', routeCount: 2, tableCount: 0 }
  }, diagrams)
  await page.goto(url)
  await page.waitForSelector('#i-r svg', { timeout: 10000 })
  await page.waitForTimeout(300)
}

test.describe('Wave A ST3 — SVG .node id 추출 계약', () => {
  test('단일 SVG(Tab1) — .node id에서 정규식으로 sanitized id를 무손실 역추출한다', async ({ page }) => {
    const sid = 'route_app_blog_page_tsx_page'
    const diagram = `graph TD\n  ${sid}["/blog"]\n`
    await loadDiagram(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    const nodeEls = await page.locator('#i-r svg .node').all()
    expect(nodeEls.length).toBeGreaterThan(0)
    const rawId = await nodeEls[0].getAttribute('id')
    expect(rawId).toBeTruthy()
    const m = NODE_ID_EXTRACT_RE.exec(rawId ?? '')
    expect(m?.[1]).toBe(sid)
  })

  test('subgraph(cluster) 요소는 .node에 섞이지 않는다', async ({ page }) => {
    const sid = 'route_src_api_v1_users_page'
    const diagram = `graph TD\n  subgraph BE_PROJ["Backend"]\n    ${sid}["/api/v1/users"]\n  end\n`
    await loadDiagram(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    const nodeIds = await page.locator('#i-r svg .node').evaluateAll(els => els.map(e => e.id))
    expect(nodeIds).toHaveLength(1)
    expect(NODE_ID_EXTRACT_RE.exec(nodeIds[0])?.[1]).toBe(sid)
    // cluster(subgraph wrapper) id는 .node 셀렉터에 걸리지 않아야 한다.
    const clusterIds = await page.locator('#i-r svg .cluster').evaluateAll(els => els.map(e => e.id))
    expect(clusterIds.some(id => id.includes('BE_PROJ'))).toBe(true)
    expect(nodeIds.some(id => id.includes('BE_PROJ'))).toBe(false)
  })

  test('row-mode 다중 청크(독립 SVG) — 동일 sanitized id가 각 청크에서 chunk-local로 정상 추출된다', async ({ page }) => {
    const sid = 'shared_leaf_node'
    const CHUNK_SEPARATOR = '%%--CHUNK--%%'
    const diagram = [
      `graph TD\n  ${sid}["chunk A"]`,
      `graph TD\n  ${sid}["chunk B"]`,
    ].join(`\n${CHUNK_SEPARATOR}\n`)
    await loadDiagram(page, { rendering: diagram, screenComponent: '', dbScreen: '' })

    const rows = await page.locator('#i-r .row-diagram').count()
    expect(rows).toBe(2)
    for (let i = 0; i < rows; i++) {
      const nodeIds = await page.locator('#i-r .row-diagram').nth(i).locator('.node').evaluateAll(els => els.map(e => e.id))
      expect(nodeIds).toHaveLength(1)
      expect(NODE_ID_EXTRACT_RE.exec(nodeIds[0])?.[1]).toBe(sid)
    }
  })
})
