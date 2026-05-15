import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFeCallsFromText, matchFeCallsToBeRoutes, remapCrossEdgeFromIds, createDefaultRegistry } from '@codebase-viz/core'
import { buildCombinedDiagram } from '@codebase-viz/renderer'
import { createIRGraph, createComponentNode, createRouteNode, makeNodeId, EMPTY_ADAPTER_RESULT, type IRGraph } from '@codebase-viz/types'
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
  return createIRGraph({
    analyzerVersion: 'codebase-viz@0.1.0',
    repoRoot: '/fe/mini-next-app',
    projectName: 'mini-next-app',
    nodes: [route, comp],
    edges: [],
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

  it('1M 초과 fallback — 결합 다이어그램 안내문 포함', () => {
    const feGraph = makeMiniFEGraph()
    const beGraph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/be',
      projectName: 'backend',
      nodes: [],
      edges: [],
    })
    // threshold를 0으로 설정하면 항상 fallback
    const diagrams = buildCombinedDiagram(feGraph, beGraph, [], { chunkThreshold: 0 })
    expect(diagrams.rendering).toContain('1M 초과')
    expect(diagrams.rendering).not.toContain('FE_PROJ')
  })
})
