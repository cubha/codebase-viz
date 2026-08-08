import { describe, it, expect } from 'vitest'
import { createIRGraph, createRouteNode, createEdge, makeNodeId, makeEdgeId, type RouteNode, type IREdge } from '@codebase-viz/types'
import { buildNestedFolderOverviewLines } from './tab1-tree.js'
import { stripNodeMapMarkers } from '../helpers/node-map.js'
import { buildDiagrams } from '../mermaid-renderer.js'
import { groupRoutesByUrl } from '../url-grouper.js'

const PROV = { file: 'src/router.tsx', line: 1, adapter: 'reactrouter', analyzerVersion: '0.1' }

function rr(p: string): RouteNode {
  return createRouteNode({
    id: makeNodeId('route', 'src/router.tsx', p),
    path: p,
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

// `%% nodemap:` 마커는 딥링크(T1) 전용 사이드채널로 buildDiagrams/renderMermaid가 출력 직전
// 제거한다 — 렌더되는 라벨 내용을 검사하는 이 스펙들에는 애초에 존재하지 않는 라인이다.
function overview(routes: RouteNode[]): string {
  return stripNodeMapMarkers(buildNestedFolderOverviewLines(groupRoutesByUrl(routes), '  ').join('\n'))
}

describe('buildNestedFolderOverviewLines (Tab1 v1.2.55 — full-depth folder 개요)', () => {
  it('구조적 폴더(중분류)를 full-depth 중첩 subgraph로 보존한다 (v1.2.53 flat 요약 반전)', () => {
    const lines = overview([
      rr('/partner/matMgmt/deco'),
      rr('/partner/matMgmt/spec'),
      rr('/partner/ordMgmt/plan'),
      rr('/agency/user'),
    ])
    // partner는 구조적 폴더(하위 분기 존재) → subgraph + 재귀 카운트 헤더
    expect(lines).toMatch(/subgraph \S+\["📁 \/partner · 3 routes"\]/)
    // 중분류 matMgmt/ordMgmt가 카운트 박스로 등재 (v1.2.53은 "matMgmt 미포함"이었음)
    expect(lines).toMatch(/📁 \/matMgmt · 2 routes/)
    expect(lines).toMatch(/📁 \/ordMgmt · 1 route\b/)
    // agency는 단일 라우트 → 카운트 박스(subgraph 아님)
    expect(lines).toMatch(/📁 \/agency · 1 route\b/)
    expect(lines).not.toMatch(/subgraph \S+\["📁 \/agency/)
  })

  it('개별 route leaf(렌더링모드 배지 노드)는 emit하지 않는다 — Tab2 위임', () => {
    const lines = overview([rr('/partner/matMgmt/deco'), rr('/partner/matMgmt/spec')])
    // leaf-folder matMgmt는 deco/spec를 개별 route 노드로 펼치지 않고 카운트로 collapse
    expect(lines).not.toContain('deco · CSR')
    expect(lines).not.toContain('spec · CSR')
    expect(lines).not.toContain('/partner/matMgmt/deco')
    expect(lines).toMatch(/📁 \/matMgmt · 2 routes/)
  })

  it('재귀 카운트: 상위 폴더 헤더 배지는 모든 하위 route의 합', () => {
    const lines = overview([rr('/system/code/list'), rr('/system/code/detail'), rr('/system/role')])
    expect(lines).toMatch(/📁 \/system · 3 routes/)
    expect(lines).toMatch(/📁 \/code · 2 routes/)
  })

  it('혼합 폴더: 단일라우트 자식 2개+ 는 하나의 📄 집계 박스로 묶고 다중 자식은 구조 유지', () => {
    // sysX: code·msg·menu(각 1-route) 단일 3개 + role(2-route) 다중 1개
    const lines = overview([
      rr('/sysX/code'), rr('/sysX/msg'), rr('/sysX/menu'),
      rr('/sysX/role/a'), rr('/sysX/role/b'),
    ])
    // 다중 분기 role은 박스로 유지(구조)
    expect(lines).toMatch(/📁 \/role · 2 routes/)
    // 단일 3개는 개별 박스가 아니라 하나의 📄 집계 박스 (M pages)
    expect(lines).toMatch(/📄 [^"]*\(3 pages\)/)
    expect(lines).not.toMatch(/📁 \/code · 1 route/)
    expect(lines).not.toMatch(/📁 \/msg · 1 route/)
  })

  it('혼합 폴더: 단일라우트 자식이 1개뿐이면 집계 없이 이름 박스로 표시', () => {
    // alloc: ordAllocInfo(2-route) 다중 + ordAllocMgmt(1-route) 단일 1개 → 집계 안 함
    const lines = overview([
      rr('/alloc/ordAllocInfo/x'), rr('/alloc/ordAllocInfo/y'), rr('/alloc/ordAllocMgmt/z'),
    ])
    expect(lines).toMatch(/📁 \/ordAllocInfo · 2 routes/)
    expect(lines).toMatch(/📁 \/ordAllocMgmt · 1 route\b/)
    expect(lines).not.toMatch(/\(1 pages?\)/)
  })

  it('청크 구분자를 포함하지 않는다 (단일 다이어그램·청킹 폐지)', () => {
    const lines = overview(Array.from({ length: 12 }, (_, i) => rr(`/d${i}/x`)))
    expect(lines).not.toContain('%%--CHUNK--%%')
  })

  it('누락 0: WINA 16 top-level 도메인이 전부 출력에 존재한다', () => {
    // 사용자 제공 WINA 라우터 16 top-level (camelCase·dual-prefix 포함)
    const domains = [
      'login', 'sso-login', 'sso-result', 'home', 'system', 'sample', 'publish',
      'model', 'profile', 'reference-info', 'price', 'headOffice', 'agency',
      'partner', 'mobile', 'template',
    ]
    const routes = domains.flatMap(d => [rr(`/${d}/a`), rr(`/${d}/b`)])
    const lines = overview(routes)
    for (const d of domains) {
      expect(lines, `도메인 /${d} 누락`).toContain(`📁 /${d} ·`)
    }
  })
})

describe('buildRenderingDiagram Tab1 — 대형 다도메인 wrapper·데이터레이어 유지 (1b 회귀가드)', () => {
  it('react-router 7도메인: wrapper(BROWSER/ROUTER/REACT)·API LAYER 유지 + 청킹 안 함', () => {
    const routes = [
      rr('/partner/matMgmt/deco'),
      rr('/agency/user'),
      rr('/headoffice/base'),
      rr('/sales/order'),
      rr('/finance/bill'),
      rr('/system/code'),
      rr('/report/daily'),
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
    // 폴더 개요 박스(재귀 카운트 배지)
    expect(rendering).toMatch(/📁 \/partner · 1 route\b/)
    // Tab1은 nested 구조라 spacing 옵션이 무시됨 → FE_TREE_INIT 미적용(RENDERING_INIT 유지)
    expect(rendering).not.toContain("'rankSpacing'")
  })

  it('도메인 5개(게이트 미발동 케이스)도 동일하게 wrapper 유지 + leaf 라우트 미열거', () => {
    const routes = [
      rr('/order-plan/spec'),
      rr('/material/deco'),
      rr('/agency/users'),
      rr('/head-office/proc-code'),
      rr('/perf/trans'),
    ]
    const { rendering } = buildDiagrams(rrGraph(routes))
    expect(rendering).toContain('subgraph BROWSER')
    // 개별 라우트 leaf 노드(예: 'spec · CSR')는 Tab1에 더 이상 없음 → Tab2로 위임
    expect(rendering).not.toContain('spec · CSR')
    expect(rendering).not.toContain('%%--CHUNK--%%')
  })
})
