import type { RouteNode } from '@codebase-viz/types'
import type { NestedGroup } from '../url-grouper.js'

const NODES_PER_INNER_ROW = 5

// section/group nested subgraph 한 row 내 최대 group 수. 초과 시 invisible row wrapper로 줄넘김.
export const GROUPS_PER_ROW = 5

// routes < N 이면 chunked path를 발동시키지 않음.
// 작은 프로젝트(28 routes / 7 top-level)도 group 수가 GROUPS_PER_ROW(5)를 넘기면
// chunked → viewer row-mode Y축 단조 나열되는 문제 회피. mermaid는 100+ nodes nested
// subgraph도 단일 다이어그램으로 충분히 처리 가능. 200+ routes stress test(modules=10)는
// routeCount > 100으로 게이트 통과 → chunked 유지하여 회귀 방지.
export const SINGLE_DIAGRAM_ROUTE_THRESHOLD = 100

export function collectNestedRoutes(groups: NestedGroup[]): RouteNode[] {
  const result: RouteNode[] = []
  for (const g of groups) {
    result.push(...g.routes)
    if (g.children.length > 0) result.push(...collectNestedRoutes(g.children))
  }
  return result
}

export function emitInnerRowSubgraphs(
  indent: string,
  outerId: string,
  itemCount: number,
  emitItem: (i: number, ind: string) => string,
): string[] {
  if (itemCount <= NODES_PER_INNER_ROW) {
    const out: string[] = []
    for (let i = 0; i < itemCount; i++) out.push(emitItem(i, indent))
    return out
  }
  const lines: string[] = []
  const i2 = indent + '  '
  let row = 0
  for (let i = 0; i < itemCount; i += NODES_PER_INNER_ROW) {
    const rowId = `${outerId}_R${row}`
    lines.push(`${indent}subgraph ${rowId} [" "]`)
    lines.push(`${i2}direction LR`)
    const end = Math.min(i + NODES_PER_INNER_ROW, itemCount)
    for (let j = i; j < end; j++) lines.push(emitItem(j, i2))
    lines.push(`${indent}end`)
    lines.push(`${indent}style ${rowId} fill:none,stroke:none`)
    row++
  }
  return lines
}

// Descend past single-child transit nodes (e.g. /api → /api/v1) to the first real branching level.
// Stops if the single node has its own routes (to avoid silently dropping them).
export function findBranchingGroups(groups: NestedGroup[]): NestedGroup[] {
  if (groups.length !== 1) return groups
  const [single] = groups
  if (single === undefined || single.children.length === 0 || single.routes.length > 0) return groups
  return findBranchingGroups(single.children)
}

export function chunkGroups<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

// chunked 경로(Tab1/Tab2)에서 한 청크(= 하나의 mermaid 다이어그램)에 담을 최대 라우트 수.
// webview는 mermaid.render()를 메인 스레드 동기 dagre 레이아웃으로 실행하므로,
// 청크당 노드 수가 무바운드면 단일 거대 다이어그램이 스레드를 점유해 freeze된다(v1.2.49 B).
export const CHUNK_ROUTE_BUDGET = 50

// 브랜치 그룹들을 "청크당 라우트 수 ≤ maxRoutes" 단위로 분할한다.
// - 작은 브랜치는 연속으로 패킹(한 다이어그램에 여러 형제 섹션).
// - 단일 브랜치가 budget을 초과하면 그 자식 단위로 재귀 분할(각 sub-chunk가 독립 다이어그램).
//   자식의 groupKey는 full path라 nested subgraph 라벨/계층이 그대로 보존된다.
// - 자식 없는 leaf가 budget을 초과하면 더 쪼갤 수 없으므로 그대로 emit(드문 케이스).
export function splitGroupsByNodeBound(groups: NestedGroup[], maxRoutes: number): NestedGroup[][] {
  const result: NestedGroup[][] = []
  let bucket: NestedGroup[] = []
  let bucketCount = 0
  const flush = (): void => {
    if (bucket.length > 0) {
      result.push(bucket)
      bucket = []
      bucketCount = 0
    }
  }
  for (const g of groups) {
    const size = collectNestedRoutes([g]).length
    if (size <= maxRoutes) {
      if (bucketCount + size > maxRoutes) flush()
      bucket.push(g)
      bucketCount += size
    } else {
      flush()
      if (g.children.length > 0) {
        for (const sub of splitGroupsByNodeBound(g.children, maxRoutes)) result.push(sub)
        if (g.routes.length > 0) result.push([{ ...g, children: [] }])
      } else {
        result.push([g])
      }
    }
  }
  flush()
  return result
}
