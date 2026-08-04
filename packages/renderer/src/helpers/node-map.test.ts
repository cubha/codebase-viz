import { describe, it, expect } from 'vitest'
import {
  createIRGraph,
  createRouteNode,
  createComponentNode,
  makeNodeId,
  type IRGraph,
} from '@codebase-viz/types'
import { sanitizeId } from './ids.js'
import { buildNodeMap, mergeNodeMaps } from './node-map.js'

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
