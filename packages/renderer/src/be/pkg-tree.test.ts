import { describe, it, expect } from 'vitest'
import { createRouteNode, makeNodeId, type RouteNode } from '@codebase-viz/types'
import {
  buildPkgTree,
  estimateChunkCost,
  splitTreeByBudget,
  collectSubtreeRoutes,
  collectSubtreeFiles,
  emitTreeNodes,
  type PkgTreeNode,
} from './pkg-tree.js'

// 합성 fileRoutes 생성기 — segments 경로 + 파일명.
function fr(segments: string[], file: string): { filePath: string; segments: string[]; routes: [] } {
  return { filePath: `${segments.join('/')}/${file}`, segments, routes: [] }
}

// 모든 chunk에 담긴 파일 수 합 = 입력 파일 수 (누락/중복 없음) 검증용.
function collectFiles(node: PkgTreeNode): string[] {
  const out: string[] = []
  const walk = (n: PkgTreeNode): void => {
    for (const [, c] of n.children) walk(c)
    for (const f of n.files) out.push(f.filePath)
  }
  walk(node)
  return out
}

describe('BE chunking — node/edge budget 2차 sub-chunk (v1.2.51 B)', () => {
  it('estimateChunkCost: 패키지 노드 + leaf cost 합산', () => {
    // a/b/X.java, a/b/Y.java → 패키지 노드 a,b (각 2) + leaf 2개
    const tree = buildPkgTree([fr(['a', 'b'], 'X.java'), fr(['a', 'b'], 'Y.java')])
    const cost = estimateChunkCost(tree, () => 5)
    // pkg a(2) + pkg b(2) + leaf X(5) + leaf Y(5) = 14
    expect(cost).toBe(14)
  })

  it('예산 이내 subtree → 단일 chunk (분할 안 함, 입력 그대로)', () => {
    const tree = buildPkgTree([fr(['dom'], 'A.java'), fr(['dom'], 'B.java')])
    const sub = tree.children.get('dom')!
    const chunks = splitTreeByBudget(['dom'], sub, 1000, st => estimateChunkCost(st, () => 5))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.pathSegs).toEqual(['dom'])
    expect(collectFiles(chunks[0]!.subtree).sort()).toEqual(['dom/A.java', 'dom/B.java'])
  })

  it('예산 초과 → 서브패키지 단위 다중 chunk 분할 + 파일 누락 0', () => {
    // dom 아래 5개 서브패키지, 각 leaf cost 큼 → 합산이 예산 초과
    const files = ['svc1', 'svc2', 'svc3', 'svc4', 'svc5'].flatMap(s =>
      [fr(['dom', s], `${s}A.java`), fr(['dom', s], `${s}B.java`)],
    )
    const tree = buildPkgTree(files)
    const sub = tree.children.get('dom')!
    const leafCost = (): number => 100
    const total = estimateChunkCost(sub, leafCost)
    const budget = Math.floor(total / 3) // 3~4개 chunk로 쪼개질 예산
    const chunks = splitTreeByBudget(['dom'], sub, budget, st => estimateChunkCost(st, leafCost))

    expect(chunks.length).toBeGreaterThan(1)
    // 각 chunk는 예산 이내 (더 못 쪼개는 단일 leaf 초과 케이스 제외)
    for (const c of chunks) {
      expect(estimateChunkCost(c.subtree, leafCost)).toBeLessThanOrEqual(budget)
    }
    // 전체 파일 누락/중복 0
    const all = chunks.flatMap(c => collectFiles(c.subtree)).sort()
    expect(all).toEqual(files.map(f => f.filePath).sort())
    // 모든 chunk는 dom 경로 유지 (헤더 보존)
    for (const c of chunks) expect(c.pathSegs[0]).toBe('dom')
  })

  it('단일 서브패키지가 홀로 예산 초과 → 그 패키지로 재귀하여 더 깊이 분할', () => {
    // dom/heavy 안에 다수 서브패키지 → heavy 하나가 예산 초과 → heavy 내부로 재귀
    const files = ['p1', 'p2', 'p3', 'p4'].flatMap(p =>
      [fr(['dom', 'heavy', p], `${p}.java`)],
    )
    files.push(fr(['dom', 'light'], 'L.java'))
    const tree = buildPkgTree(files)
    const sub = tree.children.get('dom')!
    const leafCost = (): number => 100
    const chunks = splitTreeByBudget(['dom'], sub, 150, st => estimateChunkCost(st, leafCost))
    // heavy가 재귀 분할되어 dom/heavy 경로의 chunk가 ≥1 존재
    const hasDeepPath = chunks.some(c => c.pathSegs.join('/').startsWith('dom/heavy'))
    expect(hasDeepPath).toBe(true)
    const all = chunks.flatMap(c => collectFiles(c.subtree)).sort()
    expect(all).toEqual(files.map(f => f.filePath).sort())
  })

  it('더 못 쪼개는 leaf-heavy 단일 패키지 초과 → onOverflow 호출 (silent truncation 금지)', () => {
    // children 없이 한 패키지에 무거운 leaf 다수 → 파일 단위로 쪼개되 단일 leaf가 예산 초과면 overflow log
    const files = [fr(['dom'], 'Huge.java')]
    const tree = buildPkgTree(files)
    const sub = tree.children.get('dom')!
    const overflows: Array<{ pathSegs: string[]; cost: number }> = []
    const chunks = splitTreeByBudget(['dom'], sub, 10, st => estimateChunkCost(st, () => 100), (pathSegs, cost) =>
      overflows.push({ pathSegs, cost }),
    )
    // 파일 1개라 더 못 쪼갬 → 그대로 emit + overflow 보고
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(overflows.length).toBeGreaterThanOrEqual(1)
  })
})

// D7(재귀 subtree 수집 비용) — collectSubtreeRoutes/collectSubtreeFiles가 노드마다 하위 전체를
// 매번 새로 순회하면, 깊이 N짜리 선형 체인(패키지가 한 줄로 깊게 중첩되는 실제 Java 패키지 흔한
// 형태: com.company.division.department.team.service.impl...)에서 총 비용이 O(N²)로 폭발한다
// (walk가 모든 깊이의 노드마다 collectSubtreeRoutes를 호출하고, 각 호출이 남은 하위 전부를 재순회).
// 메모이제이션은 각 노드의 결과를 한 번만 계산해 재사용 → O(N)으로 낮춘다.
function routeAt(i: number): RouteNode {
  const filePath = `be/src/main/java/s${i}/Controller${i}.java`
  return createRouteNode({
    id: makeNodeId('route', filePath, 'endpoint'),
    path: `/api/s${i}`,
    filePath,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'unknown',
    provenance: { file: filePath, line: 1, adapter: 'test', analyzerVersion: 'test' },
    confidence: 'verified',
  })
}

// depth 0..N-1의 선형 체인 — fileRoute i는 segments ['s0',...,'si'](i+1단)라 트리는
// root→s0→s1→...→s{N-1}의 완전 직선(각 깊이 노드가 파일 1개 + 자식 1개, 마지막만 자식 0개).
function deepChainFileRoutes(depth: number) {
  return Array.from({ length: depth }, (_, i) => ({
    filePath: `be/src/main/java/${Array.from({ length: i + 1 }, (_, j) => `s${j}`).join('/')}/Controller${i}.java`,
    segments: Array.from({ length: i + 1 }, (_, j) => `s${j}`),
    routes: [routeAt(i)],
  }))
}

describe('collectSubtreeRoutes/collectSubtreeFiles 메모이제이션 (v1.2.63 D7)', () => {
  it('동일 노드를 두 번 호출하면 같은 배열 참조를 반환한다(캐시 히트 증명)', () => {
    const tree = buildPkgTree(deepChainFileRoutes(5))
    const s0 = tree.children.get('s0')!
    const first = collectSubtreeRoutes(s0)
    const second = collectSubtreeRoutes(s0)
    expect(second).toBe(first) // 참조 동일성 — 재계산이 아니라 캐시에서 나온 것
  })

  it('collectSubtreeFiles도 동일 노드 재호출 시 같은 배열 참조를 반환한다', () => {
    const tree = buildPkgTree(deepChainFileRoutes(5))
    const s0 = tree.children.get('s0')!
    expect(collectSubtreeFiles(s0)).toBe(collectSubtreeFiles(s0))
  })

  it('메모이제이션 후에도 결과 내용은 동일하다(회귀 없음)', () => {
    const tree = buildPkgTree(deepChainFileRoutes(4))
    const s0 = tree.children.get('s0')!
    // s0 하위(s0~s3) 전부의 route/file이 실려야 한다 — 캐싱이 부분 결과를 얼리면 안 된다.
    expect(collectSubtreeRoutes(s0).map(r => r.path).sort()).toEqual(
      ['/api/s0', '/api/s1', '/api/s2', '/api/s3'].sort(),
    )
    expect(collectSubtreeFiles(s0)).toHaveLength(4)
  })

  it('깊이 3000 선형 체인에서도 emitTreeNodes가 합리적 시간 내 끝난다(O(N²) 회귀 가드)', () => {
    const DEPTH = 3000
    const tree = buildPkgTree(deepChainFileRoutes(DEPTH))
    const start = performance.now()
    const { lines } = emitTreeNodes(tree, 'BE_ROOT')
    const elapsedMs = performance.now() - start
    expect(lines.length).toBeGreaterThan(DEPTH) // 노드당 최소 1줄(+엣지)
    // 메모이즈 O(N)이면 수십~수백ms, 미메모이즈 O(N²)이면 수 초~수십 초로 자릿수가 다르다 —
    // 느슨한 예산(2초)으로도 회귀를 잡되 CI 머신 편차로 인한 오탐(flaky)은 피한다.
    expect(elapsedMs, `emitTreeNodes(${DEPTH}-deep chain) took ${elapsedMs}ms`).toBeLessThan(2000)
  })
})
