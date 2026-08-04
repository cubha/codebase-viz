import { describe, it, expect } from 'vitest'
import {
  createIRGraph,
  createRouteNode,
  createComponentNode,
  createTableNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type IRGraph,
  type IREdge,
  type RouteNode,
  type ComponentNode,
  type IRGraphMetadata,
  type NodeId,
} from '@codebase-viz/types'
import { buildCombinedDiagram } from './mermaid-renderer.js'
import { CHUNK_SEPARATOR } from './_shared/wrap-fallback.js'

const PROV = { file: 'x', line: 1, adapter: 'test@0.1', analyzerVersion: 'test' }

const BE_META: IRGraphMetadata = {
  framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false,
  adapterCategory: 'BE',
}

function makeFeRoute(urlPath: string, compName: string): { route: RouteNode; comp: ComponentNode; edges: IREdge[]; nodes: (RouteNode | ComponentNode)[] } {
  const routeId = makeNodeId('route', `app${urlPath}/page.tsx`, 'page')
  const compId = makeNodeId('component', `components/${compName}.tsx`, compName)
  const route = createRouteNode({
    id: routeId,
    path: urlPath === '' ? '/' : urlPath,
    filePath: `app${urlPath}/page.tsx`,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    provenance: PROV,
    confidence: 'verified',
  })
  const comp = createComponentNode({
    id: compId,
    name: compName,
    filePath: `components/${compName}.tsx`,
    runtime: 'client',
    provenance: PROV,
    confidence: 'verified',
  })
  const rendersEdge = createEdge({
    id: makeEdgeId('renders', routeId, compId),
    from: routeId,
    to: compId,
    kind: 'renders',
    provenance: PROV,
    confidence: 'verified',
  })
  return { route, comp, edges: [rendersEdge], nodes: [route, comp] }
}

function makeBeRoute(urlPath: string): RouteNode {
  return createRouteNode({
    id: makeNodeId('route', `src/${urlPath}`, urlPath),
    path: urlPath,
    filePath: `src/${urlPath}`,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    provenance: PROV,
    confidence: 'verified',
  })
}

function makeCrossEdge(fromComponentId: NodeId, toRouteId: NodeId): IREdge {
  return createEdge({
    id: makeEdgeId('fe-be-call', fromComponentId, toRouteId),
    from: fromComponentId,
    to: toRouteId,
    kind: 'fe-be-call',
    provenance: PROV,
    confidence: 'verified',
  })
}

describe('buildCombinedDiagram — projectName 라벨 이스케이프 (security-auditor 지적, v1.2.60)', () => {
  it('FE_PROJ/BE_PROJ subgraph 라벨은 projectName(분석 대상 리포 폴더명, 신뢰 불가)의 대괄호·개행을 이스케이프한다', () => {
    const matched = makeFeRoute('/matched', 'MatchedWidget')
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test',
      repoRoot: '/fe',
      projectName: 'evil"]\nsubgraph INJECTED["pwned',
      nodes: matched.nodes,
      edges: matched.edges,
    })
    const beRoute = makeBeRoute('/api/matched')
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test',
      repoRoot: '/be',
      projectName: 'evil"]\nsubgraph INJECTED["pwned',
      metadata: BE_META,
      nodes: [beRoute],
      edges: [],
    })
    const remapped: IREdge[] = [makeCrossEdge(matched.comp.id, beRoute.id)]

    const diagrams = buildCombinedDiagram(feGraph, beGraph, remapped)
    // 이스케이프된 라벨은 payload 텍스트 자체는 남아도(무해한 문자열로) 개행·`"]` 조기종료로
    // "subgraph INJECTED[...]"가 별도 mermaid 문(statement)으로 분리되면 안 된다 — 한 줄에
    // FE_PROJ 선언과 함께 얹혀 있어야 무해하다.
    const lines = diagrams.rendering.split('\n')
    expect(lines.some(l => l.trim().startsWith('subgraph INJECTED'))).toBe(false)
    expect(lines.filter(l => l.includes('subgraph FE_PROJ')).every(l => l.includes('INJECTED'))).toBe(true)
  })
})

describe('buildCombinedDiagram — A2 matched-only 필터', () => {
  it('crossEdge에 참여하지 않는 FE·BE 라우트는 결합 Tab1에서 제외한다', () => {
    const matched = makeFeRoute('/matched', 'MatchedWidget')
    const unmatched = makeFeRoute('/unmatched', 'UnmatchedWidget')
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test',
      repoRoot: '/fe',
      projectName: 'fe',
      nodes: [...matched.nodes, ...unmatched.nodes],
      edges: [...matched.edges, ...unmatched.edges],
    })
    const beMatchedRoute = makeBeRoute('/api/matched')
    const beUnmatchedRoute = makeBeRoute('/api/unmatched')
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test',
      repoRoot: '/be',
      projectName: 'be',
      metadata: BE_META,
      nodes: [beMatchedRoute, beUnmatchedRoute],
      edges: [],
    })
    // remapCrossEdgeFromIds가 실제로 하는 일(from을 FE 컴포넌트 id로 리맵)을 흉내낸다.
    const remapped: IREdge[] = [makeCrossEdge(matched.comp.id, beMatchedRoute.id)]

    const diagrams = buildCombinedDiagram(feGraph, beGraph, remapped)
    expect(diagrams.rendering).toContain('matched')
    expect(diagrams.rendering).not.toContain('unmatched')
    expect(diagrams.rendering).toContain('/api/matched')
    expect(diagrams.rendering).not.toContain('/api/unmatched')
  })

  it('dangling cross-edge(라우트 미매칭)는 결합 다이어그램에 선을 그리지 않는다', () => {
    const fe = makeFeRoute('/danglingcase', 'DanglingWidget')
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe',
      nodes: fe.nodes, edges: fe.edges,
    })
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/be', projectName: 'be', metadata: BE_META,
      nodes: [makeBeRoute('/api/other')], edges: [],
    })
    const danglingId = fe.comp.id
    const dangling = createEdge({
      id: makeEdgeId('fe-be-call', danglingId, danglingId),
      from: danglingId,
      to: danglingId,
      kind: 'fe-be-call',
      provenance: PROV,
      confidence: 'inferred',
      inferenceChain: ['no-route-match'],
    })
    const diagrams = buildCombinedDiagram(feGraph, beGraph, [dangling])
    expect(diagrams.rendering).not.toContain('-.->')
  })
})

describe('buildCombinedDiagram — A2 Tab3 FE·BE 테이블 합집합', () => {
  it('BE 테이블만 넘기던 기존 결함을 고쳐 FE 테이블도 ERD에 포함한다', () => {
    const feTable = createTableNode({
      id: makeNodeId('table', 'fe/schema', 'posts'),
      name: 'posts',
      columns: [],
      provenance: PROV,
      confidence: 'verified',
    })
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe',
      nodes: [feTable], edges: [],
    })
    const beTable = createTableNode({
      id: makeNodeId('table', 'be/schema', 'orders'),
      name: 'orders',
      columns: [],
      provenance: PROV,
      confidence: 'verified',
    })
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/be', projectName: 'be', metadata: BE_META,
      nodes: [beTable], edges: [],
    })
    const diagrams = buildCombinedDiagram(feGraph, beGraph, [])
    expect(diagrams.dbScreen).toContain('posts')
    expect(diagrams.dbScreen).toContain('orders')
  })
})

describe('buildCombinedDiagram — A2 beGraph 빈 경우 단독 폴백', () => {
  it('베이스 어댑터 미발견(beGraph 노드 0건)이면 FE 단독 뷰 + 안내로 폴백한다', () => {
    const fe = makeFeRoute('/solo', 'SoloWidget')
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe',
      nodes: fe.nodes, edges: fe.edges,
    })
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/be', projectName: 'be',
      nodes: [], edges: [],
    })
    const diagrams = buildCombinedDiagram(feGraph, beGraph, [])
    expect(diagrams.rendering).not.toContain('BE_PROJ')
    expect(diagrams.rendering).not.toContain('FE_PROJ')
    expect(diagrams.rendering).toMatch(/인식하지 못했습니다|백엔드/)
  })
})

describe('buildCombinedDiagram — A2 Tab2/Tab3 chunk fallback 경유', () => {
  it('BE 테이블 수가 노드 임계를 넘으면 결합 Tab3도 청크 분할된다', () => {
    const fe = makeFeRoute('/chunk', 'ChunkWidget')
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe',
      nodes: fe.nodes, edges: fe.edges,
    })
    const manyTables = Array.from({ length: 40 }, (_, i) =>
      createTableNode({
        id: makeNodeId('table', 'be/schema', `T${i}`),
        name: `T${i}`,
        columns: [],
        provenance: PROV,
        confidence: 'verified',
      }))
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/be', projectName: 'be', metadata: BE_META,
      nodes: manyTables, edges: [],
    })
    const diagrams = buildCombinedDiagram(feGraph, beGraph, [], { nodeThreshold: 10, grouping: { maxNodesPerGroup: 10 } })
    expect(diagrams.dbScreen).toContain(CHUNK_SEPARATOR)
  })
})

describe('buildCombinedDiagram — A2 재보정(scope-critic): 전량 dangling·orphan 컴포넌트', () => {
  it('crossEdges가 전량 dangling이면 빈 껍데기 대신 매칭 없음 안내를 남긴다', () => {
    const fe = makeFeRoute('/orphanall', 'OrphanWidget')
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe',
      nodes: fe.nodes, edges: fe.edges,
    })
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/be', projectName: 'be', metadata: BE_META,
      nodes: [makeBeRoute('/api/unrelated')], edges: [],
    })
    const danglingId = fe.comp.id
    const dangling = createEdge({
      id: makeEdgeId('fe-be-call', danglingId, danglingId),
      from: danglingId, to: danglingId, kind: 'fe-be-call',
      provenance: PROV, confidence: 'inferred', inferenceChain: ['no-route-match'],
    })
    const diagrams = buildCombinedDiagram(feGraph, beGraph, [dangling])
    expect(diagrams.rendering).not.toContain('FE_PROJ')
    expect(diagrams.rendering).not.toContain('BE_PROJ')
    expect(diagrams.rendering).toMatch(/매칭된 FE↔BE 라우트가 없습니다/)
  })

  it('매칭된 crossEdge라도 FE 부모 라우트를 못 찾으면(renders 엣지 없음) raw 컴포넌트 id를 그리지 않는다', () => {
    // route→component 'renders' 엣지가 없는 컴포넌트(예: lib/api.ts 같은 api-client 모듈)를 흉내낸다.
    const orphanComp = createComponentNode({
      id: makeNodeId('component', 'lib/api.ts', 'apiClient'),
      name: 'apiClient',
      filePath: 'lib/api.ts',
      runtime: 'client',
      provenance: PROV,
      confidence: 'verified',
    })
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe',
      nodes: [orphanComp], edges: [], // renders 엣지 없음 — findParentRouteId가 undefined 반환
    })
    const beRoute = makeBeRoute('/api/orphan')
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/be', projectName: 'be', metadata: BE_META,
      nodes: [beRoute], edges: [],
    })
    const matched = makeCrossEdge(orphanComp.id, beRoute.id)
    const diagrams = buildCombinedDiagram(feGraph, beGraph, [matched])
    expect(diagrams.rendering).not.toContain('apiClient')
    expect(diagrams.rendering).not.toContain('-.->')
    expect(diagrams.rendering).toMatch(/매칭된 FE↔BE 라우트가 없습니다/)
  })

  it('부분매칭(정상 1건 + orphan 1건) — orphan 쪽 BE 라우트가 연결선 없이 새어나가지 않는다', () => {
    const normal = makeFeRoute('/normalcase', 'NormalWidget')
    const orphanComp = createComponentNode({
      id: makeNodeId('component', 'lib/api.ts', 'apiClient'),
      name: 'apiClient',
      filePath: 'lib/api.ts',
      runtime: 'client',
      provenance: PROV,
      confidence: 'verified',
    })
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe',
      nodes: [...normal.nodes, orphanComp], edges: normal.edges,
    })
    const normalBeRoute = makeBeRoute('/api/normal')
    const orphanBeRoute = makeBeRoute('/api/orphanmix')
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/be', projectName: 'be', metadata: BE_META,
      nodes: [normalBeRoute, orphanBeRoute], edges: [],
    })
    const edges = [
      makeCrossEdge(normal.comp.id, normalBeRoute.id),
      makeCrossEdge(orphanComp.id, orphanBeRoute.id),
    ]
    const diagrams = buildCombinedDiagram(feGraph, beGraph, edges)
    expect(diagrams.rendering).toContain('/api/normal')
    expect(diagrams.rendering).not.toContain('/api/orphanmix')
    expect(diagrams.rendering).not.toContain('apiClient')
  })
})

describe('buildCombinedDiagram — nodeMap FE/BE 병합 (Wave A T1/T2, v1.2.61)', () => {
  it('FE·BE 매칭 라우트가 nodeMap에 함께 포함되고, BE 쪽은 r:"pair"로 구분된다', () => {
    const matched = makeFeRoute('/mapmatch', 'MapMatchWidget')
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe',
      nodes: matched.nodes, edges: matched.edges,
    })
    const beRoute = makeBeRoute('/api/mapmatch')
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/be', projectName: 'be', metadata: BE_META,
      nodes: [beRoute], edges: [],
    })
    const remapped: IREdge[] = [makeCrossEdge(matched.comp.id, beRoute.id)]
    const diagrams = buildCombinedDiagram(feGraph, beGraph, remapped)

    const feSid = Object.keys(diagrams.nodeMap ?? {}).find(k => diagrams.nodeMap?.[k]?.n === '/mapmatch')
    const beSid = Object.keys(diagrams.nodeMap ?? {}).find(k => diagrams.nodeMap?.[k]?.n === '/api/mapmatch')
    expect(feSid).toBeDefined()
    expect(beSid).toBeDefined()
    expect(diagrams.nodeMap?.[feSid as string]?.r).toBeUndefined()
    expect(diagrams.nodeMap?.[beSid as string]?.r).toBe('pair')
  })

  it('sanitizeId 충돌 시 FE 엔트리가 BE보다 우선한다', () => {
    // route:app/a.b/page.tsx (FE) vs route:src/a-b (BE) 둘 다 sanitizeId 시 동일 sid로 붕괴하도록 구성.
    const feRoute = createRouteNode({
      id: makeNodeId('route', 'app/dup/page.tsx', 'page'),
      path: '/dup', filePath: 'app/dup/page.tsx', routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: { ...PROV, file: 'app/dup/page.tsx' }, confidence: 'verified',
    })
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe',
      nodes: [feRoute], edges: [],
    })
    // 동일 NodeId 문자열을 BE 쪽에도 강제 부여해 실제 충돌을 재현(sanitizeId는 id 문자열 자체에 적용).
    const beRoute = createRouteNode({
      id: feRoute.id,
      path: '/dup', filePath: 'src/dup', routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: { ...PROV, file: 'src/dup' }, confidence: 'verified',
    })
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/be', projectName: 'be', metadata: BE_META,
      nodes: [beRoute], edges: [],
    })
    const diagrams = buildCombinedDiagram(feGraph, beGraph, [])
    const sid = Object.keys(diagrams.nodeMap ?? {}).find(k => diagrams.nodeMap?.[k]?.f === 'app/dup/page.tsx' || diagrams.nodeMap?.[k]?.f === 'src/dup')
    expect(sid).toBeDefined()
    expect(diagrams.nodeMap?.[sid as string]?.f).toBe('app/dup/page.tsx')
    expect(diagrams.nodeMap?.[sid as string]?.r).toBeUndefined()
  })

  it('sid 충돌인데 BE가 verified·FE가 inferred면 confidence가 FE 우선 규칙을 이긴다 (Evidence-First)', () => {
    const feRoute = createRouteNode({
      id: makeNodeId('route', 'app/dup2/page.tsx', 'page'),
      path: '/dup2', filePath: 'app/dup2/page.tsx', routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: { ...PROV, file: 'app/dup2/page.tsx' },
      confidence: 'inferred', inferenceChain: ['guess'],
    })
    const feGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe',
      nodes: [feRoute], edges: [],
    })
    const beRoute = createRouteNode({
      id: feRoute.id,
      path: '/dup2', filePath: 'src/dup2', routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: { ...PROV, file: 'src/dup2' }, confidence: 'verified',
    })
    const beGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/be', projectName: 'be', metadata: BE_META,
      nodes: [beRoute], edges: [],
    })
    const diagrams = buildCombinedDiagram(feGraph, beGraph, [])
    const sid = Object.keys(diagrams.nodeMap ?? {}).find(k => diagrams.nodeMap?.[k]?.f === 'app/dup2/page.tsx' || diagrams.nodeMap?.[k]?.f === 'src/dup2')
    expect(sid).toBeDefined()
    expect(diagrams.nodeMap?.[sid as string]?.f).toBe('src/dup2')
    expect(diagrams.nodeMap?.[sid as string]?.c).toBe('verified')
    expect(diagrams.nodeMap?.[sid as string]?.r).toBe('pair')
  })
})
