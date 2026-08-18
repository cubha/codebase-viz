/**
 * v1.2.62 — T1 딥링크를 **실제 빌더 산출물**로 태우는 E2E.
 *
 * 왜 별도 스펙인가: 기존 node-click-deeplink/node-id-extraction 스펙은 손으로 쓴
 * `graph TD\n <sid>["..."]` 하니스만 검증했다. 실제 buildDiagrams가 emit하는 Tab1 합성 id(`T1_*`)와
 * Tab2 접두사 id(`leaf_`/`file_`)는 한 번도 통과하지 않았고, 그 결과 "전 노드 클릭 무반응"이
 * 전 스펙 GREEN 상태로 배포됐다(사용자 보고). 여기서는 IR 그래프 → buildDiagrams → viewer 렌더 →
 * 클릭까지 실제 경로 그대로 검증한다.
 *
 * Usage: npx playwright test tests/playwright/node-deeplink-real-output.spec.mjs
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import { buildDiagrams } from '../../packages/renderer/dist/index.js'
import { createIRGraph, createRouteNode, createComponentNode, createEdge, makeNodeId, makeEdgeId } from '../../packages/types/dist/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIEWER_PATH = path.resolve(__dirname, '../../packages/extension/media/viewer.html')
const MERMAID_LOCAL = path.resolve(__dirname, '../../packages/extension/media/mermaid.min.js')

const PROV = { file: '', line: 7, adapter: 'nextjs', analyzerVersion: 'test' }

function route(urlPath, filePath) {
  return createRouteNode({
    id: makeNodeId('route', filePath, 'page'),
    path: urlPath,
    filePath,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    provenance: { ...PROV, file: filePath },
    confidence: 'verified',
  })
}

function component(name, filePath) {
  return createComponentNode({
    id: makeNodeId('component', filePath, name),
    name,
    filePath,
    runtime: 'server',
    provenance: { ...PROV, file: filePath },
    confidence: 'verified',
  })
}

function realDiagrams() {
  const routes = [
    route('/', 'app/page.tsx'),
    route('/blog', 'app/blog/page.tsx'),
    route('/blog/archive', 'app/blog/archive/page.tsx'),
    route('/admin/users', 'app/admin/users/page.tsx'),
    route('/admin/settings', 'app/admin/settings/page.tsx'),
  ]
  const header = component('Header', 'components/Header.tsx')
  const edges = [
    createEdge({
      id: makeEdgeId('renders', routes[0].id, header.id),
      from: routes[0].id,
      to: header.id,
      kind: 'renders',
      provenance: PROV,
      confidence: 'verified',
    }),
  ]
  // metadata.framework를 채워야 Tab2가 파일트리 모드로 들어가 `leaf_`/`file_` 접두사 id를 emit한다
  // — v1.2.61에서 nodeMap이 통째로 놓쳤던 바로 그 경로다.
  const graph = createIRGraph({
    analyzerVersion: 'test',
    repoRoot: '/repo',
    nodes: [...routes, header],
    edges,
    metadata: { framework: 'nextjs-app-router' },
  })
  return buildDiagrams(graph)
}

// react-router: 라우트 5개가 전부 router 파일의 map 호출 한 줄(:15)에서 선언되고, 각자
// renders로 자기 페이지 컴포넌트에 연결된 형태 — 사용자 실사례의 최소 재현.
function rrMapDiagrams() {
  const RR = { file: 'src/router.tsx', line: 15, adapter: 'react-router@0.1', analyzerVersion: 'test' }
  const names = ['Home', 'Code', 'Message', 'Profile', 'Settings']
  const nodes = []
  const edges = []
  for (const n of names) {
    const urlPath = '/' + n.toLowerCase()
    const r = createRouteNode({
      id: makeNodeId('route', 'src/router.tsx', urlPath),
      path: urlPath,
      filePath: 'src/router.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'CSR',
      provenance: { ...RR },
      confidence: 'verified',
    })
    const c = component(n, `src/pages/${n}.tsx`)
    nodes.push(r, c)
    edges.push(createEdge({
      id: makeEdgeId('renders', r.id, c.id),
      from: r.id, to: c.id, kind: 'renders',
      provenance: { ...RR }, confidence: 'verified',
    }))
  }
  const graph = createIRGraph({
    analyzerVersion: 'test',
    repoRoot: '/repo',
    nodes,
    edges,
    metadata: { framework: 'react-router' },
  })
  return buildDiagrams(graph)
}

function buildHarness() {
  const template = fs.readFileSync(VIEWER_PATH, 'utf8')
  const withLocalMermaid = template.replace(
    '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>',
    `<script src="file://${MERMAID_LOCAL}"></script>`,
  )
  const tmpPath = path.join(os.tmpdir(), `cv-real-deeplink-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  fs.writeFileSync(tmpPath, withLocalMermaid, 'utf8')
  return 'file://' + tmpPath
}

async function load(page, diagrams) {
  const url = buildHarness()
  await page.addInitScript(d => {
    window.__posted = []
    window.acquireVsCodeApi = () => ({ postMessage: msg => window.__posted.push(msg) })
    window.__CODEBASE_VIZ_DIAGRAMS__ = d
    window.__CODEBASE_VIZ_META__ = { projectName: 'RealOutput', routeCount: 5, tableCount: 0 }
  }, diagrams)
  await page.goto(url)
  await page.waitForSelector('#i-r svg', { timeout: 15000 })
  await page.waitForTimeout(400)
}

test.describe('v1.2.62 — 실제 buildDiagrams 산출물 딥링크', () => {
  test('Tab1(기본 탭)의 폴더 박스를 클릭하면 대표 라우트로 openNode가 발사된다', async ({ page }) => {
    const diagrams = realDiagrams()
    await load(page, diagrams)

    // nodeMap에 실린 id를 가진 .node를 찾아 클릭한다(합성 T1_* 포함).
    const clickable = await page.evaluate(() => {
      const re = /-flowchart-(.+)-\d+$/
      return [...document.querySelectorAll('#i-r svg .node')]
        .map(el => ({ domId: el.id, sid: (re.exec(el.id) || [])[1] }))
        .filter(x => x.sid && window.__CODEBASE_VIZ_DIAGRAMS__.nodeMap[x.sid])
    })
    expect(clickable.length, 'Tab1에 클릭 가능한 노드가 하나도 없다 — v1.2.61 결함 재발').toBeGreaterThan(0)
    expect(clickable.some(c => c.sid.startsWith('T1_')), 'Tab1 폴더 박스가 매핑되지 않았다').toBe(true)

    await page.locator(`#i-r svg [id="${clickable[0].domId}"]`).click()
    const posted = await page.evaluate(() => window.__posted)
    expect(posted).toEqual([{ type: 'openNode', id: clickable[0].sid }])

    // 발사된 id는 실제 소스 파일·라인으로 해석 가능해야 한다.
    const entry = diagrams.nodeMap[posted[0].id]
    expect(entry.f).toMatch(/\.tsx$/)
    expect(entry.l).toBeGreaterThan(0)
  })

  test('Tab2의 접두사 노드(leaf_/file_)도 전부 nodeMap으로 해석돼 클릭이 발사된다', async ({ page }) => {
    const diagrams = realDiagrams()
    await load(page, diagrams)
    await page.click('.tab[data-t="s"]')
    await page.waitForSelector('#i-s svg', { timeout: 15000 })
    await page.waitForTimeout(400)

    const stats = await page.evaluate(() => {
      const re = /-flowchart-(.+)-\d+$/
      const nodes = [...document.querySelectorAll('#i-s svg .node')]
        .map(el => ({ domId: el.id, sid: (re.exec(el.id) || [])[1] }))
        .filter(x => x.sid)
      const nm = window.__CODEBASE_VIZ_DIAGRAMS__.nodeMap
      return {
        total: nodes.length,
        prefixed: nodes.filter(n => /^(leaf_|file_|pageleaf_)/.test(n.sid)),
        unmapped: nodes.filter(n => !nm[n.sid]).map(n => n.sid),
      }
    })
    expect(stats.total).toBeGreaterThan(0)
    expect(stats.prefixed.length, '접두사 노드가 없어 회귀를 못 잡는 케이스').toBeGreaterThan(0)
    expect(stats.unmapped, 'nodeMap에서 탈락한 Tab2 노드').toEqual([])

    await page.locator(`#i-s svg [id="${stats.prefixed[0].domId}"]`).click()
    const posted = await page.evaluate(() => window.__posted)
    expect(posted).toEqual([{ type: 'openNode', id: stats.prefixed[0].sid }])
  })

  // react-router `routes.map(...)` — 사용자 보고 케이스. 라우트 선언이 전부 router 파일의 map 호출
  // 한 줄에 몰려 있어, 딥링크가 페이지가 아니라 map 지점으로 점프하던 결함의 E2E 가드.
  test('RR map 라우트 박스를 클릭하면 router의 map 지점이 아니라 페이지 파일로 해석된다', async ({ page }) => {
    const diagrams = rrMapDiagrams()
    await load(page, diagrams)

    const clickable = await page.evaluate(() => {
      const re = /-flowchart-(.+)-\d+$/
      return [...document.querySelectorAll('#i-r svg .node')]
        .map(el => ({ domId: el.id, sid: (re.exec(el.id) || [])[1] }))
        .filter(x => x.sid && window.__CODEBASE_VIZ_DIAGRAMS__.nodeMap[x.sid])
    })
    expect(clickable.length, 'RR Tab1에 클릭 가능한 노드가 없다').toBeGreaterThan(0)

    await page.locator(`#i-r svg [id="${clickable[0].domId}"]`).click()
    const posted = await page.evaluate(() => window.__posted)
    const entry = diagrams.nodeMap[posted[0].id]
    // 점프 좌표는 페이지 파일 — router 파일(선언이 몰려 있는 곳)이면 결함 재발.
    expect(entry.f).toMatch(/^src\/pages\//)
    expect(entry.f).not.toBe('src/router.tsx')
  })

  test('실제 산출물에도 nodeMap 마커가 남지 않는다', async () => {
    const d = realDiagrams()
    expect(d.rendering + d.screenComponent + d.dbScreen).not.toContain('%% nodemap:')
  })
})
