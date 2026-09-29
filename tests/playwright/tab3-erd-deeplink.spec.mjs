/**
 * v1.2.68 — Tab3(DB–Screen) erd 모드 딥링크 E2E (실제 buildDiagrams 산출물).
 *
 * 왜 필요한가: erd 모드 화면은 viewer의 buildSingleDbGraph가 테이블명을 노드 id로 쓰는 flowchart를
 * 재생성한다. 그 선언 id는 IR sid보다 짧아 nodeMap의 suffix 역해석으로는 도달할 수 없었고, 주석은
 * "erDiagram이라 .node가 없다"고 잘못 단정해 Tab3 hover·클릭이 도입 이래 한 번도 동작하지 않았다.
 * renderer가 선언 id마다 nodemap 마커를 싣는 경로를 IR → buildDiagrams → viewer 렌더 → hover/클릭으로 검증한다.
 *
 * Usage: npx playwright test tests/playwright/tab3-erd-deeplink.spec.mjs
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import { buildDiagrams } from '../../packages/renderer/dist/index.js'
import {
  createIRGraph, createRouteNode, createComponentNode, createTableNode, createEdge, makeNodeId, makeEdgeId,
} from '../../packages/types/dist/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIEWER_PATH = path.resolve(__dirname, '../../packages/extension/media/viewer.html')
const MERMAID_LOCAL = path.resolve(__dirname, '../../packages/extension/media/mermaid.min.js')
const NODE_RE = /-flowchart-(.+)-\d+$/

function table(name, file, line) {
  return createTableNode({
    id: makeNodeId('table', file, name),
    name,
    columns: [{ name: 'id', type: 'uuid', nullable: false, isPrimaryKey: true }],
    provenance: { file, line, adapter: 'supabase-parser@0.1', analyzerVersion: 'test' },
    confidence: 'verified',
  })
}

function feDiagrams(tableCount = 2) {
  const tables = [table('users', 'supabase/migrations/001_init.sql', 12)]
  // viewer는 파일 경로의 모듈별로 그룹을 묶고 그룹 단위로만 행을 나눈다 — 모듈을 3개로 분산시켜야
  // 30개 초과 시 실제로 row 청킹이 일어난다.
  for (let i = 1; i < tableCount; i++) tables.push(table(`tbl_${i}`, `src/mod${i % 3}/t${i}.sql`, 3))
  const page = createRouteNode({
    id: makeNodeId('route', 'app/admin/users/page.tsx', 'page'),
    path: '/admin/users',
    filePath: 'app/admin/users/page.tsx',
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    provenance: { file: 'app/admin/users/page.tsx', line: 4, adapter: 'nextjs', analyzerVersion: 'test' },
    confidence: 'verified',
  })
  const q = createEdge({
    id: makeEdgeId('queries', page.id, tables[0].id),
    from: page.id, to: tables[0].id, kind: 'queries',
    provenance: { file: 'app/admin/users/page.tsx', line: 9, adapter: 'nextjs', analyzerVersion: 'test' },
    confidence: 'verified',
  })
  return buildDiagrams(createIRGraph({
    analyzerVersion: 'test', repoRoot: '/repo', nodes: [page, ...tables], edges: [q],
    metadata: { framework: 'nextjs-app-router', hasSupabase: true, hasPrisma: false, hasDexie: false, hasFirebase: false },
  }))
}

// viewer의 parseDbData는 `string name`뿐인 프록시를 테이블에서 빼고 queries 엣지가 있는 소스만
// Pages/Actions로 그린다 — queries 없는 Repository 박스는 CLI erDiagram에만 있고 viewer 화면엔 없다.
function beDiagrams() {
  const t = table('tb_member', 'src/main/resources/db/V1__init.sql', 20)
  const repo = createComponentNode({
    id: makeNodeId('component', 'src/main/java/app/MemberRepository.java', 'MemberRepository'),
    name: 'MemberRepository',
    filePath: 'src/main/java/app/MemberRepository.java',
    runtime: 'server',
    provenance: { file: 'src/main/java/app/MemberRepository.java', line: 7, adapter: 'springboot', analyzerVersion: 'test' },
    confidence: 'verified',
  })
  const q = createEdge({
    id: makeEdgeId('queries', repo.id, t.id),
    from: repo.id, to: t.id, kind: 'queries',
    provenance: { file: 'src/main/java/app/MemberRepository.java', line: 12, adapter: 'springboot', analyzerVersion: 'test' },
    confidence: 'verified',
  })
  return buildDiagrams(createIRGraph({
    analyzerVersion: 'test', repoRoot: '/repo', nodes: [repo, t], edges: [q],
    metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
  }))
}

function buildHarness() {
  const template = fs.readFileSync(VIEWER_PATH, 'utf8')
  const withLocalMermaid = template.replace(
    '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>',
    `<script src="file://${MERMAID_LOCAL}"></script>`,
  )
  const tmpPath = path.join(os.tmpdir(), `cv-tab3-deeplink-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  fs.writeFileSync(tmpPath, withLocalMermaid, 'utf8')
  return 'file://' + tmpPath
}

async function openTab3(page, diagrams) {
  await page.addInitScript(d => {
    window.__posted = []
    window.acquireVsCodeApi = () => ({ postMessage: msg => window.__posted.push(msg) })
    window.__CODEBASE_VIZ_DIAGRAMS__ = d
    window.__CODEBASE_VIZ_META__ = { projectName: 'Tab3', routeCount: 1, tableCount: 1 }
  }, diagrams)
  await page.goto(buildHarness())
  await page.waitForSelector('#i-r svg', { timeout: 15000 })
  await page.click('.tab[data-t="d"]')
  await page.waitForSelector('#i-d svg .node', { timeout: 15000 })
  await page.waitForTimeout(400)
}

async function tab3Nodes(page) {
  return page.evaluate(re => {
    const rx = new RegExp(re)
    const nm = window.__CODEBASE_VIZ_DIAGRAMS__.nodeMap || {}
    return [...document.querySelectorAll('#i-d svg .node')]
      .map(el => ({ domId: el.id, sid: (rx.exec(el.id) || [])[1] }))
      .filter(x => x.sid)
      .map(x => ({ ...x, mapped: !!nm[x.sid] }))
  }, NODE_RE.source)
}

test.describe('v1.2.68 — Tab3 erd 모드 딥링크', () => {
  test('테이블·쿼리 소스 박스가 전부 nodeMap으로 해석되고 클릭하면 openNode가 발사된다', async ({ page }) => {
    const diagrams = feDiagrams()
    expect(diagrams.tab3Kind).toBe('erd')
    await openTab3(page, diagrams)

    const nodes = await tab3Nodes(page)
    expect(nodes.map(n => n.sid)).toEqual(expect.arrayContaining(['users', 'admin_users']))
    expect(nodes.filter(n => !n.mapped).map(n => n.sid), 'nodeMap에서 탈락한 Tab3 노드').toEqual([])

    const users = nodes.find(n => n.sid === 'users')
    await page.locator(`#i-d svg [id="${users.domId}"]`).click()
    const src = nodes.find(n => n.sid === 'admin_users')
    await page.locator(`#i-d svg [id="${src.domId}"]`).click()
    expect(await page.evaluate(() => window.__posted)).toEqual([
      { type: 'openNode', id: 'users' },
      { type: 'openNode', id: 'admin_users' },
    ])
    expect(diagrams.nodeMap.users).toMatchObject({ f: 'supabase/migrations/001_init.sql', l: 12 })
    expect(diagrams.nodeMap.admin_users.f).toBe('app/admin/users/page.tsx')
  })

  test('테이블 hover 시 선언 파일·라인 툴팁이 뜬다', async ({ page }) => {
    await openTab3(page, feDiagrams())
    const users = (await tab3Nodes(page)).find(n => n.sid === 'users')
    await page.locator(`#i-d svg [id="${users.domId}"]`).hover()
    const tooltip = page.locator('#node-tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('supabase/migrations/001_init.sql:12')
  })

  test('BE: Repository 쿼리 소스 박스도 클릭된다', async ({ page }) => {
    await openTab3(page, beDiagrams())
    const nodes = await tab3Nodes(page)
    expect(nodes.filter(n => !n.mapped).map(n => n.sid)).toEqual([])
    const repo = nodes.find(n => n.sid === 'MemberRepository')
    expect(repo, 'Repository 박스가 렌더되지 않았다').toBeDefined()
    await page.locator(`#i-d svg [id="${repo.domId}"]`).click()
    expect(await page.evaluate(() => window.__posted)).toEqual([{ type: 'openNode', id: 'MemberRepository' }])
  })

  test('viewer가 테이블 30개 초과로 row 청킹해도 모든 테이블 노드가 해석된다', async ({ page }) => {
    await openTab3(page, feDiagrams(45))
    await page.waitForFunction(() => document.querySelectorAll('#i-d svg').length > 1, null, { timeout: 15000 })
    const nodes = await tab3Nodes(page)
    const tables = nodes.filter(n => n.sid === 'users' || n.sid.startsWith('tbl_'))
    expect(tables.length).toBe(45)
    expect(nodes.filter(n => !n.mapped).map(n => n.sid)).toEqual([])
  })
})
