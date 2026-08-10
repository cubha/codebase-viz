import { describe, it, expect } from 'vitest'
import {
  createIRGraph,
  createRouteNode,
  createComponentNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type IRGraph,
} from '@codebase-viz/types'
import { sanitizeId } from './ids.js'
import { buildNodeMap, mergeNodeMaps, stripNodeMapMarkers, nodeMapMarker } from './node-map.js'

const PROV = { file: 'src/app/blog/page.tsx', line: 12, adapter: 'test@0.1', analyzerVersion: 'test' }

function graphOf(nodes: IRGraph['nodes']): IRGraph {
  return createIRGraph({ analyzerVersion: 'test', repoRoot: '/repo', nodes, edges: [] })
}

describe('buildNodeMap', () => {
  it('emit된 텍스트에 등장하는 verified 라우트 노드를 f/l/c/n으로 매핑한다', () => {
    const route = createRouteNode({
      id: makeNodeId('route', 'app/blog/page.tsx', 'page'),
      path: '/blog',
      filePath: 'app/blog/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'SSR',
      provenance: PROV,
      confidence: 'verified',
    })
    const sid = sanitizeId(route.id)
    const map = buildNodeMap(graphOf([route]), [`flowchart TD\n  ${sid}["blog"]`])
    expect(map[sid]).toEqual({ f: 'src/app/blog/page.tsx', l: 12, c: 'verified', n: '/blog' })
  })

  it('inferred 컴포넌트 노드는 inferenceChain[0]을 i로 포함한다', () => {
    const comp = createComponentNode({
      id: makeNodeId('component', 'src/components/Widget.tsx', 'Widget'),
      name: 'Widget',
      filePath: 'src/components/Widget.tsx',
      runtime: 'client',
      provenance: PROV,
      confidence: 'inferred',
      inferenceChain: ['heuristic: default export named Widget'],
    })
    const sid = sanitizeId(comp.id)
    const map = buildNodeMap(graphOf([comp]), [`  ${sid}["Widget"]`])
    expect(map[sid]).toEqual({
      f: 'src/app/blog/page.tsx', l: 12, c: 'inferred', n: 'Widget',
      i: 'heuristic: default export named Widget',
    })
  })

  it('emit된 텍스트에 없는 노드는 결과에서 제외된다(페이로드 상한)', () => {
    const route = createRouteNode({
      id: makeNodeId('route', 'app/unused/page.tsx', 'page'),
      path: '/unused',
      filePath: 'app/unused/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'SSR',
      provenance: PROV,
      confidence: 'verified',
    })
    const map = buildNodeMap(graphOf([route]), ['flowchart TD\n  other_node["x"]'])
    expect(map).toEqual({})
  })

  it('sanitizeId 충돌 시 verified가 inferred보다 우선한다', () => {
    const verifiedNode = createRouteNode({
      id: makeNodeId('route', 'app/a.b/page.tsx', 'page'),
      path: '/a.b', filePath: 'app/a.b/page.tsx', routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: { ...PROV, file: 'app/a.b/page.tsx', line: 1 }, confidence: 'verified',
    })
    const inferredNode = createRouteNode({
      id: makeNodeId('route', 'app/a-b/page.tsx', 'page'),
      path: '/a-b', filePath: 'app/a-b/page.tsx', routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: { ...PROV, file: 'app/a-b/page.tsx', line: 2 },
      confidence: 'inferred', inferenceChain: ['guess'],
    })
    expect(sanitizeId(verifiedNode.id)).toBe(sanitizeId(inferredNode.id))
    const sid = sanitizeId(verifiedNode.id)
    const map = buildNodeMap(graphOf([inferredNode, verifiedNode]), [`  ${sid}["x"]`])
    expect(map[sid]?.c).toBe('verified')
    expect(map[sid]?.f).toBe('app/a.b/page.tsx')
  })

  it('동일 confidence 충돌 시 node.id 사전순으로 결정론적 선택한다', () => {
    const nodeA = createRouteNode({
      id: makeNodeId('route', 'app/a.b/page.tsx', 'page'),
      path: '/a.b', filePath: 'app/a.b/page.tsx', routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: { ...PROV, file: 'app/a.b/page.tsx' }, confidence: 'verified',
    })
    const nodeB = createRouteNode({
      id: makeNodeId('route', 'app/a-b/page.tsx', 'page'),
      path: '/a-b', filePath: 'app/a-b/page.tsx', routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: { ...PROV, file: 'app/a-b/page.tsx' }, confidence: 'verified',
    })
    const sid = sanitizeId(nodeA.id)
    expect(sid).toBe(sanitizeId(nodeB.id))
    const expectedWinner = nodeA.id < nodeB.id ? nodeA : nodeB
    const map = buildNodeMap(graphOf([nodeB, nodeA]), [`  ${sid}["x"]`])
    expect(map[sid]?.f).toBe(expectedWinner.provenance.file)
  })

  it('opts.root === "pair"이면 r:"pair"를 부여한다', () => {
    const route = createRouteNode({
      id: makeNodeId('route', 'app/blog/page.tsx', 'page'),
      path: '/blog', filePath: 'app/blog/page.tsx', routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: PROV, confidence: 'verified',
    })
    const sid = sanitizeId(route.id)
    const map = buildNodeMap(graphOf([route]), [`  ${sid}["blog"]`], { root: 'pair' })
    expect(map[sid]?.r).toBe('pair')
  })

  it('빈 그래프·빈 emittedTexts는 빈 맵을 반환한다', () => {
    expect(buildNodeMap(graphOf([]), ['flowchart TD'])).toEqual({})
    const route = createRouteNode({
      id: makeNodeId('route', 'app/blog/page.tsx', 'page'),
      path: '/blog', filePath: 'app/blog/page.tsx', routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: PROV, confidence: 'verified',
    })
    expect(buildNodeMap(graphOf([route]), [])).toEqual({})
  })
})

describe('mergeNodeMaps', () => {
  it('충돌 없으면 양쪽 엔트리를 모두 보존한다', () => {
    const merged = mergeNodeMaps(
      { a: { f: 'fe.tsx', l: 1, c: 'verified' } },
      { b: { f: 'be.java', l: 2, c: 'verified' } },
    )
    expect(merged).toEqual({
      a: { f: 'fe.tsx', l: 1, c: 'verified' },
      b: { f: 'be.java', l: 2, c: 'verified' },
    })
  })

  it('동일 confidence 충돌 시 preferred(1번 인자)가 이긴다', () => {
    const merged = mergeNodeMaps(
      { x: { f: 'fe.tsx', l: 1, c: 'verified' } },
      { x: { f: 'be.java', l: 2, c: 'verified' } },
    )
    expect(merged.x?.f).toBe('fe.tsx')
  })

  it('confidence 불일치 충돌 시 preferred가 inferred라도 other의 verified가 이긴다 (Evidence-First)', () => {
    const merged = mergeNodeMaps(
      { x: { f: 'fe.tsx', l: 1, c: 'inferred', i: 'guess' } },
      { x: { f: 'be.java', l: 2, c: 'verified' } },
    )
    expect(merged.x?.f).toBe('be.java')
    expect(merged.x?.c).toBe('verified')
  })
})

describe('buildNodeMap — 접두사 id / 라벨 노이즈 / 마커 (v1.2.62 결함 수정)', () => {
  function route(pathStr: string, filePath: string) {
    return createRouteNode({
      id: makeNodeId('route', filePath, 'page'),
      path: pathStr, filePath, routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: { ...PROV, file: filePath }, confidence: 'verified',
    })
  }

  // v1.2.61 결함의 핵심: 빌더들이 `leaf_`/`file_`/`pageleaf_`/`di_x__` 접두사를 붙여 emit하는데
  // nodeMap 키는 bare sid라 전량 탈락 → 딥링크·hover가 통째로 죽었다.
  it('접두사가 붙은 선언 id도 해석해 nodeMap에 싣는다', () => {
    const r = route('/blog', 'app/blog/page.tsx')
    const sid = sanitizeId(r.id)
    for (const declId of [`leaf_${sid}`, `file_${sid}`, `pageleaf_${sid}`, `di_ctrl__${sid}`]) {
      const map = buildNodeMap(graphOf([r]), [`flowchart TD\n  ${declId}["blog"]`])
      expect(map[declId], declId).toMatchObject({ f: 'app/blog/page.tsx', n: '/blog' })
    }
  })

  it('짧은 suffix가 먼저 걸려 엉뚱한 노드로 매핑되지 않는다(최장 suffix 우선)', () => {
    const long = route('/blog', 'app/blog/page.tsx')
    const short = route('/page', 'page.tsx')
    const longSid = sanitizeId(long.id)
    const map = buildNodeMap(graphOf([short, long]), [`flowchart TD\n  file_${longSid}["x"]`])
    expect(map[`file_${longSid}`]?.f).toBe('app/blog/page.tsx')
  })

  it('라벨(따옴표 내부) 단어는 노드 id 후보에서 제외된다', () => {
    const r = route('/blog', 'app/blog/page.tsx')
    const sid = sanitizeId(r.id)
    // 라벨 안에 sid를 그대로 써도 선언은 다른 id다 — 라벨 텍스트로 nodeMap이 오염되면 안 된다.
    const map = buildNodeMap(graphOf([r]), [`flowchart TD\n  OTHER["${sid} label"]`])
    expect(map[sid]).toBeUndefined()
    expect(map.OTHER).toBeUndefined()
  })

  it('%% nodemap: 마커는 합성 id를 명시한 IR 노드로 매핑하고 suffix 역해석보다 우선한다', () => {
    const r = route('/blog/list', 'app/blog/list/page.tsx')
    const map = buildNodeMap(graphOf([r]), [`flowchart TD\n  %% nodemap:T1_blog=${r.id}\n  T1_blog["📁 /blog · 3 routes"]`])
    expect(map.T1_blog).toMatchObject({ f: 'app/blog/list/page.tsx', n: '/blog/list' })
  })

  it('마커가 가리키는 IR 노드가 그래프에 없으면 조용히 무시한다', () => {
    const r = route('/blog', 'app/blog/page.tsx')
    const map = buildNodeMap(graphOf([r]), ['flowchart TD\n  %% nodemap:T1_ghost=route:missing.tsx:/ghost\n  T1_ghost["ghost"]'])
    expect(map.T1_ghost).toBeUndefined()
  })

  it('stripNodeMapMarkers는 마커 라인만 제거하고 나머지는 보존한다', () => {
    const src = 'flowchart TD\n  %% nodemap:A=route:x.tsx:/a\n  A["a"]\n  %% 일반 주석\n  B["b"]'
    expect(stripNodeMapMarkers(src)).toBe('flowchart TD\n  A["a"]\n  %% 일반 주석\n  B["b"]')
  })
})

// 위협모델: 분석 대상 리포의 파일 경로·라우트 경로는 신뢰 불가 입력이다. IR 노드 id는 그 값들로
// 조립되므로, 마커에 원문을 그대로 실으면 개행 하나로 마커가 여러 물리 라인으로 쪼개지고
// strip은 첫 줄만 지워 나머지가 생 mermaid 소스로 남는다(실측: `EVIL_NODE["pwned"]`가 노드 선언이 됨).
describe('nodeMapMarker — 신뢰 불가 IR id 주입 차단', () => {
  const EVIL = 'route:app/evil\nEVIL_NODE["pwned"]\n/page.tsx:page'

  it('마커는 개행을 포함한 id를 받아도 항상 단일 라인이다', () => {
    const line = nodeMapMarker('  ', 'T1_evil', EVIL)
    expect(line.split('\n')).toHaveLength(1)
    expect(line).not.toContain('EVIL_NODE["pwned"]')
  })

  it('stripNodeMapMarkers가 마커를 잔재 없이 제거한다(주입 라인이 남지 않는다)', () => {
    const text = ['graph TD', nodeMapMarker('  ', 'T1_evil', EVIL), '  T1_evil["/evil"]'].join('\n')
    const stripped = stripNodeMapMarkers(text)
    expect(stripped).not.toContain('EVIL_NODE')
    expect(stripped).not.toContain('%% nodemap:')
    expect(stripped).toContain('T1_evil["/evil"]')
  })

  it('마커가 IR 노드가 아닌 엣지 id를 가리키면 엣지의 provenance/confidence로 매핑한다 (v1.2.63 D5)', () => {
    // FE Tab3 ep_* endpoint 박스는 graph.nodes에 등록되지 않은 합성 노드라 IR 노드 마커로는
    // 표현 불가 — api-call 엣지(fetch/axios 호출 지점 file:line)를 가리키는 마커가 필요하다.
    const compId = makeNodeId('component', 'src/components/Widget.tsx', 'Widget')
    const endpointId = makeNodeId('endpoint', 'virtual', 'GET:/api/x')
    const edge = createEdge({
      id: makeEdgeId('api-call', compId, endpointId),
      from: compId,
      to: endpointId,
      kind: 'api-call',
      apiCall: { method: 'GET', path: '/api/x', library: 'axios' },
      provenance: { file: 'src/components/Widget.tsx', line: 42, adapter: 'test@0.1', analyzerVersion: 'test' },
      confidence: 'verified',
    })
    const graph = createIRGraph({ analyzerVersion: 'test', repoRoot: '/repo', nodes: [], edges: [edge] })
    const text = `flowchart LR\n  %% nodemap:ep_x=${edge.id}\n  ep_x["GET /api/x"]`
    const map = buildNodeMap(graph, [text])
    expect(map.ep_x).toEqual({ f: 'src/components/Widget.tsx', l: 42, c: 'verified', n: 'GET /api/x' })
  })

  it('인코딩된 마커도 정상 왕복해 nodeMap에 실린다', () => {
    const weird = createRouteNode({
      id: makeNodeId('route', 'app/(marketing)/[slug] x/page.tsx', 'page'),
      path: '/x', filePath: 'app/(marketing)/[slug] x/page.tsx', routeFileKind: 'page',
      dynamicSegmentType: 'static', isGroupRoute: false, renderingMode: 'SSR',
      provenance: { ...PROV, file: 'app/(marketing)/[slug] x/page.tsx' }, confidence: 'verified',
    })
    const text = ['graph TD', nodeMapMarker('  ', 'T1_x', weird.id), '  T1_x["x"]'].join('\n')
    const map = buildNodeMap(graphOf([weird]), [text])
    expect(map.T1_x).toMatchObject({ f: 'app/(marketing)/[slug] x/page.tsx', n: '/x' })
  })
})
