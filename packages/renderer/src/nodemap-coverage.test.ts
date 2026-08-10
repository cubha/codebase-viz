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
} from '@codebase-viz/types'
import { buildDiagrams } from './mermaid-renderer.js'
import { shouldChunk, CHUNK_SEPARATOR } from './_shared/wrap-fallback.js'

// v1.2.61 회귀 방지 — 이 스펙이 존재하는 이유:
// T1(딥링크)·T2(hover)는 Playwright로 검증됐지만, 그 하니스는 손으로 쓴 `graph TD\n sid["..."]`
// 였다. 실제 빌더가 emit하는 접두사 id(`leaf_`/`file_`/`pageleaf_`)와 Tab1의 합성 id(`T1_*`)는
// 한 번도 태워보지 않았고, 그래서 "전 노드 클릭 무반응"이 GREEN 상태로 배포됐다.
// 여기서는 **실제 buildDiagrams 출력**의 선언 id를 nodeMap과 대조한다.

const PROV = { file: '', line: 1, adapter: 'nextjs', analyzerVersion: 'test' }

function route(urlPath: string, filePath: string): RouteNode {
  return createRouteNode({
    id: makeNodeId('route', filePath, 'page'),
    path: urlPath,
    filePath,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    provenance: { ...PROV, file: filePath },
    confidence: 'verified',
  })
}

function component(name: string, filePath: string) {
  return createComponentNode({
    id: makeNodeId('component', filePath, name),
    name,
    filePath,
    runtime: 'server',
    provenance: { ...PROV, file: filePath },
    confidence: 'verified',
  })
}

function sampleGraph(): IRGraph {
  const routes = [
    route('/', 'app/page.tsx'),
    route('/blog', 'app/blog/page.tsx'),
    route('/blog/archive', 'app/blog/archive/page.tsx'),
    route('/admin/users', 'app/admin/users/page.tsx'),
    route('/admin/settings', 'app/admin/settings/page.tsx'),
  ]
  const comps = [component('Header', 'components/Header.tsx'), component('Sidebar', 'components/Sidebar.tsx')]
  const edges = routes.slice(0, 2).map((r, i) =>
    createEdge({
      id: makeEdgeId('renders', r.id, comps[i]!.id),
      from: r.id,
      to: comps[i]!.id,
      kind: 'renders',
      provenance: PROV,
      confidence: 'verified',
    }),
  )
  return createIRGraph({ analyzerVersion: 'test', repoRoot: '/repo', nodes: [...routes, ...comps], edges })
}

// `id["label"]` / `id("label")` 형태의 선언만 뽑는다(라벨 내용은 제외).
function declaredIds(text: string): string[] {
  const out = new Set<string>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('%%') || line.startsWith('subgraph')) continue
    const m = /^([A-Za-z0-9_]+)\s*[[({]/.exec(line)
    if (m) out.add(m[1]!)
  }
  return [...out]
}

describe('nodeMap 커버리지 — 실제 buildDiagrams 출력 기준 (v1.2.61 딥링크 사각지대 회귀 방지)', () => {
  const diagrams = buildDiagrams(sampleGraph())
  const nodeMap = diagrams.nodeMap ?? {}

  it('Tab1 합성 폴더 박스(T1_*)가 nodeMap에 실린다 — 기본 탭 딥링크 생존 조건', () => {
    const t1Ids = declaredIds(diagrams.rendering).filter(id => id.startsWith('T1_'))
    expect(t1Ids.length).toBeGreaterThan(0)
    const mapped = t1Ids.filter(id => nodeMap[id] !== undefined)
    expect(mapped).toEqual(t1Ids)
  })

  it('Tab1 폴더 박스는 대표 라우트의 실제 소스 파일을 가리킨다', () => {
    const t1Ids = declaredIds(diagrams.rendering).filter(id => id.startsWith('T1_'))
    for (const id of t1Ids) {
      const entry = nodeMap[id]
      expect(entry, id).toBeDefined()
      expect(entry!.f, id).toMatch(/\.tsx$/)
      expect(entry!.l, id).toBeGreaterThan(0)
    }
  })

  it('Tab2의 route/component 유래 선언 id는 접두사가 붙어도 전부 nodeMap에 실린다', () => {
    const ids = declaredIds(diagrams.screenComponent)
      .filter(id => /(?:^|_)(?:route|component)_/.test(id))
    expect(ids.length).toBeGreaterThan(0)
    const missing = ids.filter(id => nodeMap[id] === undefined)
    expect(missing).toEqual([])
  })

  it('nodeMap 엔트리는 전부 provenance(file/line)와 confidence를 갖는다 — Evidence-First', () => {
    const entries = Object.entries(nodeMap)
    expect(entries.length).toBeGreaterThan(0)
    for (const [id, e] of entries) {
      expect(e.f, id).toBeTruthy()
      expect(typeof e.l, id).toBe('number')
      expect(['verified', 'inferred', 'manual']).toContain(e.c)
    }
  })

  it('emit된 다이어그램 텍스트에 nodeMap 마커가 남지 않는다(CLI .md·스냅샷 오염 방지)', () => {
    const all = diagrams.rendering + diagrams.screenComponent + diagrams.dbScreen
    expect(all).not.toContain('%% nodemap:')
  })
})

// react-router FE Tab3(buildFeApiCallDiagram) — endpoint 박스(`ep_*`)는 graph.nodes에 없는 합성
// 노드라 v1.2.62까지 nodeMap에서 전량 빠져 클릭 무반응이었다(D5). v1.2.63에서 엣지 기반 마커로 해소.
function feApiCallGraph(): IRGraph {
  const routeA = createRouteNode({
    id: makeNodeId('route', 'app/dash/page.tsx', 'page'),
    path: '/dash', filePath: 'app/dash/page.tsx', routeFileKind: 'page',
    dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'CSR',
    provenance: { ...PROV, file: 'app/dash/page.tsx' }, confidence: 'verified',
  })
  const comp = createComponentNode({
    id: makeNodeId('component', 'components/Dash.tsx', 'Dash'),
    name: 'Dash', filePath: 'components/Dash.tsx', runtime: 'client',
    provenance: { ...PROV, file: 'components/Dash.tsx' }, confidence: 'verified',
  })
  const renders = createEdge({
    id: makeEdgeId('renders', routeA.id, comp.id), from: routeA.id, to: comp.id,
    kind: 'renders', provenance: PROV, confidence: 'verified',
  })
  const endpointId = makeNodeId('endpoint', 'virtual', 'GET:/api/dash')
  const apiCall = createEdge({
    id: makeEdgeId('api-call', comp.id, endpointId), from: comp.id, to: endpointId,
    kind: 'api-call', apiCall: { method: 'GET', path: '/api/dash', library: 'axios' },
    provenance: { file: 'components/Dash.tsx', line: 9, adapter: 'test', analyzerVersion: 'test' },
    confidence: 'verified',
  })
  return createIRGraph({
    analyzerVersion: 'test', repoRoot: '/repo',
    metadata: { framework: 'react-router', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false },
    nodes: [routeA, comp], edges: [renders, apiCall],
  })
}

describe('nodeMap 커버리지 — FE Tab3 endpoint 박스(ep_*, v1.2.63 D5)', () => {
  const diagrams = buildDiagrams(feApiCallGraph())
  const nodeMap = diagrams.nodeMap ?? {}

  it('ep_* endpoint 박스가 전부 nodeMap에 실린다', () => {
    const epIds = declaredIds(diagrams.dbScreen).filter(id => id.startsWith('ep_'))
    expect(epIds.length).toBeGreaterThan(0)
    const missing = epIds.filter(id => nodeMap[id] === undefined)
    expect(missing).toEqual([])
  })

  it('ep_* 엔트리는 호출 지점(file:line) provenance를 갖는다 — Evidence-First', () => {
    const epIds = declaredIds(diagrams.dbScreen).filter(id => id.startsWith('ep_'))
    for (const id of epIds) {
      const entry = nodeMap[id]
      expect(entry, id).toBeDefined()
      expect(entry!.f).toBe('components/Dash.tsx')
      expect(entry!.l).toBe(9)
      expect(entry!.c).toBe('verified')
    }
  })

  it('ep_* 마커는 렌더 텍스트에 남지 않는다(CLI .md 오염 방지)', () => {
    expect(diagrams.dbScreen).not.toContain('%% nodemap:')
  })
})

// BE(springboot) 경로 — 패키지 트리 박스(`pkg_*`)는 FE Tab1의 `T1_*`와 같은 집계 노드 클래스다.
// v1.2.62 1차 수정에서 여기만 빠져 partner-mock 실측 Tab1 19개 중 12개가 클릭 불가였다.
function beGraph(): IRGraph {
  const files = [
    'src/main/java/com/example/partner/matMgmt/controller/DecoSheetController.java',
    'src/main/java/com/example/partner/ordMgmt/controller/OrderController.java',
    'src/main/java/com/example/agency/userMgmt/controller/UserController.java',
  ]
  const nodes = [
    createRouteNode({
      id: makeNodeId('route', files[0]!, '/api/deco:GET'), path: '/api/deco', filePath: files[0]!,
      routeFileKind: 'page', dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      httpMethod: 'GET', provenance: { ...PROV, file: files[0]! }, confidence: 'verified',
    }),
    createRouteNode({
      id: makeNodeId('route', files[1]!, '/api/order:GET'), path: '/api/order', filePath: files[1]!,
      routeFileKind: 'page', dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      httpMethod: 'GET', provenance: { ...PROV, file: files[1]! }, confidence: 'verified',
    }),
    createRouteNode({
      id: makeNodeId('route', files[2]!, '/api/user:GET'), path: '/api/user', filePath: files[2]!,
      routeFileKind: 'page', dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      httpMethod: 'GET', provenance: { ...PROV, file: files[2]! }, confidence: 'verified',
    }),
  ]
  const comps = files.map(f => component(f.split('/').pop()!.replace('.java', ''), f))
  return createIRGraph({
    analyzerVersion: 'test', repoRoot: '/be', projectName: 'be',
    metadata: {
      framework: 'springboot', adapterCategory: 'BE',
      hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false,
    },
    nodes: [...nodes, ...comps], edges: [],
  })
}

describe('nodeMap 커버리지 — BE 패키지 트리 박스(pkg_*)', () => {
  const diagrams = buildDiagrams(beGraph())
  const nodeMap = diagrams.nodeMap ?? {}

  it('BE Tab1의 pkg_* 패키지 박스가 전부 nodeMap에 실린다', () => {
    const ids = declaredIds(diagrams.rendering).filter(id => id.startsWith('pkg_'))
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.filter(id => nodeMap[id] === undefined)).toEqual([])
  })

  it('BE Tab2의 pkg_* 박스는 라우트가 없어도 대표 컨트롤러로 매핑된다', () => {
    const ids = declaredIds(diagrams.screenComponent).filter(id => id.startsWith('pkg_'))
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.filter(id => nodeMap[id] === undefined)).toEqual([])
  })

  it('BE leaf 컨트롤러 노드도 매핑된다', () => {
    const ids = declaredIds(diagrams.rendering).filter(id => id.startsWith('leaf_'))
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.filter(id => nodeMap[id] === undefined)).toEqual([])
  })
})

// 위 두 describe는 전부 기본 임계(5MB / 300노드)라 **비청킹 분기만** 태운다. 실제로 커버리지가
// 문제되는 대형 리포는 전부 청킹 경로를 타는데, 그 경로는 chunkByGroups가 그래프를 슬라이스해
// 빌더를 여러 번 호출하고 joinChunks로 합친다 — 마커가 청크마다 살아남아야 매핑이 성립한다.
// 임계를 낮춰 강제 청킹시킨 뒤 동일 커버리지를 요구한다(v1.2.61 사각지대와 같은 부류의 구멍).
const FORCE_CHUNK = { chunkThreshold: 500, nodeThreshold: 5 }

describe('nodeMap 커버리지 — 청킹 경로(비청킹만 재던 사각지대)', () => {
  const be = buildDiagrams(beGraph(), FORCE_CHUNK)
  const fe = buildDiagrams(sampleGraph(), FORCE_CHUNK)

  it('임계를 낮추면 실제로 청킹이 발생한다(전제 확인)', () => {
    // 이 단언이 깨지면 아래 두 케이스는 비청킹을 재는 것이라 무의미해진다.
    expect(be.screenComponent).toContain(CHUNK_SEPARATOR)
    expect(fe.screenComponent).toContain(CHUNK_SEPARATOR)
  })

  it('청킹된 BE 산출물에서도 pkg_*·leaf_* 박스가 전부 nodeMap에 실린다', () => {
    const nodeMap = be.nodeMap ?? {}
    const ids = [...declaredIds(be.rendering), ...declaredIds(be.screenComponent)]
      .filter(id => id.startsWith('pkg_') || id.startsWith('leaf_'))
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.filter(id => nodeMap[id] === undefined)).toEqual([])
  })

  it('청킹된 FE Tab2에서도 접두사 선언 id가 전부 nodeMap에 실린다', () => {
    const nodeMap = fe.nodeMap ?? {}
    const ids = declaredIds(fe.screenComponent).filter(id => /(?:^|_)(?:route|component)_/.test(id))
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.filter(id => nodeMap[id] === undefined)).toEqual([])
  })

  it('청킹 경로에서도 마커가 렌더 텍스트에 남지 않는다', () => {
    const all = be.rendering + be.screenComponent + fe.rendering + fe.screenComponent
    expect(all).not.toContain('%% nodemap:')
  })
})

// 마커는 webview가 보지 않는 텍스트다 — 청킹 임계 판정이 그걸 세면 사용자가 안 보는 바이트 때문에
// 레이아웃(row-mode)이 켜진다. 실측 최대 Δ는 임계의 0.16%라 현재는 반전이 안 나지만, 결합 자체를
// 없애 마커가 늘어도 안전하게 둔다.
describe('청킹 임계는 마커를 제외한 렌더 텍스트 길이로 판정한다', () => {
  it('마커만으로는 임계를 넘지 않는다', () => {
    const body = 'graph TD\n  A["a"]\n'
    const markers = Array.from({ length: 200 }, (_, i) => `  %% nodemap:pkg_${i}=route:src/very/long/path/to/Controller${i}.java:/api/x`).join('\n')
    const withMarkers = body + markers
    const threshold = body.length + 10 // 본문은 임계 이하, 마커까지 세면 초과
    expect(withMarkers.length).toBeGreaterThan(threshold)
    expect(shouldChunk(withMarkers, threshold)).toBe(false)
  })

  it('마커를 뺀 본문이 임계를 넘으면 정상적으로 청킹한다', () => {
    const body = 'graph TD\n' + Array.from({ length: 50 }, (_, i) => `  N${i}["node ${i}"]`).join('\n')
    expect(shouldChunk(body, 100)).toBe(true)
  })
})
