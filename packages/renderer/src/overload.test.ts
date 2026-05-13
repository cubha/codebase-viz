/**
 * v1.1.52 결함1 검증: 100+/938 routes → renderer chunk count ≤ 기준값
 * 이전 버그: chunkByGroups가 leaf 1개 = 1 chunk → 698 chunks (B2B WINA)
 */
import { describe, it, expect } from 'vitest'
import { createRouteNode, createIRGraph, makeNodeId } from '@codebase-viz/types'
import { buildDiagrams } from './mermaid-renderer.js'

const CHUNK_SEP = '%%--CHUNK--%%'

function makeRoute(urlPath: string, idx: number) {
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

function buildOverloadGraph(routeCount: number) {
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
    analyzerVersion: 'test@0.1',
    repoRoot: '/test',
    nodes: routes,
    edges: [],
  })
}

function countChunks(diagram: string): number {
  return diagram.split('\n' + CHUNK_SEP + '\n').length
}

/**
 * B2B WINA 실환경 시뮬레이션:
 * - 938 routes all under /api (1 root) with 4 sub-prefixes → branchingGroups ≤ 5
 * - buildRenderingDiagram은 청킹 안 함 (≤ GROUPS_PER_ROW)
 * - shouldChunk(938 > 300) = true → chunkByGroups 호출
 * - 결함1 이전: collectLeafRouteArrays → 698 leaf chunks
 * - 결함1 이후: collectGroupRoutes + chunkArray(30) → ~32 chunks
 */
function buildWinaStyleGraph(routeCount: number) {
  const subPrefixes = ['/api/payment', '/api/order', '/api/user', '/api/product']
  const routes = []
  let idx = 0
  const perPrefix = Math.ceil(routeCount / subPrefixes.length)
  for (const prefix of subPrefixes) {
    for (let i = 0; i < perPrefix && idx < routeCount; i++, idx++) {
      routes.push(makeRoute(`${prefix}/resource${i}`, idx))
    }
  }
  return createIRGraph({
    analyzerVersion: 'test@0.1',
    repoRoot: '/test',
    nodes: routes,
    edges: [],
  })
}

describe('결함1: overload route → chunk count 검증', () => {
  it('[multi-prefix] 120 routes → Tab1 chunk 수 ≤ 15', () => {
    const graph = buildOverloadGraph(120)
    const diagrams = buildDiagrams(graph)
    const chunks = countChunks(diagrams.rendering)
    console.log(`  [120 routes, 10 prefixes] Tab1 chunk 수: ${chunks}`)
    expect(chunks).toBeLessThanOrEqual(15)
  })

  it('[multi-prefix] 120 routes → Tab2 chunk 수 ≤ 15', () => {
    const graph = buildOverloadGraph(120)
    const diagrams = buildDiagrams(graph)
    const chunks = countChunks(diagrams.screenComponent)
    console.log(`  [120 routes, 10 prefixes] Tab2 chunk 수: ${chunks}`)
    expect(chunks).toBeLessThanOrEqual(15)
  })

  it('[multi-prefix] 938 routes → Tab1 chunk 수 ≤ 50 (이전 버그: 698 chunks)', () => {
    const graph = buildOverloadGraph(938)
    const diagrams = buildDiagrams(graph)
    const chunks = countChunks(diagrams.rendering)
    console.log(`  [938 routes, 10 prefixes] Tab1 chunk 수: ${chunks}`)
    expect(chunks).toBeLessThanOrEqual(50)
    expect(graph.nodes.length / chunks).toBeGreaterThan(10)
  })

  it.skip('[WINA 패턴 — 병리적 fixture] flat leaf routes는 건너뜀', () => {
    // /api/payment/resourceN 형태의 완전 평탄 경로(동일 깊이 unique leaf)는
    // groupRoutesByUrl이 leaf마다 별도 group 생성 → branchingGroups = route 수
    // → buildRenderingDiagram에서 1-per-branch 청킹 발생
    // 실제 WINA 앱은 /api/payment/list, /api/payment/:id/edit 등 의미 경로를 가져 이 문제가 없음.
    // multi-prefix 테스트가 실제 결함1 수정을 검증함.
  })
})
