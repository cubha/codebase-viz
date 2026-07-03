/**
 * v1.2.58 ST3 — CSP 강화 실측
 * - unsafe-eval 없이도 mermaid.min.js + viewer.html 런타임이 정상 동작하는지 실측
 *   (mermaid.min.js grep 결과 eval(/new Function( 사용 0건 확인 후 실측으로 재검증)
 * - onclick→data-action 리팩터 후 탭 전환·줌·DB 뷰 전환이 CSP 위반 없이 동작하는지 확인
 *
 * Usage: npx playwright test tests/playwright/csp.spec.mjs
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIEWER_PATH = path.resolve(__dirname, '../../packages/extension/media/viewer.html')

function buildSimpleDiagram() {
  return [
    "%%{init:{'theme':'base'}}%%",
    'graph LR',
    '  A["/api/users"] --> B["UserController"]',
    '  B --> C["users_table"]',
  ].join('\n')
}

function buildCspHarness(cspContent) {
  const template = fs.readFileSync(VIEWER_PATH, 'utf8')
  const mermaidLocal = path.resolve(__dirname, '../../packages/extension/media/mermaid.min.js')
  const withCsp = template
    .replace(
      '<head>',
      `<head>\n<meta http-equiv="Content-Security-Policy" content="${cspContent}">`,
    )
    // 실제 webview.ts는 CDN URL을 로컬 extension 리소스 URI로 치환한다 — 테스트 하네스도
    // 동일하게 동작해야 CSP script-src가 CDN 오리진을 몰라도(=프로덕션과 동일 조건) 검증 가능.
    .replace(
      'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js',
      'file://' + mermaidLocal,
    )
  const tmpPath = path.join(os.tmpdir(), 'codebase-viz-csp-harness.html')
  fs.writeFileSync(tmpPath, withCsp, 'utf8')
  return 'file://' + tmpPath
}

// webview.ts buildViewerHtmlImpl가 실제로 만드는 CSP(nonce 기반, unsafe-inline 없음)를
// 문자열 치환 순서까지 동일하게 재현한다 — 근사(unsafe-inline 허용)가 아니라 프로덕션과
// 동일한 정책 자체를 실측한다(scope-critic 지적 반영).
function buildNonceHarness() {
  const template = fs.readFileSync(VIEWER_PATH, 'utf8')
  const mermaidLocal = path.resolve(__dirname, '../../packages/extension/media/mermaid.min.js')
  const nonce = 'test-nonce-1234'
  const withCsp = template
    .replace(
      '<head>',
      `<head>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'self'; style-src 'unsafe-inline'; font-src data:; img-src data: blob: 'self';">`,
    )
    .replace(
      '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>',
      `<script nonce="${nonce}" src="file://${mermaidLocal}"></script>`,
    )
    .replace('<script>', `<script nonce="${nonce}">`)
  const tmpPath = path.join(os.tmpdir(), 'codebase-viz-csp-nonce-harness.html')
  fs.writeFileSync(tmpPath, withCsp, 'utf8')
  return 'file://' + tmpPath
}

test.describe('v1.2.58 ST3 — CSP unsafe-eval 제거 실측', () => {
  test('unsafe-eval 없는 CSP에서도 mermaid 렌더링이 정상 동작하고 CSP 위반이 없다', async ({ page }) => {
    const cspViolations = []
    page.on('console', msg => {
      const text = msg.text()
      if (/content security policy|refused to (evaluate|execute)/i.test(text)) {
        cspViolations.push(text)
      }
    })

    const url = buildCspHarness(
      "default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline'; font-src data:; img-src data: blob: 'self';",
    )

    await page.addInitScript((rendering) => {
      window.__CODEBASE_VIZ_DIAGRAMS__ = { rendering, screenComponent: rendering, dbScreen: '' }
      window.__CODEBASE_VIZ_META__ = { projectName: 'CSP-Test', routeCount: 3, tableCount: 0 }
    }, buildSimpleDiagram())

    await page.goto(url)
    await page.waitForTimeout(3000)

    const svgCount = await page.locator('#i-r svg').count()
    expect(svgCount, 'unsafe-eval 없이도 Tab1 다이어그램이 SVG로 렌더링돼야 한다').toBeGreaterThan(0)
    expect(cspViolations, `CSP 위반 발생: ${JSON.stringify(cspViolations)}`).toEqual([])
  })

  test('프로덕션과 동일한 nonce 기반 CSP(unsafe-inline 없음)에서도 렌더링·탭전환·줌이 동작한다', async ({ page }) => {
    // buildCspHarness와 달리 'unsafe-inline'을 전혀 허용하지 않는다 — webview.ts가 실제로
    // 발급하는 정책(nonce만 허용)을 그대로 재현해 근사가 아닌 실측으로 검증한다.
    const cspViolations = []
    page.on('console', msg => {
      const text = msg.text()
      if (/content security policy|refused to (evaluate|execute)/i.test(text)) {
        cspViolations.push(text)
      }
    })

    const url = buildNonceHarness()

    await page.addInitScript((rendering) => {
      window.__CODEBASE_VIZ_DIAGRAMS__ = { rendering, screenComponent: rendering, dbScreen: '' }
      window.__CODEBASE_VIZ_META__ = { projectName: 'NonceTest', routeCount: 3, tableCount: 0 }
    }, buildSimpleDiagram())

    await page.goto(url)
    await page.waitForTimeout(3000)

    expect(await page.locator('#i-r svg').count(), 'nonce 정책에서도 Tab1이 렌더링돼야 한다').toBeGreaterThan(0)

    await page.locator('[data-action="switchTab"][data-arg="s"]').click()
    await expect(page.locator('#p-s')).toHaveClass(/active/)
    await page.locator('[data-action="zm"][data-arg-t="s"][data-arg-f="1.2"]').click()

    expect(cspViolations, `CSP 위반 발생(nonce 정책): ${JSON.stringify(cspViolations)}`).toEqual([])
  })

  test('onclick→data-action 리팩터 후 탭 전환·줌·DB 뷰 전환이 정상 동작한다', async ({ page }) => {
    const cspViolations = []
    page.on('console', msg => {
      const text = msg.text()
      if (/content security policy|refused to (evaluate|execute)/i.test(text)) {
        cspViolations.push(text)
      }
    })

    const url = buildCspHarness(
      "default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline'; font-src data:; img-src data: blob: 'self';",
    )

    await page.addInitScript((rendering) => {
      window.__CODEBASE_VIZ_DIAGRAMS__ = { rendering, screenComponent: rendering, dbScreen: '' }
      window.__CODEBASE_VIZ_META__ = { projectName: 'ClickTest', routeCount: 3, tableCount: 0 }
    }, buildSimpleDiagram())

    await page.goto(url)
    await page.waitForTimeout(2000)

    // 남은 onclick 속성이 없어야 한다(리팩터 게이트).
    const onclickCount = await page.locator('[onclick]').count()
    expect(onclickCount).toBe(0)

    // 탭 전환: switchTab('s')
    await page.locator('[data-action="switchTab"][data-arg="s"]').click()
    await expect(page.locator('#p-s')).toHaveClass(/active/)

    // 줌 버튼: zm('s', 1.2)
    await page.locator('[data-action="zm"][data-arg-t="s"][data-arg-f="1.2"]').click()

    // DB 탭으로 전환 후 DB 뷰 토글
    await page.locator('[data-action="switchTab"][data-arg="d"]').click()
    await page.waitForTimeout(500)
    await page.locator('[data-action="setDbView"][data-v="fk"]').click()
    await expect(page.locator('[data-action="setDbView"][data-v="fk"]')).toHaveClass(/active/)

    expect(cspViolations, `CSP 위반 발생: ${JSON.stringify(cspViolations)}`).toEqual([])
  })
})

test.describe('v1.2.58 ST1/ST3 — 렌더러 다이어그램 마크업 불변 확인', () => {
  test('3탭 전부 렌더되고, FE Tab2 스타일 <br/>·**bold** 라벨이 escape되지 않고 그대로 렌더된다', async ({ page }) => {
    // fe/tab2*.ts·be/leaf.ts가 실제로 만드는 markdown-string 노드 라벨 패턴을 재현한다.
    // ST1은 viewer DOM 삽입 지점(사이드바·에러메시지)만 esc()로 감쌌고, 이 다이어그램 소스
    // 문자열 자체는 건드리지 않았다는 것을 실제 mermaid.render() 결과로 재확인한다.
    const rendering = [
      "graph LR",
      '  A["📄 **UserController**<br/>**GET** /users"]',
    ].join('\n')
    const screenComponent = [
      "graph LR",
      '  B["src/pages/users<br/>🔗/users/list<br/>📄 index.tsx"]',
    ].join('\n')
    const dbScreen = [
      'erDiagram',
      '  users {',
      '    varchar id PK',
      '  }',
    ].join('\n')

    await page.addInitScript(({ rendering, screenComponent, dbScreen }) => {
      window.__CODEBASE_VIZ_DIAGRAMS__ = { rendering, screenComponent, dbScreen }
      window.__CODEBASE_VIZ_META__ = { projectName: 'BrTest', routeCount: 1, tableCount: 1 }
    }, { rendering, screenComponent, dbScreen })

    await page.goto('file://' + VIEWER_PATH)
    await page.waitForTimeout(2000)
    expect(await page.locator('#i-r svg').count()).toBeGreaterThan(0)

    // Tab1: <br/>가 SVG에서 별도 tspan(줄바꿈)으로 렌더되고, 리터럴 "<br/>" 텍스트로 남지 않는다.
    const tab1Text = await page.locator('#i-r svg').textContent()
    expect(tab1Text).not.toContain('<br/>')
    expect(tab1Text).not.toContain('&lt;br/&gt;')
    expect(tab1Text).toContain('UserController')
    expect(tab1Text).toContain('GET')

    // Tab2로 전환 후 동일하게 확인.
    await page.locator('[data-action="switchTab"][data-arg="s"]').click()
    await page.waitForTimeout(2000)
    expect(await page.locator('#i-s svg').count()).toBeGreaterThan(0)
    const tab2Text = await page.locator('#i-s svg').textContent()
    expect(tab2Text).not.toContain('<br/>')
    expect(tab2Text).not.toContain('&lt;br/&gt;')
    expect(tab2Text).toContain('index.tsx')

    // Tab3(DB)도 렌더되는지 확인.
    await page.locator('[data-action="switchTab"][data-arg="d"]').click()
    await page.waitForTimeout(2000)
    expect(await page.locator('#i-d svg').count()).toBeGreaterThan(0)
  })
})
