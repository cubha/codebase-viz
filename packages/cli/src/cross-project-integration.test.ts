import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFeCallsFromText, matchFeCallsToBeRoutes, remapCrossEdgeFromIds, createDefaultRegistry } from '@codebase-viz/core'
import { buildCombinedDiagram } from '@codebase-viz/renderer'
import { createIRGraph, createComponentNode, createRouteNode, createEdge, makeNodeId, makeEdgeId, EMPTY_ADAPTER_RESULT, type IRGraph } from '@codebase-viz/types'
import { detectStack } from '@codebase-viz/llm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SPRING_FIXTURE = path.resolve(__dirname, '../../../fixtures/mini-spring-app')

const FE_PROV = {
  file: 'components/UserList.tsx',
  line: 1,
  adapter: 'nextjs-app-router@0.1',
  analyzerVersion: 'codebase-viz@0.1.0',
}

function makeMiniFEGraph(): IRGraph {
  const route = createRouteNode({
    id: makeNodeId('route', 'app/page.tsx', 'page'),
    path: '/',
    filePath: 'app/page.tsx',
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    provenance: { ...FE_PROV, file: 'app/page.tsx' },
    confidence: 'verified',
  })
  const comp = createComponentNode({
    id: makeNodeId('component', 'components/UserList.tsx', 'UserList'),
    name: 'UserList',
    filePath: 'components/UserList.tsx',
    runtime: 'client',
    provenance: FE_PROV,
    confidence: 'verified',
  })
  // A2(matched-only 필터)가 'renders' 엣지로 컴포넌트→부모 라우트를 역추적한다. 실제 FE 어댑터는
  // 항상 이 엣지를 emit하므로(예: nextjs/adapter.ts) 누락은 테스트 fixture의 결함이었다.
  const rendersEdge = createEdge({
    id: makeEdgeId('renders', route.id, comp.id),
    from: route.id,
    to: comp.id,
    kind: 'renders',
    provenance: FE_PROV,
    confidence: 'verified',
  })
  return createIRGraph({
    analyzerVersion: 'codebase-viz@0.1.0',
    repoRoot: '/fe/mini-next-app',
    projectName: 'mini-next-app',
    nodes: [route, comp],
    edges: [rendersEdge],
  })
}

describe('Cross-project integration pipeline', () => {
  it('FE fetch → BE 라우트 매칭 → combined diagram 생성', async () => {
    // 1. FE call 추출 (in-memory)
    const feSrc = `
      import axios from 'axios'
      export default function UserList() {
        axios.get('/api/users')
        return <ul/>
      }
    `
    const feCalls = extractFeCallsFromText(feSrc, 'components/UserList.tsx')
    expect(feCalls.length).toBeGreaterThan(0)
    expect(feCalls[0]?.url).toBe('/api/users')

    // 2. BE 라우트 파싱 (mini-spring-app 실제 fixture)
    const stack = await detectStack(SPRING_FIXTURE)
    const registry = createDefaultRegistry()
    const adapter = registry.get(stack.adapterId)
    const beResult = adapter !== undefined
      ? await adapter.analyze({ repoRoot: SPRING_FIXTURE, stack, analyzerVersion: 'codebase-viz@0.1.0' })
      : EMPTY_ADAPTER_RESULT
    const beRoutes = beResult.routeNodes
    expect(beRoutes.length).toBeGreaterThan(0)

    // 3. 매칭
    const feGraph = makeMiniFEGraph()
    const beGraph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: SPRING_FIXTURE,
      projectName: 'mini-spring-app',
      nodes: beRoutes,
      edges: [],
    })

    const rawEdges = matchFeCallsToBeRoutes(feCalls, beRoutes, {
      fromRepoRoot: feGraph.repoRoot,
      toRepoRoot: SPRING_FIXTURE,
      analyzerVersion: 'codebase-viz@0.1.0',
    })
    expect(rawEdges.length).toBeGreaterThan(0)

    // 4. from-id remap
    const crossEdges = remapCrossEdgeFromIds(rawEdges, feGraph)
    const feNodeIds = new Set(feGraph.nodes.map(n => n.id))
    const matchedEdges = crossEdges.filter(e =>
      e.confidence === 'verified' ||
      (e.confidence === 'inferred' && e.inferenceChain?.includes('dynamic-segment-match'))
    )
    for (const edge of matchedEdges) {
      expect(feNodeIds.has(edge.from)).toBe(true)
    }

    // 5. combined diagram 생성
    const diagrams = buildCombinedDiagram(feGraph, beGraph, crossEdges)
    expect(diagrams.rendering).toContain('graph TD')
    expect(diagrams.rendering).toContain('FE_PROJ')
    expect(diagrams.rendering).toContain('BE_PROJ')
    expect(diagrams.rendering).toContain('-.->') // cross-edge dashed
    expect(diagrams.dbScreen).toContain('erDiagram') // BE DB
  })

  it('노드 임계 초과 fallback — 결합 다이어그램 안내문 포함 (A2: 문구를 실제 임계로 정정)', () => {
    const feGraph = makeMiniFEGraph()
    const beRoute = createRouteNode({
      id: makeNodeId('route', 'src/main/java/com/x/OrderController.java', '/api/orders'),
      path: '/api/orders',
      filePath: 'src/main/java/com/x/OrderController.java',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'SSR',
      provenance: { ...FE_PROV, file: 'src/main/java/com/x/OrderController.java' },
      confidence: 'verified',
    })
    const beGraph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/be',
      projectName: 'backend',
      metadata: {
        framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false,
        hasFirebase: false, adapterCategory: 'BE',
      },
      nodes: [beRoute],
      edges: [],
    })
    // threshold를 0으로 설정하면 렌더 텍스트 길이만으로 항상 fallback(A2: 노드수 기반 문구로 교체됐으므로
    // beGraph가 비어있지 않은 정상 케이스에서 확인한다 — beGraph=0은 별도 단독폴백 분기(테스트는
    // packages/renderer/src/combined-diagram.test.ts로 이동)로 이 fallback과 의미가 다르다).
    const diagrams = buildCombinedDiagram(feGraph, beGraph, [], { chunkThreshold: 0 })
    // A2 재보정(scope-critic): 문구는 실제 트리거(텍스트 길이 vs 노드수)를 반영한다.
    // 이 케이스는 crossEdges가 없어 matchedRouteCount=0이라 텍스트 길이 트리거로 떨어진다.
    expect(diagrams.rendering).toMatch(/결합 다이어그램 (노드 \d+개|텍스트 \d+자) 초과/)
    expect(diagrams.rendering).not.toContain('FE_PROJ')
  })
})
