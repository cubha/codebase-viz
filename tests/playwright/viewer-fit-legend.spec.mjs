/**
 * v1.2.69 — viewer 화면 맞춤 정책(UX-2·UX-3)과 범례 가림(UX-1) E2E.
 *
 * 재실측(2026-10-06) 근거:
 *  - UX-2: 단일 모드 fit에 하한이 없어 17테이블 ERD가 0.179배(라벨 실효 ~2.9px)로 줄어 읽을 수 없었다.
 *  - UX-3: 줄 단위 모드는 fitS=1.0 상수라 폭이 넘치는 청크가 잘린 채 시작했고 reset도 같은 상태로 돌아갔다.
 *  - UX-1: 줄 단위 모드 grid가 좌상단(padding 16)에서 시작해 범례·"N rows" 칩이 첫 줄을 덮었다.
 *
 * Usage: npx playwright test tests/playwright/viewer-fit-legend.spec.mjs
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIEWER_PATH = path.resolve(__dirname, '../../packages/extension/media/viewer.html')
const MERMAID_LOCAL = path.resolve(__dirname, '../../packages/extension/media/mermaid.min.js')
const CHUNK_SEP = '%%--CHUNK--%%'
const FLOOR = 0.65

function buildHarness() {
  const template = fs.readFileSync(VIEWER_PATH, 'utf8')
  const html = template.replace(
    '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>',
    `<script src="file://${MERMAID_LOCAL}"></script>`,
  )
  const tmp = path.join(os.tmpdir(), `cv-fit-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  fs.writeFileSync(tmp, html, 'utf8')
  return 'file://' + tmp
}

// 폭이 셀(≥560px)을 크게 넘는 LR 체인 청크 — 줄 단위 모드의 폭 맞춤이 실제로 축소를 일으키게 한다.
function wideChunks(count, nodes) {
  const chunks = []
  for (let i = 0; i < count; i++) {
    const ids = Array.from({ length: nodes }, (_, j) => `C${i}N${j}`)
    chunks.push([
      'graph LR',
      ...ids.map((id, j) => `  ${id}["/api/v${i}/resource-${j}"]`),
      ...ids.slice(1).map((id, j) => `  ${ids[j]} --> ${id}`),
    ].join('\n'))
  }
  return chunks.join('\n' + CHUNK_SEP + '\n')
}

// 한 모듈에 테이블 28개(viewer row 청킹 조건 미만) — 단일 모드에서 fit이 하한 아래로 떨어지는 크기.
function bigErd(tables = 28) {
  let erd = 'erDiagram\n'
  for (let i = 0; i < tables; i++) {
    erd += `%% table:tbl_${i} path:src/mod/t${i}.sql\n  tbl_${i} {\n`
    for (let c = 0; c < 8; c++) erd += `    varchar column_name_${c}\n`
    erd += '  }\n'
    if (i > 0) erd += `  tbl_${i} }o--|| tbl_${i - 1} : "column_name_0"\n`
  }
  return erd
}

async function open(page, diagrams, viewport = { width: 1280, height: 800 }) {
  await page.setViewportSize(viewport)
  await page.addInitScript(d => {
    window.acquireVsCodeApi = () => ({ postMessage: () => {} })
    window.__CODEBASE_VIZ_DIAGRAMS__ = d
    window.__CODEBASE_VIZ_META__ = { projectName: 'FitTest', routeCount: 1, tableCount: 1 }
  }, diagrams)
  await page.goto(buildHarness())
}

const scaleOf = transform => {
  const m = /scale\(([\d.]+)\)/.exec(transform || '')
  return m ? parseFloat(m[1]) : NaN
}

test.describe('v1.2.69 — viewer 화면 맞춤 하한·범례', () => {
  test('UX-2: 단일 모드 fit은 가독 하한 아래로 줄이지 않고, 넘치면 콘텐츠 시작점(상단)을 보여준다', async ({ page }) => {
    await open(page, { rendering: 'graph TD\n  A["a"]', screenComponent: '', dbScreen: bigErd(), tab3Kind: 'erd' })
    await page.waitForSelector('#i-r svg')
    await page.click('.tab[data-t="d"]')
    await page.waitForSelector('#i-d svg .node', { timeout: 20000 })
    await page.waitForTimeout(300)
    const s = scaleOf(await page.$eval('#i-d', el => el.style.transform))
    expect(s).toBeGreaterThanOrEqual(FLOOR)
    // 하한이 실제로 개입한 조건인지(무의미 통과 방지): 하한 없이 맞췄다면 FLOOR보다 작았어야 한다.
    const raw = await page.evaluate(() => {
      const wrap = document.getElementById('w-d'); const svg = document.querySelector('#i-d svg')
      const sW = parseFloat(svg.getAttribute('width')), sH = parseFloat(svg.getAttribute('height'))
      return Math.min(wrap.clientWidth * 0.88 / sW, wrap.clientHeight * 0.88 / sH)
    })
    expect(raw).toBeLessThan(FLOOR)
    const { svgTop, wrapTop } = await page.evaluate(() => ({
      svgTop: document.querySelector('#i-d svg').getBoundingClientRect().top,
      wrapTop: document.getElementById('w-d').getBoundingClientRect().top,
    }))
    expect(svgTop).toBeGreaterThanOrEqual(wrapTop)
    expect(svgTop - wrapTop).toBeLessThan(80)
  })

  // GIF 촬영 중 발견: 하한 때문에 상단 정렬 오프셋(x,y)이 생긴 상태에서 −/+ 를 누르면 요소 중심 기준으로만
  // 배율이 바뀌어 콘텐츠가 화면 밖으로 밀려났다. 줌은 화면 중앙의 콘텐츠 지점을 고정해야 한다.
  test('UX-2 후속: 하한 정렬 상태에서 줌해도 화면 중앙의 콘텐츠 지점이 고정된다', async ({ page }) => {
    await open(page, { rendering: 'graph TD\n  A["a"]', screenComponent: '', dbScreen: bigErd(), tab3Kind: 'erd' })
    await page.waitForSelector('#i-r svg')
    await page.click('.tab[data-t="d"]')
    await page.waitForSelector('#i-d svg .node', { timeout: 20000 })
    await page.waitForTimeout(300)
    const offset = () => page.evaluate(() => {
      const w = document.getElementById('w-d').getBoundingClientRect()
      const r = document.querySelector('#i-d svg').getBoundingClientRect()
      return { dx: (r.left + r.right) / 2 - (w.left + w.right) / 2, dy: (r.top + r.bottom) / 2 - (w.top + w.bottom) / 2, s: parseFloat(/scale\(([\d.]+)\)/.exec(document.getElementById('i-d').style.transform)[1]) }
    })
    const before = await offset()
    expect(Math.abs(before.dy)).toBeGreaterThan(20) // 하한 정렬로 오프셋이 실제로 있는 조건
    for (let i = 0; i < 3; i++) await page.click('[data-action="zm"][data-arg-t="d"][data-arg-f="0.833"]')
    const after = await offset()
    const ratio = after.s / before.s
    expect(after.dy).toBeCloseTo(before.dy * ratio, 0)
    expect(after.dx).toBeCloseTo(before.dx * ratio, 0)
  })

  test('UX-3: 줄 단위 모드도 같은 정책 — 폭 맞춤(하한 0.65)으로 시작하고, 줌 후 ⌂는 그 상태로 돌아간다', async ({ page }) => {
    await open(page, { rendering: wideChunks(3, 14), screenComponent: '', dbScreen: '' })
    await page.waitForFunction(() => document.querySelectorAll('#i-r .row-diagram svg').length === 3, null, { timeout: 20000 })
    await page.waitForTimeout(300)
    const read = () => page.$$eval('#i-r .row-diagram', rows => rows.map(r => {
      const svg = r.querySelector('svg')
      return { cellW: r.clientWidth - 8, natW: parseFloat(svg.getAttribute('width')), t: svg.style.transform }
    }))
    const initial = await read()
    for (const r of initial) {
      const expected = Math.max(Math.min(r.cellW / r.natW, 1), FLOOR)
      expect(r.natW).toBeGreaterThan(r.cellW) // 폭이 넘치는 조건이어야 의미 있음
      expect(scaleOf(r.t)).toBeCloseTo(expected, 3)
      expect(scaleOf(r.t)).toBeLessThan(1)
    }
    await page.click('[data-action="zm"][data-arg-t="r"][data-arg-f="1.2"]')
    expect(scaleOf((await read())[0].t)).not.toBeCloseTo(scaleOf(initial[0].t), 3)
    await page.click('[data-action="rz"][data-arg="r"]')
    const after = await read()
    after.forEach((r, i) => expect(scaleOf(r.t)).toBeCloseTo(scaleOf(initial[i].t), 3))
  })

  test('UX-1: 줄 단위 모드 첫 줄이 범례·청크 칩 아래에서 시작하고, 범례를 접으면 올라온다', async ({ page }) => {
    await open(page, { rendering: wideChunks(3, 6), screenComponent: '', dbScreen: '' })
    await page.waitForFunction(() => document.querySelectorAll('#i-r .row-diagram svg').length === 3, null, { timeout: 20000 })
    await page.waitForTimeout(300)
    const geom = () => page.evaluate(() => {
      const legend = document.querySelector('#p-r .legend').getBoundingClientRect()
      const nav = document.getElementById('cnav-r').getBoundingClientRect()
      const row = document.querySelector('#i-r .row-diagram').getBoundingClientRect()
      return { legendBottom: legend.bottom, navBottom: nav.bottom, rowTop: row.top }
    })
    const open1 = await geom()
    expect(open1.rowTop).toBeGreaterThanOrEqual(open1.legendBottom)
    expect(open1.rowTop).toBeGreaterThanOrEqual(open1.navBottom)

    const toggle = page.locator('#p-r .legend-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#p-r .legend .legend-row').first()).toBeHidden()
    const closed = await geom()
    expect(closed.rowTop).toBeLessThan(open1.rowTop)
    expect(closed.rowTop).toBeGreaterThanOrEqual(closed.legendBottom)

    await toggle.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('#p-r .legend .legend-row').first()).toBeVisible()
  })

  test('작은 다이어그램은 확대하지 않는다(상한 1.0 유지)', async ({ page }) => {
    await open(page, { rendering: 'graph TD\n  A["a"] --> B["b"]', screenComponent: '', dbScreen: '' })
    await page.waitForSelector('#i-r svg .node')
    await page.waitForTimeout(300)
    expect(scaleOf(await page.$eval('#i-r', el => el.style.transform))).toBe(1)
  })
})
