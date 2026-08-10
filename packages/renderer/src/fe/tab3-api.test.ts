import { describe, it, expect } from 'vitest'
import {
  createIRGraph,
  createRouteNode,
  createComponentNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type IRGraph,
  type RouteNode,
  type ComponentNode,
} from '@codebase-viz/types'
import { buildFeApiCallDiagram } from './tab3-api.js'
import { buildNodeMap } from '../helpers/node-map.js'

const PROV = { file: '', line: 1, adapter: 'react-router@0.1', analyzerVersion: 'test' }

function route(urlPath: string, filePath: string): RouteNode {
  return createRouteNode({
    id: makeNodeId('route', filePath, 'page'),
    path: urlPath,
    filePath,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'CSR',
    provenance: { ...PROV, file: filePath },
    confidence: 'verified',
  })
}

function component(name: string, filePath: string): ComponentNode {
  return createComponentNode({
    id: makeNodeId('component', filePath, name),
    name,
    filePath,
    runtime: 'client',
    provenance: { ...PROV, file: filePath },
    confidence: 'verified',
  })
}

// route(/a)→CompA(inferred 호출)와 route(/b)→CompB(verified 호출)가 **같은** endpoint(GET /shared)를
// 호출한다. groupRoutesByUrl은 알파벳순이라 /a가 /b보다 먼저 순회되므로, 순서 의존 first-wins였다면
// inferred가 이겼을 것 — endpoint별 대표 엣지 사전선정이 순서와 무관하게 verified를 골라야 한다.
function buildSharedEndpointGraph(edgeOrder: 'inferred-first' | 'verified-first'): IRGraph {
  const routeA = route('/a', 'app/a/page.tsx')
  const routeB = route('/b', 'app/b/page.tsx')
  const compA = component('CompA', 'components/CompA.tsx')
  const compB = component('CompB', 'components/CompB.tsx')
  const rendersA = createEdge({
    id: makeEdgeId('renders', routeA.id, compA.id), from: routeA.id, to: compA.id,
    kind: 'renders', provenance: PROV, confidence: 'verified',
  })
  const rendersB = createEdge({
    id: makeEdgeId('renders', routeB.id, compB.id), from: routeB.id, to: compB.id,
    kind: 'renders', provenance: PROV, confidence: 'verified',
  })
  const endpointId = makeNodeId('endpoint', 'virtual', 'GET:/shared')
  const inferredCall = createEdge({
    id: makeEdgeId('api-call', compA.id, endpointId), from: compA.id, to: endpointId,
    kind: 'api-call', apiCall: { method: 'GET', path: '/shared', library: 'fetch' },
    provenance: { ...PROV, file: 'components/CompA.tsx', line: 7 },
    confidence: 'inferred', inferenceChain: ['heuristic: bare fetch call'],
  })
  const verifiedCall = createEdge({
    id: makeEdgeId('api-call', compB.id, endpointId), from: compB.id, to: endpointId,
    kind: 'api-call', apiCall: { method: 'GET', path: '/shared', library: 'axios' },
    provenance: { ...PROV, file: 'components/CompB.tsx', line: 11 },
    confidence: 'verified',
  })
  const apiCallEdges = edgeOrder === 'inferred-first' ? [inferredCall, verifiedCall] : [verifiedCall, inferredCall]
  return createIRGraph({
    analyzerVersion: 'test',
    repoRoot: '/repo',
    metadata: { framework: 'react-router', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false },
    nodes: [routeA, routeB, compA, compB],
    edges: [rendersA, rendersB, ...apiCallEdges],
  })
}

describe('buildFeApiCallDiagram — endpoint 대표 엣지 선정 (v1.2.63 D5, Evidence-First)', () => {
  it.each(['inferred-first', 'verified-first'] as const)(
    '엣지 배열 순서(%s)와 무관하게 같은 endpoint의 verified 호출이 대표로 선정된다',
    (order) => {
      const graph = buildSharedEndpointGraph(order)
      const text = buildFeApiCallDiagram(graph)
      const nodeMap = buildNodeMap(graph, [text])
      const epId = Object.keys(nodeMap).find(k => k.startsWith('ep_'))
      expect(epId, text).toBeDefined()
      const entry = nodeMap[epId!]!
      expect(entry.c).toBe('verified')
      expect(entry.f).toBe('components/CompB.tsx')
      expect(entry.l).toBe(11)
    },
  )

  it('동일 confidence 충돌 시 edge id 사전순으로 결정론적 선택한다', () => {
    const routeA = route('/a', 'app/a/page.tsx')
    const compA = component('CompA', 'components/CompA.tsx')
    const compC = component('CompC', 'components/CompC.tsx')
    const rendersA = createEdge({
      id: makeEdgeId('renders', routeA.id, compA.id), from: routeA.id, to: compA.id,
      kind: 'renders', provenance: PROV, confidence: 'verified',
    })
    const endpointId = makeNodeId('endpoint', 'virtual', 'GET:/tie')
    const callFromA = createEdge({
      id: makeEdgeId('api-call', compA.id, endpointId), from: compA.id, to: endpointId,
      kind: 'api-call', apiCall: { method: 'GET', path: '/tie', library: 'fetch' },
      provenance: { ...PROV, file: 'components/CompA.tsx', line: 3 }, confidence: 'verified',
    })
    const callFromC = createEdge({
      id: makeEdgeId('api-call', compC.id, endpointId), from: compC.id, to: endpointId,
      kind: 'api-call', apiCall: { method: 'GET', path: '/tie', library: 'fetch' },
      provenance: { ...PROV, file: 'components/CompC.tsx', line: 3 }, confidence: 'verified',
    })
    const expectedWinner = callFromA.id < callFromC.id ? callFromA : callFromC
    const graph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/repo',
      metadata: { framework: 'react-router', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false },
      nodes: [routeA, compA, compC],
      edges: [rendersA, callFromC, callFromA], // 배열 순서를 사전순과 다르게(C 먼저) 배치
    })
    const text = buildFeApiCallDiagram(graph)
    const nodeMap = buildNodeMap(graph, [text])
    const epId = Object.keys(nodeMap).find(k => k.startsWith('ep_'))
    expect(nodeMap[epId!]?.f).toBe(expectedWinner.provenance.file)
  })

  it.each(['inferred-first', 'verified-first'] as const)(
    '엣지 배열 순서(%s)와 무관하게 endpoint 라벨(화살표·library)도 대표(verified) 엣지 기준으로 통일된다',
    (order) => {
      // 마커만 대표 엣지를 쓰고 라벨은 route-tree 순회 순서(call)를 쓰면, 화면엔 inferred
      // 근거(⟿ fetch)가 보이는데 클릭하면 verified 호출(axios)로 점프하는 불일치가 생긴다.
      const graph = buildSharedEndpointGraph(order)
      const text = buildFeApiCallDiagram(graph)
      expect(text).toContain('GET /shared → axios') // verified(axios, → 화살표) 기준으로 통일
      expect(text).not.toContain('⟿ fetch') // inferred(fetch, ⟿ 화살표) 라벨은 나타나지 않는다
    },
  )

  it('endpoint 마커가 렌더 텍스트에 emit되어 nodeMap이 채워진다', () => {
    const graph = buildSharedEndpointGraph('inferred-first')
    const text = buildFeApiCallDiagram(graph)
    expect(text).toContain('%% nodemap:ep_')
    const nodeMap = buildNodeMap(graph, [text])
    expect(Object.keys(nodeMap).some(k => k.startsWith('ep_'))).toBe(true)
  })
})
