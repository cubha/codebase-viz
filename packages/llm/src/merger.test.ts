import { describe, it, expect } from 'vitest'
import { mergeGraphs } from './merger.js'
import {
  createIRGraph,
  createRouteNode,
  createComponentNode,
  makeNodeId,
  makeEdgeId,
  createEdge,
} from '@codebase-viz/types'

const PROV = { file: 'app/page.tsx', line: 1, adapter: 'test', analyzerVersion: '0.1' }

function makeVerifiedRoute(routePath: string, filePath: string) {
  return createRouteNode({
    id: makeNodeId('route', filePath, routePath),
    path: routePath,
    filePath,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    provenance: { ...PROV, file: filePath },
    confidence: 'verified',
  })
}

function makeInferredRoute(routePath: string, filePath: string) {
  return createRouteNode({
    id: makeNodeId('route', filePath, routePath),
    path: routePath,
    filePath,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    provenance: { ...PROV, file: filePath },
    confidence: 'inferred',
    inferenceChain: ['LLM identified'],
  })
}

describe('mergeGraphs', () => {
  it('정적 노드와 LLM 노드를 합친다', () => {
    const staticRoute = makeVerifiedRoute('/blog', 'app/blog/page.tsx')
    const staticGraph = createIRGraph({ analyzerVersion: '0.1', repoRoot: '/tmp', nodes: [staticRoute], edges: [] })

    const llmRoute = makeInferredRoute('/contact', 'app/contact/page.tsx')
    const merged = mergeGraphs(staticGraph, [llmRoute], [])

    expect(merged.nodes).toHaveLength(2)
  })

  it('같은 파일 경로의 verified 노드가 있으면 LLM inferred 노드는 무시된다', () => {
    const staticRoute = makeVerifiedRoute('/blog', 'app/blog/page.tsx')
    const staticGraph = createIRGraph({ analyzerVersion: '0.1', repoRoot: '/tmp', nodes: [staticRoute], edges: [] })

    const llmDupeRoute = makeInferredRoute('/blog', 'app/blog/page.tsx')
    const merged = mergeGraphs(staticGraph, [llmDupeRoute], [])

    expect(merged.nodes).toHaveLength(1)
    // verified 노드가 유지된다
    expect(merged.nodes[0]?.confidence).toBe('verified')
  })

  it('정적 엣지와 LLM 엣지를 합친다', () => {
    const compId = makeNodeId('component', 'app/Header.tsx', 'Header')
    const routeId = makeNodeId('route', 'app/page.tsx', '/')
    const staticGraph = createIRGraph({ analyzerVersion: '0.1', repoRoot: '/tmp', nodes: [], edges: [] })

    const llmEdge = createEdge({
      id: makeEdgeId('renders', routeId, compId),
      from: routeId,
      to: compId,
      kind: 'renders',
      provenance: PROV,
      confidence: 'inferred',
      inferenceChain: ['LLM'],
    })
    const merged = mergeGraphs(staticGraph, [], [llmEdge])
    expect(merged.edges).toHaveLength(1)
  })

  it('중복 엣지는 추가되지 않는다', () => {
    const compId = makeNodeId('component', 'app/Header.tsx', 'Header')
    const routeId = makeNodeId('route', 'app/page.tsx', '/')
    const existingEdge = createEdge({
      id: makeEdgeId('renders', routeId, compId),
      from: routeId,
      to: compId,
      kind: 'renders',
      provenance: PROV,
      confidence: 'verified',
    })
    const staticGraph = createIRGraph({ analyzerVersion: '0.1', repoRoot: '/tmp', nodes: [], edges: [existingEdge] })

    const llmDupeEdge = createEdge({
      id: makeEdgeId('renders', routeId, compId),
      from: routeId,
      to: compId,
      kind: 'renders',
      provenance: PROV,
      confidence: 'inferred',
      inferenceChain: ['LLM'],
    })
    const merged = mergeGraphs(staticGraph, [], [llmDupeEdge])
    expect(merged.edges).toHaveLength(1)
  })
})
