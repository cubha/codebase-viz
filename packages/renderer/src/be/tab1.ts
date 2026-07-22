import type { IRGraph, RouteNode, NodeId } from '@codebase-viz/types'
import { isRouteNode, isComponentNode } from '@codebase-viz/types'
import { BE_RENDERING_INIT, CLASS_DEFS } from '../helpers/constants.js'
import { joinChunks } from '../_shared/wrap-fallback.js'
import {
  extractPackageSegments,
  commonPrefixLen,
  type PkgTreeNode,
  buildPkgTree,
  buildPackageHeaderOpen,
  buildPackageHeaderClose,
  emitTreeNodes,
  chunkByTopLevelPackage,
  estimateChunkCost,
  splitTreeByBudget,
  BE_CHUNK_COST_BUDGET,
  type BudgetChunk,
} from './pkg-tree.js'
import { emitControllerFileLeaf } from './leaf.js'
import { collectReachableTables } from './table-cluster.js'

export function buildBeRenderingDiagram(graph: IRGraph): string {
  const routeNodes = graph.nodes.filter(isRouteNode)
  if (routeNodes.length === 0) return 'graph TD\n  empty["(no endpoints found)"]'

  // C4(K4): leaf 옆 테이블 뱃지용 — 파일당 첫 컴포넌트(보통 Controller 자신)를 DI 체인 시드로.
  const componentIdByFilePath = new Map<string, NodeId>()
  for (const n of graph.nodes) {
    if (isComponentNode(n) && !componentIdByFilePath.has(n.filePath)) componentIdByFilePath.set(n.filePath, n.id)
  }

  const byFile = new Map<string, RouteNode[]>()
  for (const r of routeNodes) {
    const existing = byFile.get(r.filePath) ?? []
    existing.push(r)
    byFile.set(r.filePath, existing)
  }

  const fileRoutes = [...byFile.entries()].map(([filePath, routes]) => ({
    filePath,
    segments: extractPackageSegments(filePath),
    routes,
  }))

  const lcpLen = commonPrefixLen(fileRoutes.map(f => f.segments))
  const trimController = fileRoutes.every(f => {
    const last = f.segments[f.segments.length - 1]
    return f.segments.length > lcpLen && last !== undefined && /^controllers?$/i.test(last)
  })
  const lcpSegments = fileRoutes[0]?.segments.slice(0, lcpLen) ?? []
  const trimmed = fileRoutes.map(f => ({
    ...f,
    segments: f.segments.slice(lcpLen, trimController ? -1 : undefined),
  }))

  const emitChunk = (chunkTree: PkgTreeNode, headerSegs: string[]): string[] => {
    // HDR_PKG subgraph wrapper + dagre layout. v1.2.40 ELK mrtree pragma 제거 —
    // mrtree가 cluster wrapper 내부에서 top-level pkg 노드를 floating root로 인식하여 좌상단 모서리에 박는 결함 야기.
    // invisible link `~~~` 폴백도 실패. dagre fallback 시각 검증으로 cluster 정렬 정상 동작 확인.
    // BE_RENDERING_INIT 사용 — flowchart.nodeSpacing/rankSpacing 축소로 DI 체인 간격 조밀.
    const lines: string[] = [BE_RENDERING_INIT, 'graph TD', CLASS_DEFS]
    const hdrOpen = buildPackageHeaderOpen(headerSegs)
    const isCluster = hdrOpen.length > 0
    lines.push(...hdrOpen)
    const rootId = isCluster ? 'HDR_PKG' : 'BE_ANCHOR'
    if (!isCluster) lines.push(`  ${rootId}["(root)"]:::hdr`)
    const treeEmit = emitTreeNodes(chunkTree, rootId, [], { clusterRoot: isCluster })
    lines.push(...treeEmit.lines)
    // Leaf 파일: 부모 패키지 노드에 leaf controller 연결.
    const walkFiles = (node: PkgTreeNode, parentId: string, pathSegs: string[], depth: number): void => {
      for (const [seg, child] of node.children) {
        const segs = [...pathSegs, seg]
        const pkgId = treeEmit.nodeIdByPath.get(segs.join('.')) ?? parentId
        walkFiles(child, pkgId, segs, depth + 1)
      }
      for (const f of node.files) {
        const seedIds = f.routes.map(r => r.id)
        const compId = componentIdByFilePath.get(f.filePath)
        if (compId !== undefined) seedIds.push(compId)
        const tableNames = collectReachableTables(graph, seedIds).map(t => t.name)
        const { leafId, lines: leafLines } = emitControllerFileLeaf('  ', f.filePath, f.routes, tableNames)
        lines.push(...leafLines)
        if (!(isCluster && depth === 0)) {
          lines.push(`  ${parentId} --> ${leafId}`)
        }
      }
    }
    walkFiles(chunkTree, rootId, [], 0)
    lines.push(...buildPackageHeaderClose(headerSegs))
    return lines
  }

  const tree = buildPkgTree(trimmed)

  // v1.2.57: endpoint collapse(R-T1.6 amendment)로 endpoints subgraph 폐기 → leaf 파일 cost는
  // route 수와 무관한 상수 2(leaf 노드 1 + 부모 edge 1). endpoint는 노드/엣지가 아닌 노드 내부 텍스트라
  // dagre 레이아웃 비용에 기여하지 않음.
  const leafCost = (_filePath: string): number => 2
  const costOf = (st: PkgTreeNode): number => estimateChunkCost(st, leafCost)

  const topChunks = chunkByTopLevelPackage(tree)
  const singleWhole = topChunks.length <= 1
  // 회귀 안전: 예산 초과 chunk가 없으면 기존 경로 그대로(byte-identical).
  const overBudget = singleWhole
    ? costOf(tree) > BE_CHUNK_COST_BUDGET
    : topChunks.some(c => costOf(c.subtree) > BE_CHUNK_COST_BUDGET)

  if (!overBudget) {
    if (singleWhole) {
      return emitChunk(tree, lcpSegments).join('\n')
    }
    // 각 chunk header = LCP + topSeg. 트리는 topSeg children부터 시작 (R-T1.2 + R-T1.8: 중복 노드 제거)
    const parts = topChunks.map(({ topSeg, subtree }) => {
      const headerSegs = topSeg === '_root' ? lcpSegments : [...lcpSegments, topSeg]
      return emitChunk(subtree, headerSegs).join('\n')
    })
    return joinChunks(parts)
  }

  // 큰 도메인 1개가 cap 초과 → node/edge-budget 2차 sub-chunk.
  const budgetChunks: BudgetChunk[] = []
  for (const { topSeg, subtree } of topChunks) {
    const pathSegs = topSeg === '_root' ? [] : [topSeg]
    budgetChunks.push(...splitTreeByBudget(pathSegs, subtree, BE_CHUNK_COST_BUDGET, costOf, (segs, cost) => {
      console.warn(`[codebase-viz] BE Tab1: 패키지 ${[...lcpSegments, ...segs].join('.')} 가 단일 leaf로 예산 초과(cost≈${cost} > ${BE_CHUNK_COST_BUDGET}) — 더 분할 불가, 그대로 emit`)
    }))
  }
  const parts = budgetChunks.map(c => emitChunk(c.subtree, [...lcpSegments, ...c.pathSegs]).join('\n'))
  return joinChunks(parts)
}
