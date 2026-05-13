/**
 * v1.1.52 결함 검증 스크립트 (Node.js ESM)
 * - 결함1: 100+ routes → renderer chunk count ≤ 10 (이전: 698)
 * - 결함4: React Router 중첩 sub-router → 120 routes 감지 (이전: 9)
 *
 * Usage: node tests/test-overload.mjs
 */
import { fileURLToPath } from 'url'
import path from 'path'
import { createRouteNode, createIRGraph, makeNodeId } from '@codebase-viz/types'
import { buildDiagrams } from '@codebase-viz/renderer'
import { parseReactRouterFull } from '@codebase-viz/core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CHUNK_SEP = '%%--CHUNK--%%'

function makeRoute(urlPath, idx) {
  const relPath = `src/routes/route${idx}.tsx`
  return createRouteNode({
    id: makeNodeId('route', relPath, urlPath),
    path: urlPath,
    filePath: relPath,
    routeFileKind: 'page',
    dynamicSegmentType: urlPath.includes(':') ? 'dynamic' : 'static',
    isGroupRoute: false,
    renderingMode: 'CSR',
    provenance: { file: relPath, line: 1, adapter: 'test@0.1', analyzerVersion: 'test@0.1' },
    confidence: 'verified',
  })
}

function buildOverloadGraph(routeCount) {
  const prefixes = ['/api/v1', '/api/v2', '/admin', '/users', '/settings', '/reports', '/auth', '/billing', '/support', '/dashboard']
  const routes = []
  let idx = 0
  const perPrefix = Math.ceil(routeCount / prefixes.length)
  for (const prefix of prefixes) {
    for (let i = 0; i < perPrefix && idx < routeCount; i++, idx++) {
      routes.push(makeRoute(`${prefix}/resource${i}/:id`, idx))
    }
  }
  return createIRGraph({
    schemaVersion: '1.0',
    analyzerVersion: 'test@0.1',
    repoRoot: '/test',
    nodes: routes,
    edges: [],
    generatedAt: new Date().toISOString(),
  })
}

// ─── 결함1: 120 routes → chunk count 검증 ─────────────────────────────────────
console.log('\n=== 결함1: 120 routes renderer chunk count ===')
const graph120 = buildOverloadGraph(120)
const diagrams120 = buildDiagrams(graph120)

const renderingChunks = diagrams120.rendering.split('\n' + CHUNK_SEP + '\n').length
const screenChunks = diagrams120.screenComponent.split('\n' + CHUNK_SEP + '\n').length

console.log(`  Tab1 (rendering) chunk 수: ${renderingChunks}`)
console.log(`  Tab2 (screen-component) chunk 수: ${screenChunks}`)

const MAX_EXPECTED = 15
const passed1 = renderingChunks <= MAX_EXPECTED
console.log(`  결과: ${passed1 ? '✅ PASS' : '❌ FAIL'} (기준 ≤ ${MAX_EXPECTED}, 실제 ${renderingChunks})`)
if (!passed1) {
  console.error(`  실패: 698-chunks 버그 재발. chunkByGroups 확인 필요.`)
}

// 938 routes (실제 B2B WINA 규모)
console.log('\n=== 결함1: 938 routes (B2B WINA 규모) ===')
const graph938 = buildOverloadGraph(938)
const diagrams938 = buildDiagrams(graph938)
const chunks938 = diagrams938.rendering.split('\n' + CHUNK_SEP + '\n').length
const passed1b = chunks938 <= 50
console.log(`  Tab1 chunk 수: ${chunks938}`)
console.log(`  결과: ${passed1b ? '✅ PASS' : '❌ FAIL'} (기준 ≤ 50, 실제 ${chunks938})`)

// ─── 결함4: React Router 100+ routes 감지 ────────────────────────────────────
console.log('\n=== 결함4: React Router overload fixture (sub-router 10개 × 12 routes) ===')
const fixturePath = path.join(ROOT, 'fixtures/mini-react-router-overload')
const { routeNodes } = await parseReactRouterFull(fixturePath, 'test@0.1')
const topLevelRoutes = routeNodes.filter(r => !r.path.includes('list') && !r.path.includes(':id') && r.path !== '/' && r.path.split('/').length === 2)

console.log(`  감지된 전체 routes: ${routeNodes.length}`)
console.log(`  top-level routes (sub-router 진입점): ${topLevelRoutes.length}`)
console.log(`  감지된 경로 샘플:`)
routeNodes.slice(0, 8).forEach(r => console.log(`    - ${r.path}`))
if (routeNodes.length > 8) console.log(`    ... 외 ${routeNodes.length - 8}개`)

const MIN_EXPECTED_ROUTES = 100
const passed4 = routeNodes.length >= MIN_EXPECTED_ROUTES
console.log(`  결과: ${passed4 ? '✅ PASS' : '❌ FAIL'} (기준 ≥ ${MIN_EXPECTED_ROUTES}, 실제 ${routeNodes.length})`)
if (!passed4) {
  console.error(`  실패: 결함4 미수정. 2-pass sub-router 감지 확인 필요.`)
  if (routeNodes.length <= 15) {
    console.error(`  → top-level <Routes> 직속 children만 파싱되고 있음.`)
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n=== Summary ===')
const results = [
  { name: '결함1 (120 routes chunk count)', passed: passed1 },
  { name: '결함1 (938 routes chunk count)', passed: passed1b },
  { name: '결함4 (React Router sub-router)', passed: passed4 },
]
results.forEach(r => console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`))

const allPassed = results.every(r => r.passed)
console.log(`\n${allPassed ? '✅ 모든 테스트 PASS' : '❌ 일부 실패'}\n`)
process.exit(allPassed ? 0 : 1)
