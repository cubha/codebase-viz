import type { IRGraph, IREdge, TableNode, NodeId } from '@codebase-viz/types'
import { isTableNode } from '@codebase-viz/types'

// C4(BE-DIAGRAM-STANDARD v1.2 — K4): Tab1 leaf 옆에 "이 컨트롤러가 어떤 테이블을 건드리는지"
// 뱃지로 보여준다. 신규 IR 없음 — buildMapperEdges가 이미 만든 Route/Component→Table `queries`
// 엣지를 재사용하고, DI 체인(`calls`, 깊이 가드 6 — Tab2 R-T2.2와 동일 상수)을 따라가며 도달
// 가능한 컴포넌트의 queries까지 모은다. Tab3 ER은 변경하지 않는 별도 view(K4 결정).
export function collectReachableTables(graph: IRGraph, seedIds: NodeId[]): TableNode[] {
  const tableById = new Map<string, TableNode>()
  for (const n of graph.nodes) if (isTableNode(n)) tableById.set(n.id, n)
  if (tableById.size === 0) return []

  const callsByFrom = new Map<string, IREdge[]>()
  const queriesByFrom = new Map<string, IREdge[]>()
  for (const e of graph.edges) {
    if (e.kind === 'calls') {
      const list = callsByFrom.get(e.from) ?? []
      list.push(e)
      callsByFrom.set(e.from, list)
    }
    if (e.kind === 'queries') {
      const list = queriesByFrom.get(e.from) ?? []
      list.push(e)
      queriesByFrom.set(e.from, list)
    }
  }

  const found = new Map<string, TableNode>()
  const visited = new Set<string>()
  const walk = (nodeId: string, depth: number): void => {
    if (depth > 6 || visited.has(nodeId)) return
    visited.add(nodeId)
    for (const qe of queriesByFrom.get(nodeId) ?? []) {
      const table = tableById.get(qe.to)
      if (table !== undefined) found.set(table.id, table)
    }
    for (const ce of callsByFrom.get(nodeId) ?? []) walk(ce.to, depth + 1)
  }
  for (const seed of seedIds) walk(seed, 0)

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}
