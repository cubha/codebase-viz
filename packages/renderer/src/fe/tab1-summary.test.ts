import { describe, it, expect } from 'vitest'
import { createIRGraph, createRouteNode, createEdge, makeNodeId, makeEdgeId, type RouteNode, type IREdge } from '@codebase-viz/types'
import { buildDiagrams } from '../mermaid-renderer.js'
import { buildDomainSummaryLines } from './tab1-summary.js'
import { groupRoutesByUrl } from '../url-grouper.js'
import { findBranchingGroups } from '../helpers/layout.js'

const PROV = { file: 'src/router.tsx', line: 1, adapter: 'reactrouter', analyzerVersion: '0.1' }

function rrRoute(routePath: string): RouteNode {
  return createRouteNode({
    id: makeNodeId('route', 'src/router.tsx', routePath),
    path: routePath,
    filePath: 'src/router.tsx',
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'CSR',
    provenance: PROV,
    confidence: 'verified',
  })
}

function apiEdge(from: ReturnType<typeof makeNodeId>): IREdge {
  const endpoint = makeNodeId('endpoint', '/api/x', 'GET')
  return createEdge({
    id: makeEdgeId('api-call', from, endpoint),
    from,
    to: endpoint,
    kind: 'api-call',
    provenance: PROV,
    confidence: 'inferred',
    inferenceChain: ['axios.get'],
  })
}

function rrGraph(routes: RouteNode[], edges: IREdge[] = []): ReturnType<typeof createIRGraph> {
  return createIRGraph({
    analyzerVersion: 'codebase-viz@0.1.0',
    repoRoot: '/tmp/test',
    metadata: {
      framework: 'react-router',
      hasSupabase: false,
      hasPrisma: false,
      hasDexie: false,
      hasFirebase: false,
      adapterCategory: 'FE',
    },
    nodes: routes,
    edges,
  })
}

describe('buildDomainSummaryLines (Tab1 v1.2 — R-T1.2)', () => {
  it('top-level 도메인을 라우트 수 배지 박스로 emit한다 (하위 세그먼트 미중첩)', () => {
    const routes = [
      rrRoute('/partner/matMgmt/deco'),
      rrRoute('/partner/matMgmt/spec'),
      rrRoute('/partner/ordMgmt/plan'),
      rrRoute('/agency/user'),
    ]
    const domains = findBranchingGroups(groupRoutesByUrl(routes))
    const lines = buildDomainSummaryLines(domains, '  ').join('\n')

    // partner 도메인 박스 1개 + 라우트 수 3
    expect(lines).toMatch(/partner · 3 routes/)
    expect(lines).toMatch(/agency · 1 route\b/)
    // 하위 세그먼트(matMgmt/ordMgmt)는 별도 박스/레이어로 등재되지 않는다 (1a 해소)
    expect(lines).not.toContain('matMgmt')
    expect(lines).not.toContain('ordMgmt')
    // 형제 도메인은 ~~~ chain으로 X축 보장
    expect(lines).toContain(' ~~~ ')
  })

  it('도메인 수 > GROUPS_PER_ROW(5)면 inner-row wrapper로 줄넘김(청킹 아님)', () => {
    const routes = [
      rrRoute('/a/x'), rrRoute('/b/x'), rrRoute('/c/x'),
      rrRoute('/d/x'), rrRoute('/e/x'), rrRoute('/f/x'), rrRoute('/g/x'),
    ]
    const domains = findBranchingGroups(groupRoutesByUrl(routes))
    const lines = buildDomainSummaryLines(domains, '  ').join('\n')
    // 7개 도메인 → row wrapper subgraph 생성
    expect(lines).toMatch(/subgraph DOMAINS_R\d/)
    // 청크 구분자는 절대 포함 안 됨 (단일 다이어그램)
    expect(lines).not.toContain('%%--CHUNK--%%')
  })
})

describe('buildRenderingDiagram Tab1 — 대형 다도메인에서도 프레임워크·데이터레이어 유지 (1b 회귀가드)', () => {
  it('react-router 7도메인: wrapper(BROWSER/ROUTER/REACT)·API LAYER 유지 + 청킹 안 함', () => {
    const routes = [
      rrRoute('/partner/matMgmt/deco'),
      rrRoute('/agency/user'),
      rrRoute('/headoffice/base'),
      rrRoute('/sales/order'),
      rrRoute('/finance/bill'),
      rrRoute('/system/code'),
      rrRoute('/report/daily'),
    ]
    const edges = [apiEdge(routes[0]!.id)]
    const { rendering } = buildDiagrams(rrGraph(routes, edges))

    // 1b 핵심: 프레임워크 wrapper 유지
    expect(rendering).toContain('subgraph BROWSER')
    expect(rendering).toContain('ROUTER')
    expect(rendering).toContain('REACT')
    // 데이터레이어(외부 API) 유지
    expect(rendering).toContain('API LAYER')
    // Tab1은 청킹하지 않는다 (R-T1.7 v1.2)
    expect(rendering).not.toContain('%%--CHUNK--%%')
    // 도메인 요약 박스
    expect(rendering).toMatch(/partner · 1 route\b/)
    // Tab1은 nested+~~~ 구조라 spacing 옵션이 무시됨 → FE_TREE_INIT 미적용(RENDERING_INIT 유지)
    expect(rendering).not.toContain("'rankSpacing'")
  })

  it('도메인 5개(게이트 미발동 케이스)도 동일하게 wrapper 유지 + leaf 라우트 미열거', () => {
    const routes = [
      rrRoute('/order-plan/spec'),
      rrRoute('/material/deco'),
      rrRoute('/agency/users'),
      rrRoute('/head-office/proc-code'),
      rrRoute('/perf/trans'),
    ]
    const { rendering } = buildDiagrams(rrGraph(routes))
    expect(rendering).toContain('subgraph BROWSER')
    // 개별 라우트 leaf 노드(예: 'spec · CSR')는 Tab1에 더 이상 없음 → Tab2로 위임
    expect(rendering).not.toContain('spec · CSR')
    expect(rendering).not.toContain('%%--CHUNK--%%')
  })
})
