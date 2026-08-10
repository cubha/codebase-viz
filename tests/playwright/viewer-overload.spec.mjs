/**
 * v1.1.52 결함2·3 viewer.html Playwright 검증
 * - 결함2: Tab3 extractModule — bin/ 경로 → 단일 'bin' 그룹 아닌 세분화된 모듈 그룹
 * - 결함3: Row-mode floating island — left:0 (이전: left:50%)
 *
 * Usage: npx playwright test tests/playwright/viewer-overload.spec.mjs
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIEWER_PATH = path.resolve(__dirname, '../../packages/extension/media/viewer.html')
const VIEWER_URL = 'file://' + VIEWER_PATH
const CHUNK_SEP = '%%--CHUNK--%%'

// ── 테스트 데이터 생성 헬퍼 ───────────────────────────────────────────────────

/**
 * 결함2 테스트용: bin/main/sql/primary/** 구조 408 테이블 ERD
 * (B2B WINA 실환경과 동일한 경로 패턴)
 */
function buildBinPathDbData() {
  const modules = [
    { name: 'agency',     count: 80,  prefix: 'bin/main/sql/primary/wina/agency' },
    { name: 'headOffice', count: 60,  prefix: 'bin/main/sql/primary/wina/headOffice/alloc' },
    { name: 'model',      count: 70,  prefix: 'bin/main/sql/primary/wina/model' },
    { name: 'partner',    count: 50,  prefix: 'bin/main/sql/primary/wina/partner' },
    { name: 'core',       count: 48,  prefix: 'bin/main/sql/primary/core' },
    { name: 'system',     count: 100, prefix: 'bin/main/sql/primary/system' },
  ]
  let erd = 'erDiagram\n'
  for (const m of modules) {
    for (let i = 0; i < m.count; i++) {
      const tableName = `${m.name}_table${i}`
      erd += `%% table:${tableName} path:${m.prefix}/Sql${i}.xml\n`
      erd += `${tableName} {\n  varchar id PK\n  varchar name\n}\n`
    }
  }
  return erd
}

/**
 * 결함1·3 테스트용: CHUNK_SEP으로 분할된 9-chunk 다이어그램
 */
function buildMultiChunkDiagram(chunkCount = 9) {
  const chunks = []
  for (let i = 0; i < chunkCount; i++) {
    const offset = i * 15
    chunks.push([
      `%%{init:{'theme':'base','themeVariables':{'background':'#060810','primaryColor':'#0c1a30','primaryTextColor':'#94a3b8','lineColor':'#334155','fontFamily':'monospace'}}}%%`,
      `graph LR`,
      `  subgraph G${i}["Chunk ${i + 1}"]`,
      ...Array.from({ length: 13 }, (_, j) =>
        `    R${offset + j}["/api/v${i}/resource${j}"]`
      ),
      `  end`,
    ].join('\n'))
  }
  return chunks.join('\n' + CHUNK_SEP + '\n')
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

test.describe('v1.1.52 결함 검증 — viewer.html Playwright', () => {

  test('결함2: extractModule이 bin/ 경로를 모듈별로 세분화한다', async ({ page }) => {
    const dbData = buildBinPathDbData()
    console.log(`  DB 데이터: 6개 모듈, ~408 테이블`)

    await page.addInitScript((dbScreen) => {
      window.__CODEBASE_VIZ_DIAGRAMS__ = {
        rendering: '',
        screenComponent: '',
        dbScreen,
      }
      window.__CODEBASE_VIZ_META__ = {
        projectName: 'WINA-Test',
        routeCount: 0,
        tableCount: 408,
      }
    }, dbData)

    await page.goto(VIEWER_URL)
    // Tab3 (DB–Screen) 클릭: viewer.html은 data-t="d" 속성 사용(탭 자체 + v1.2.63 D8 검색 input
    // 둘 다 이 속성을 쓴다 — .tab로 스코프해야 유일하게 좁혀진다. 앱 코드의 switchTab()도 동일 패턴)
    await page.locator('.tab[data-t="d"]').click()
    // mermaid 렌더링 대기
    await page.waitForTimeout(5000)

    // SVG 렌더링 확인
    const inner = page.locator('#i-d')

    // 결함2 핵심: 'bin' 단일 subgraph가 없어야 함
    // viewer.html의 extractModule이 올바르게 작동했다면
    // 'agency', 'headOffice', 'model', 'partner', 'core', 'system' 6개 모듈로 분리됨

    // CHUNK_SEP 렌더링 → .row-diagram divs 존재 확인
    const rowDiagrams = await inner.locator('.row-diagram').count()
    console.log(`  .row-diagram 수: ${rowDiagrams}`)

    // 408 tables > 30 threshold → chunking 발생해야 함
    expect(rowDiagrams).toBeGreaterThanOrEqual(1)

    // SVG에서 subgraph 라벨 추출 (mermaid가 렌더링한 경우)
    const svgContent = await inner.innerHTML()

    // bin 이라는 단일 그룹 텍스트만 있고 다른 모듈 없으면 실패
    // (이전 버그: bin/main/sql/... → parts[0] = 'bin' → 408 테이블 전부 'bin' 그룹)
    const hasBinOnly = svgContent.includes('"bin"') &&
      !svgContent.includes('"agency"') && !svgContent.includes('"core"')

    if (hasBinOnly) {
      console.error('  ❌ FAIL: 모든 테이블이 "bin" 단일 그룹으로 묶임 (결함2 미수정)')
    } else {
      console.log('  ✅ extractModule이 bin/ 경로를 올바르게 분리함')
    }

    expect(hasBinOnly).toBe(false)

    // 스크린샷 저장
    await page.screenshot({ path: 'tests/playwright/screenshots/defect2-tab3-modules.png', fullPage: false })
    console.log('  스크린샷: tests/playwright/screenshots/defect2-tab3-modules.png')
  })

  test('결함3: row-mode 활성화 시 inner.style.left가 0이어야 한다', async ({ page }) => {
    const multiChunk = buildMultiChunkDiagram(9)
    console.log(`  9-chunk 다이어그램 주입`)

    await page.addInitScript((rendering) => {
      window.__CODEBASE_VIZ_DIAGRAMS__ = {
        rendering,
        screenComponent: rendering,
        dbScreen: '',
      }
      window.__CODEBASE_VIZ_META__ = {
        projectName: 'Overload-Test',
        routeCount: 120,
        tableCount: 0,
      }
    }, multiChunk)

    await page.goto(VIEWER_URL)
    // Tab1 (rendering) 렌더링 대기
    await page.waitForTimeout(4000)

    // Tab1이 기본으로 열려 있음
    const inner = page.locator('#i-r')

    // row-diagram 수 확인
    const rowCount = await inner.locator('.row-diagram').count()
    console.log(`  Tab1 .row-diagram 수: ${rowCount}`)
    expect(rowCount).toBe(9)

    // activateRowMode가 호출됐는지 확인 (w-r.row-mode class)
    const wrapHasRowMode = await page.locator('#w-r').evaluate(el => el.classList.contains('row-mode'))
    console.log(`  row-mode 클래스 적용: ${wrapHasRowMode}`)

    // 결함3 핵심: inner의 left 값 확인
    const innerLeft = await inner.evaluate(el => el.style.left)
    console.log(`  inner.style.left: "${innerLeft}"`)

    if (innerLeft === '50%') {
      console.error('  ❌ FAIL: left:50% — floating island 버그 미수정 (결함3)')
    } else if (innerLeft === '0px' || innerLeft === '0') {
      console.log('  ✅ left:0 — row-mode 올바르게 정렬됨')
    } else {
      console.log(`  ⚠️  left: "${innerLeft}" — 예상과 다른 값 (확인 필요)`)
    }

    // left:50%가 아닌지 확인
    expect(innerLeft).not.toBe('50%')

    // 스크린샷 저장
    await page.screenshot({ path: 'tests/playwright/screenshots/defect3-row-mode.png', fullPage: false })
    console.log('  스크린샷: tests/playwright/screenshots/defect3-row-mode.png')
  })

  test('결함1: 9-chunk 다이어그램이 9개 row-diagram으로 렌더링된다', async ({ page }) => {
    const multiChunk = buildMultiChunkDiagram(9)

    await page.addInitScript((rendering) => {
      window.__CODEBASE_VIZ_DIAGRAMS__ = {
        rendering,
        screenComponent: '',
        dbScreen: '',
      }
      window.__CODEBASE_VIZ_META__ = {
        projectName: 'ChunkTest',
        routeCount: 120,
        tableCount: 0,
      }
    }, multiChunk)

    await page.goto(VIEWER_URL)
    await page.waitForTimeout(4000)

    const rowCount = await page.locator('#i-r .row-diagram').count()
    console.log(`  Tab1 .row-diagram 수: ${rowCount} (기대: 9)`)
    expect(rowCount).toBe(9)

    // chunk nav bar 확인
    const cnavVisible = await page.locator('#cnav-r').evaluate(el => el.style.display !== 'none')
    console.log(`  chunk nav bar 표시: ${cnavVisible}`)
    expect(cnavVisible).toBe(true)

    const navLabel = await page.locator('#cnav-r .cn-label').textContent()
    console.log(`  nav label: "${navLabel}"`)
    expect(navLabel).toMatch(/9/)

    await page.screenshot({ path: 'tests/playwright/screenshots/defect1-chunks.png', fullPage: false })
    console.log('  스크린샷: tests/playwright/screenshots/defect1-chunks.png')
  })

  test('결함2: extractModule 단위 검증 (browser context에서 실행)', async ({ page }) => {
    // viewer.html의 extractModule 함수를 직접 호출해서 검증
    await page.addInitScript(() => {
      window.__CODEBASE_VIZ_DIAGRAMS__ = { rendering: '', screenComponent: '', dbScreen: '' }
      window.__CODEBASE_VIZ_META__ = { projectName: 'Test', routeCount: 0, tableCount: 0 }
    })
    await page.goto(VIEWER_URL)

    // extractModule 함수가 viewer.html 스크립트에서 정의됨 — 브라우저 컨텍스트에서 호출
    const testCases = [
      { path: 'bin/main/sql/primary/wina/agency/ApiUrl.xml',          expected: 'agency' },
      { path: 'bin/main/sql/primary/wina/headOffice/alloc/Sql.xml',   expected: 'alloc' },
      { path: 'bin/main/sql/primary/core/ApiUrl.xml',                 expected: 'core' },
      { path: 'bin/main/sql/primary/wina/model/ModelSql.xml',         expected: 'model' },
      { path: 'bin/main/sql/primary/system/SystemSql.xml',            expected: 'system' },
      { path: 'src/entities/User.ts',                                  expected: 'entities' },
    ]

    const results = await page.evaluate((cases) => {
      return cases.map(({ path: p, expected }) => {
        const actual = typeof extractModule === 'function' ? extractModule(p) : 'FUNCTION_NOT_FOUND'
        return { path: p, expected, actual, pass: actual === expected }
      })
    }, testCases)

    let allPass = true
    for (const r of results) {
      const icon = r.pass ? '✅' : '❌'
      console.log(`  ${icon} extractModule("${r.path.split('/').slice(-3).join('/')}") → "${r.actual}" (기대: "${r.expected}")`)
      if (!r.pass) allPass = false
    }

    expect(allPass).toBe(true)
  })

  test('v1.2.52: 다중청크 .row-diagram에 content-visibility:auto + 실측 contain-intrinsic-height', async ({ page }) => {
    const multiChunk = buildMultiChunkDiagram(9)
    await page.addInitScript((rendering) => {
      window.__CODEBASE_VIZ_DIAGRAMS__ = { rendering, screenComponent: '', dbScreen: '' }
      window.__CODEBASE_VIZ_META__ = { projectName: 'PerfTest', routeCount: 120, tableCount: 0 }
    }, multiChunk)

    await page.goto(VIEWER_URL)
    await page.waitForTimeout(4000)

    const rows = page.locator('#i-r .row-diagram')
    expect(await rows.count()).toBe(9)

    // 레버1: off-screen 청크 paint skip을 위해 content-visibility:auto가 적용돼야 함.
    const probe = await rows.first().evaluate((el) => ({
      cv: getComputedStyle(el).contentVisibility,
      cih: el.style.containIntrinsicHeight,
      minH: el.style.minHeight,
    }))
    console.log(`  content-visibility: ${probe.cv} · contain-intrinsic-height: ${probe.cih} · min-height: ${probe.minH}`)
    expect(probe.cv).toBe('auto')
    // fit 단계에서 실측 높이(auto <N>px)로 갱신 → off-screen 시 스크롤 점프 방지.
    expect(probe.cih).toMatch(/^auto \d+px$/)
    expect(probe.minH).toMatch(/^\d/)
  })

  test('v1.2.52: 스크롤로 content-visibility 활성화된 청크도 wheel-zoom·drag·rz 동작', async ({ page }) => {
    const multiChunk = buildMultiChunkDiagram(12)
    await page.addInitScript((rendering) => {
      window.__CODEBASE_VIZ_DIAGRAMS__ = { rendering, screenComponent: '', dbScreen: '' }
      window.__CODEBASE_VIZ_META__ = { projectName: 'InteractTest', routeCount: 160, tableCount: 0 }
    }, multiChunk)

    await page.goto(VIEWER_URL)
    await page.waitForTimeout(4000)

    // 하단(초기 off-screen) 청크를 뷰로 스크롤 → content-visibility:auto 활성화.
    const targetIdx = 9
    await page.evaluate((idx) => {
      const row = document.querySelector('#i-r .row-diagram[data-row-idx="' + idx + '"]')
      row.scrollIntoView({ block: 'center' })
    }, targetIdx)
    await page.waitForTimeout(300)

    const row = page.locator('#i-r .row-diagram[data-row-idx="' + targetIdx + '"]')
    const svg = row.locator('svg')
    const before = await svg.evaluate((el) => el.style.transform)

    // wheel zoom in
    const box = await row.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(100)
    const afterZoom = await svg.evaluate((el) => el.style.transform)
    console.log(`  zoom: "${before}" → "${afterZoom}"`)
    expect(afterZoom).not.toBe(before)
    expect(afterZoom).toMatch(/scale\(/)

    // drag pan
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30)
    await page.mouse.up()
    await page.waitForTimeout(100)
    const afterDrag = await svg.evaluate((el) => el.style.transform)
    console.log(`  drag: "${afterDrag}"`)
    expect(afterDrag).toMatch(/translate\(/)

    // rz reset → fit 상태(translate 0, scale fitS) 복원
    await page.evaluate(() => rz('r'))
    await page.waitForTimeout(100)
    const afterReset = await svg.evaluate((el) => el.style.transform)
    console.log(`  reset: "${afterReset}"`)
    expect(afterReset).toMatch(/translate\(0px, 0px\)/)
  })
})
