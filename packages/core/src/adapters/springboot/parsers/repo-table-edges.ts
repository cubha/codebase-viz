import {
  createEdge,
  makeEdgeId,
  type IREdge,
  type TableNode,
} from '@codebase-viz/types'
import type { RepoTableRef } from './mapper-xml-parser.js'

// B2/B3(BE-DIAGRAM-STANDARD v1.2 R-T2.9 amendment): mapper-xml-parser가 Repository 단위로
// 산출한 접근 테이블명(repoTableRefs)을 최종 tableNodes(tablesByName·mergeFlywayTables 2중
// dedup을 거친 이후)에 이름으로 해석해 Repository→table `queries` 엣지를 만든다. statement
// 단위가 아니라 Repository 단위인 이유: statement 노드는 isBeRepository에 안 걸려 Tab3 ERD에
// 신규 프록시 엔티티로 승격되므로 BE 표준 §4("Tab3 변경 없음")를 위반한다(braintrust 판정).
// Repository는 이미 Tab3 sourcesMap에 있어 관계선만 추가된다. 정확 이름 매칭만 — 실패 시 침묵.
export function buildRepoTableEdges(
  repoTableRefs: RepoTableRef[],
  tableNodes: TableNode[],
): IREdge[] {
  if (repoTableRefs.length === 0 || tableNodes.length === 0) return []

  const tableByName = new Map(tableNodes.map(t => [t.name, t]))
  const edges: IREdge[] = []
  const seenEdgeIds = new Set<string>()

  for (const ref of repoTableRefs) {
    for (const tableName of ref.tableNames) {
      const table = tableByName.get(tableName)
      if (table === undefined) continue
      const edgeId = makeEdgeId('queries', ref.repoComponentId, table.id)
      if (seenEdgeIds.has(edgeId)) continue
      seenEdgeIds.add(edgeId)
      edges.push(
        createEdge({
          id: edgeId,
          from: ref.repoComponentId,
          to: table.id,
          kind: 'queries',
          provenance: ref.provenance,
          confidence: 'inferred',
          inferenceChain: [`mybatis: table "${tableName}" in SQL in ${ref.provenance.file}`],
        }),
      )
    }
  }

  return edges
}
