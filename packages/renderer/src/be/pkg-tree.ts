import type { RouteNode } from '@codebase-viz/types'
import { sanitizeId } from '../helpers/ids.js'
import { nodeMapMarker, pickRepresentativeRoute } from '../helpers/node-map.js'

// Path-segment-aware longest common prefix.
// Finds the longest shared URL prefix (up to segment boundaries).
// Single path: strips the last segment (leaf endpoint) to return its parent prefix.
export function pathSegmentLcp(paths: string[]): string {
  if (paths.length === 0) return ''
  const segArrays = paths.map(p => p.split('/').filter(Boolean))
  if (paths.length === 1) {
    const segs = segArrays[0]!
    return segs.length > 1 ? '/' + segs.slice(0, -1).join('/') : ''
  }
  const minLen = Math.min(...segArrays.map(a => a.length))
  let lcpCount = 0
  for (let i = 0; i < minLen; i++) {
    const seg = segArrays[0]![i]!
    if (segArrays.every(a => a[i] === seg)) lcpCount++
    else break
  }
  if (lcpCount === 0) return ''
  return '/' + segArrays[0]!.slice(0, lcpCount).join('/')
}

// 패키지 segments 추출: src/main/{java,kotlin}/ 이후 + 파일명 제외
export function extractPackageSegments(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, '/')
  const javaMatch = normalized.match(/^(?:.*\/)?src\/main\/(?:java|kotlin)\/(.+)$/)
  const after = javaMatch !== null ? (javaMatch[1] ?? normalized) : normalized
  const segments = after.split('/').filter(Boolean)
  if (segments.length > 0) segments.pop()
  return segments
}

export function commonPrefixLen(segArrays: string[][]): number {
  if (segArrays.length === 0) return 0
  const minLen = Math.min(...segArrays.map(a => a.length))
  let i = 0
  for (; i < minLen; i++) {
    const seg = segArrays[0]?.[i]
    if (seg === undefined || !segArrays.every(a => a[i] === seg)) break
  }
  return i
}

export type PkgTreeNode = {
  children: Map<string, PkgTreeNode>
  files: Array<{ filePath: string; routes: RouteNode[] }>
}

// emitTreeNodes의 walk가 트리의 **모든** 노드마다 collectSubtreeRoutes/Files를 호출한다(대표
// 라우트·대표 파일 판정용). 메모이즈 없이 매번 하위 전체를 새로 순회하면, 깊이 N짜리 선형 패키지
// 체인(실제 Java 패키지에 흔한 형태)에서 총 비용이 O(N²)로 폭발한다 — 실측: 3000-깊이 체인
// 18.3초(memoizeSubtree 없이) → 메모이즈 후 이하로 확인(D7). WeakMap은 노드별 결과를 한 번만
// 계산해 재사용하므로 각 노드 O(자기 files+children)만 들어 총합이 O(N)이 된다. 빌드마다
// PkgTreeNode를 새로 만들어(buildPkgTree) 재사용하지 않으므로 WeakMap이 빌드 간 캐시를 들고
// 있을 위험(stale 캐시)도 없다.
const subtreeRoutesCache = new WeakMap<PkgTreeNode, RouteNode[]>()
const subtreeFilesCache = new WeakMap<PkgTreeNode, string[]>()

// export: 메모이제이션이 실제로 캐시 히트하는지(참조 동일성) 직접 검증하려면 테스트가 이 함수를
// 불러야 한다 — private로 감춰두면 emitTreeNodes 간접 호출로는 "결과가 맞다"만 보이고 "두 번째
// 호출이 캐시를 탔다"는 증명 불가.
export function collectSubtreeRoutes(node: PkgTreeNode): RouteNode[] {
  const cached = subtreeRoutesCache.get(node)
  if (cached !== undefined) return cached
  const out: RouteNode[] = []
  for (const f of node.files) out.push(...f.routes)
  for (const child of node.children.values()) out.push(...collectSubtreeRoutes(child))
  subtreeRoutesCache.set(node, out)
  return out
}

export function collectSubtreeFiles(node: PkgTreeNode): string[] {
  const cached = subtreeFilesCache.get(node)
  if (cached !== undefined) return cached
  const out: string[] = node.files.map(f => f.filePath)
  for (const child of node.children.values()) out.push(...collectSubtreeFiles(child))
  subtreeFilesCache.set(node, out)
  return out
}

// BE Tab2는 트리를 `routes: []`로 만든다(라우트가 아니라 컨트롤러를 매단다) — 그 경우 파일 경로가
// 가장 얕은 것(동수면 사전순)을 대표로 잡고 호출부가 준 resolver로 IR 노드 id를 얻는다.
function representativeFileNodeId(
  node: PkgTreeNode,
  resolve: (filePath: string) => string | undefined,
): string | undefined {
  const files = [...new Set(collectSubtreeFiles(node))].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  )
  for (const f of files) {
    const id = resolve(f)
    if (id !== undefined) return id
  }
  return undefined
}

export function buildPkgTree(
  fileRoutes: Array<{ filePath: string; segments: string[]; routes: RouteNode[] }>,
): PkgTreeNode {
  const root: PkgTreeNode = { children: new Map(), files: [] }
  for (const { filePath, segments, routes } of fileRoutes) {
    let cur = root
    for (const seg of segments) {
      let child = cur.children.get(seg)
      if (child === undefined) {
        child = { children: new Map(), files: [] }
        cur.children.set(seg, child)
      }
      cur = child
    }
    cur.files.push({ filePath, routes })
  }
  return root
}

// BE Tab1/Tab2 표준 (graph TD, node+edge tree, R-T1.4 / R-T2.1)
// HDR_PKG를 일반 노드 → subgraph wrapper로 변경. elk.mrtree가 일반 노드 root에서
// children을 cluster 밖으로 배치하는 결함 해소.
export function buildPackageHeaderOpen(lcpSegments: string[]): string[] {
  if (lcpSegments.length === 0) return []
  const label = `📁 src/main/java/${lcpSegments.join('.')}`
  return [`  subgraph HDR_PKG ["${label}"]`, '    direction TB']
}

export function buildPackageHeaderClose(lcpSegments: string[]): string[] {
  if (lcpSegments.length === 0) return []
  return ['  end']
}

export type TreeEmit = {
  lines: string[]
  // pkg path segments joined by '.' → sanitized node id. Used by leaf emitters to wire edges.
  nodeIdByPath: Map<string, string>
}

// 패키지 트리에서 node+edge만 emit. leaf(파일) 노드는 별도 emitter에서 처리하고 wiring만 책임진다.
// rootLabel: 헤더 노드 없이 단일 트리일 때 root segment를 안 그릴 수 있도록 'BE_ROOT' 기본
// clusterRoot=true 시 첫 depth edge 생략. HDR_PKG subgraph wrapper가 자식 트리 외곽선 역할.
export function emitTreeNodes(
  tree: PkgTreeNode,
  rootId: string,
  prefixPath: string[] = [],
  opts: { clusterRoot?: boolean; nodeIdForFile?: (filePath: string) => string | undefined } = {},
): TreeEmit {
  const lines: string[] = []
  const nodeIdByPath = new Map<string, string>()
  const walk = (node: PkgTreeNode, parentId: string, pathSegs: string[], depth: number): void => {
    for (const [seg, child] of node.children) {
      const segs = [...pathSegs, seg]
      const id = `pkg_${sanitizeId(segs.join('__'))}`
      // 패키지 박스도 하위 파일들을 합친 집계 노드다 — 마커가 없으면 BE Tab1/FE Tab2 파일트리에서
      // 폴더 노드가 전부 클릭 불가가 된다(실측: partner-mock Tab1 19개 중 12개가 pkg_*).
      const rep = pickRepresentativeRoute(collectSubtreeRoutes(child))
      const markerTarget = rep !== undefined
        ? rep.id
        : (opts.nodeIdForFile === undefined ? undefined : representativeFileNodeId(child, opts.nodeIdForFile))
      if (markerTarget !== undefined) lines.push(nodeMapMarker('  ', id, markerTarget))
      lines.push(`  ${id}["${seg}"]:::pkg`)
      if (!(opts.clusterRoot === true && depth === 0)) {
        lines.push(`  ${parentId} --> ${id}`)
      }
      nodeIdByPath.set(segs.join('.'), id)
      walk(child, id, segs, depth + 1)
    }
  }
  walk(tree, rootId, prefixPath, 0)
  return { lines, nodeIdByPath }
}

// top-level 패키지(공통 prefix strip 직후 첫 depth) 단위로 chunk 분할.
// R-T1.8 (Tab1) / R-T2.1 (Tab2) chunk gate.
export function chunkByTopLevelPackage(
  tree: PkgTreeNode,
): Array<{ topSeg: string; subtree: PkgTreeNode }> {
  const chunks: Array<{ topSeg: string; subtree: PkgTreeNode }> = []
  for (const [topSeg, subtree] of tree.children) {
    chunks.push({ topSeg, subtree })
  }
  // root에 직접 매달린 파일이 있으면(드물지만 — 공통 prefix가 패키지 leaf인 경우) "(_root)" chunk로 묶음
  if (tree.files.length > 0) {
    const rootOnly: PkgTreeNode = { children: new Map(), files: tree.files }
    chunks.push({ topSeg: '_root', subtree: rootOnly })
  }
  return chunks
}

// ── v1.2.51 B: node/edge-budget 2차 sub-chunk ────────────────────────────────
// top-level 패키지 1단계 chunk만으로는 큰 도메인 1개가 webview cap(maxTextSize 1M /
// maxEdges 2000)을 넘겨 그 도메인만 "Maximum text size in diagram exceeded" 에러를 낸다.
// FE는 이미 splitGroupsByNodeBound(layout.ts)로 청크당 노드 수를 bound하나 BE엔 부재였다.
// 이 splitter는 한 패키지 subtree의 추정 emit 비용이 예산 초과 시 서브패키지 단위로 재귀
// 재분할한다. 각 sub-chunk는 풀 패키지 경로(pathSegs)를 유지해 헤더/계층이 보존된다.
// 별도 mermaid diagram = 독립 ID라 동일 패키지가 형제 chunk로 나뉘어도 노드 ID 충돌 없음.

// 청크당 추정 emit 비용(노드+엣지 근사) 상한. webview maxTextSize 1M(~640 byte/edge 실측,
// 하드월 ≈ 3100 units) / maxEdges 2000 대비 ~50% 헤드룸. 초과 시 서브패키지로 재분할.
export const BE_CHUNK_COST_BUDGET = 1500

export type BudgetChunk = { pathSegs: string[]; subtree: PkgTreeNode }

// subtree를 emit할 때 발생하는 노드+엣지 수의 근사치.
// - 패키지 노드 1개당 2(노드 정의 + 부모 edge) — chunk 루트의 첫 depth는 cluster라 edge 생략되나
//   보수적으로 2로 계산(예산 헤드룸 안전 측).
// - leaf(파일=Controller)는 leafCostOf로 위임 — Tab2는 DI 체인 노드+엣지, Tab1은 상수.
export function estimateChunkCost(
  node: PkgTreeNode,
  leafCostOf: (filePath: string) => number,
): number {
  let cost = 0
  const walk = (n: PkgTreeNode): void => {
    for (const [, child] of n.children) {
      cost += 2
      walk(child)
    }
    for (const f of n.files) cost += leafCostOf(f.filePath)
  }
  walk(node)
  return cost
}

// 무거운 leaf 다수를 가진(더 못 쪼개는) 단일 패키지의 파일들을 예산 단위 subset으로 packing.
function splitFilesByBudget(
  files: PkgTreeNode['files'],
  budget: number,
  leafCostOf: (filePath: string) => number,
  onOverflow?: (cost: number) => void,
): PkgTreeNode['files'][] {
  const result: PkgTreeNode['files'][] = []
  let bucket: PkgTreeNode['files'] = []
  let bucketCost = 0
  const flush = (): void => {
    if (bucket.length > 0) { result.push(bucket); bucket = []; bucketCost = 0 }
  }
  for (const f of files) {
    const c = leafCostOf(f.filePath)
    if (c > budget) {
      // 단일 leaf가 홀로 예산 초과 — 더 쪼갤 수 없음. 그대로 emit + overflow 보고(silent 금지).
      flush()
      result.push([f])
      onOverflow?.(c)
      continue
    }
    if (bucketCost + c > budget) flush()
    bucket.push(f)
    bucketCost += c
  }
  flush()
  return result.length > 0 ? result : [[]]
}

// 한 패키지 subtree를 각 chunk 비용 ≤ budget이 되도록 재귀 분할. FE splitGroupsByNodeBound 대칭.
// - 전체 비용 ≤ budget → 단일 chunk (입력 그대로, 회귀 안전).
// - 초과 시: 직속 파일 + 형제 서브패키지를 예산 단위 bucket으로 greedy packing.
//   홀로 예산 초과하는 서브패키지는 그 패키지로 재귀(pathSegs 확장).
//   children 없이 파일만 초과하면 파일 단위로 분할(last resort).
// - 더 못 쪼개는 단일 leaf 초과는 onOverflow로 보고(no silent truncation).
export function splitTreeByBudget(
  pathSegs: string[],
  subtree: PkgTreeNode,
  budget: number,
  costOf: (st: PkgTreeNode) => number,
  onOverflow?: (pathSegs: string[], cost: number) => void,
): BudgetChunk[] {
  const total = costOf(subtree)
  if (total <= budget) return [{ pathSegs, subtree }]

  const leafCostOf = (fp: string): number => costOf({ children: new Map(), files: [{ filePath: fp, routes: [] }] })

  const result: BudgetChunk[] = []
  let bucketChildren = new Map<string, PkgTreeNode>()
  let bucketFiles: PkgTreeNode['files'] = []
  let bucketCost = 0
  const flush = (): void => {
    if (bucketChildren.size > 0 || bucketFiles.length > 0) {
      result.push({ pathSegs, subtree: { children: bucketChildren, files: bucketFiles } })
      bucketChildren = new Map()
      bucketFiles = []
      bucketCost = 0
    }
  }

  // 1) 직속 파일(이 레벨의 leaf)
  if (subtree.files.length > 0) {
    const filesCost = costOf({ children: new Map(), files: subtree.files })
    if (filesCost > budget) {
      flush()
      for (const fs of splitFilesByBudget(subtree.files, budget, leafCostOf, cost => onOverflow?.(pathSegs, cost))) {
        result.push({ pathSegs, subtree: { children: new Map(), files: fs } })
      }
    } else {
      bucketFiles = [...subtree.files]
      bucketCost += filesCost
    }
  }

  // 2) 서브패키지 — greedy packing, 초과 패키지는 재귀
  for (const [seg, child] of subtree.children) {
    const childCost = costOf({ children: new Map([[seg, child]]), files: [] })
    if (childCost > budget) {
      flush()
      result.push(...splitTreeByBudget([...pathSegs, seg], child, budget, costOf, onOverflow))
    } else {
      if (bucketCost + childCost > budget) flush()
      bucketChildren.set(seg, child)
      bucketCost += childCost
    }
  }
  flush()
  return result
}
