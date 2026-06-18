import { describe, it, expect } from 'vitest'
import type { RouteNode, ComponentNode, IREdge } from '@codebase-viz/types'
import { buildFeDomainLayeredScreenDiagram, isPagesDomainEligible } from './tab2-domain.js'

function route(id: string, p: string): RouteNode {
  return {
    kind: 'route', id, path: p, filePath: 'src/router.tsx', routeFileKind: 'page',
    dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'csr',
    provenance: { file: 'src/router.tsx', adapter: 'react-router@0.1', analyzerVersion: 't' },
    confidence: 'verified',
  } as unknown as RouteNode
}
function comp(id: string, name: string, filePath: string): ComponentNode {
  return {
    kind: 'component', id, name, filePath, runtime: 'client',
    provenance: { file: filePath, adapter: 'react-router@0.1', analyzerVersion: 't' },
    confidence: 'verified',
  } as unknown as ComponentNode
}
function renders(from: string, to: string): IREdge {
  return { kind: 'renders', id: `e_${from}_${to}`, from, to, provenance: { file: 'x', adapter: 'react-router@0.1', analyzerVersion: 't' }, confidence: 'verified' } as unknown as IREdge
}

// 사용자 실제 구조: src/pages/<Root 도메인>/.../Page.tsx, URL은 폴더와 divergent.
const routes: RouteNode[] = [
  route('r1', '/order-plan/spec'),
  route('r2', '/material/deco'),
  route('r3', '/perf/trans'),
  route('r4', '/agency/users'),
  route('r5', '/head-office/proc-code'),
]
const comps: ComponentNode[] = [
  comp('c1', 'OrdSpecPrintPage', 'src/pages/partner/ordProdPlanMgmt/prodOrdSpec/OrdSpecPrintPage.tsx'),
  comp('c2', 'DecoSheetPage', 'src/pages/partner/matMgmt/decoSheet/DecoSheetPage.tsx'),
  comp('c3', 'TrnStmtSchPage', 'src/pages/partner/perfMgmt/transStmt/TrnStmtSchPage.tsx'),
  comp('c4', 'UserMgmtPage', 'src/pages/agency/userMgmt/UserMgmtPage.tsx'),
  comp('c5', 'ProcCodeMgmtPage', 'src/pages/headoffice/partnerBaseInfo/procCodeMgmt/ProcCodeMgmtPage.tsx'),
]
const edges: IREdge[] = [renders('r1','c1'), renders('r2','c2'), renders('r3','c3'), renders('r4','c4'), renders('r5','c5')]

describe('FE Tab2 도메인 레이어 (v1.2.50 B-ST2)', () => {
  it('isPagesDomainEligible: 다중 도메인(partner/agency/headoffice) 깊은 구조면 true', () => {
    expect(isPagesDomainEligible(comps)).toBe(true)
  })

  it('isPagesDomainEligible: src/pages 직속(평탄) 컴포넌트만이면 false (URL 그룹핑 fallback)', () => {
    const flat = [comp('f1', 'HomePage', 'src/pages/HomePage.tsx'), comp('f2', 'AboutPage', 'src/pages/AboutPage.tsx')]
    expect(isPagesDomainEligible(flat)).toBe(false)
  })

  it('top-level 도메인(partner/agency/headoffice)별 별도 레이어로 분리', () => {
    const out = buildFeDomainLayeredScreenDiagram(routes, edges, comps)
    // BE처럼 top-level 도메인 단위 chunk 분리 (3 도메인 → 3 mermaid 블록)
    expect(out.split('graph TD').length - 1).toBeGreaterThanOrEqual(3)
    expect(out).toContain('📁 src/pages')
    // partner 도메인 헤더에 3개 페이지가 모두 포함
    expect(out).toContain('OrdSpecPrintPage.tsx')
    expect(out).toContain('DecoSheetPage.tsx')
    expect(out).toContain('TrnStmtSchPage.tsx')
  })

  it('중간 폴더(ordProdPlanMgmt/prodOrdSpec) 트리 노드가 도메인 헤더 아래 nest', () => {
    const out = buildFeDomainLayeredScreenDiagram(routes, edges, comps)
    expect(out).toContain('ordProdPlanMgmt')
    expect(out).toContain('prodOrdSpec')
    // 각 페이지 leaf는 route 표시 + 렌더모드 배지
    expect(out).toContain('spec · csr')
  })

  // 컴포넌트 미해결(import.meta.glob 동적 인입) 라우트도 다른 도메인과 동일하게 분리.
  it('컴포넌트 엣지 없는 agency 라우트 → URL path로 src/pages/agency 도메인 분리', () => {
    // edge 없는 라우트: import.meta.glob로 컴포넌트가 동적 인입되어 정적 추적 불가한 케이스.
    const agencyRoutes: RouteNode[] = [
      ...routes,
      route('g1', '/agency/agencyFactory/masterMgmt/customerMgmt'),
      route('g2', '/agency/agencyFactory/quotationWork/quotationContract'),
    ]
    const out = buildFeDomainLayeredScreenDiagram(agencyRoutes, edges, comps)
    // agency 도메인 박스 + 중첩 트리가 다른 도메인과 동일하게 표시 (이전엔 일반 src/pages 버킷으로 누락)
    expect(out).toContain('📁 src/pages/agency')
    expect(out).toContain('agencyFactory')
    expect(out).toContain('masterMgmt')
    expect(out).toContain('customerMgmt · csr')
    // 일반 _root 버킷이 아니라 agency 도메인 chunk에 들어가야 함
    const agencyIdx = out.indexOf('src/pages/agency')
    const rootIdx = out.lastIndexOf('"📁 src/pages"')
    expect(agencyIdx).toBeGreaterThanOrEqual(0)
    if (rootIdx >= 0) expect(out.indexOf('customerMgmt')).toBeLessThan(rootIdx > agencyIdx ? rootIdx : out.length)
  })

  // v1.2.53 ST4: Tab2 도메인 트리는 FE_TREE_INIT(compact rankSpacing)로 Y축 연결선 표준화.
  it('FE_TREE_INIT compact rankSpacing 적용 (Y축 연결선 표준화)', () => {
    const out = buildFeDomainLayeredScreenDiagram(routes, edges, comps)
    expect(out).toContain("'rankSpacing':24")
    expect(out).toContain("'nodeSpacing':40")
  })
})
