// mapper-utils.ts
// RouteNode/ComponentNode ↔ TableNode 간의 mapperEdge를 생성하는 공통 유틸.
//
// 스펙 노트: 원래 명세에서 kind='db-access'를 제안했으나,
// @codebase-viz/types의 EdgeKind = 'renders'|'calls'|'queries'|'imports' 에는
// 'db-access'가 없다. Route/Component → TableNode 연결의 의미상 정확한 kind는
// 'queries'이므로 이를 사용한다. (Evidence-first 원칙에 따른 타입 우선 적용)

import path from 'node:path'
import {
  createEdge,
  makeEdgeId,
  type IREdge,
  type RouteNode,
  type ComponentNode,
  type TableNode,
} from '@codebase-viz/types'

/**
 * Route/Component filePath에 table.name이 포함되는 경우에만 edge를 생성한다.
 * 휴리스틱: filePath.toLowerCase().includes(table.name.toLowerCase())
 *
 * silence > noise 원칙: 확실하지 않으면 연결하지 않는다.
 * confidence='inferred'로 설정하며, inferenceChain에 근거를 기록한다.
 */
export function buildMapperEdges(
  routes: RouteNode[],
  components: ComponentNode[],
  tables: TableNode[],
  analyzerVersion: string,
): IREdge[] {
  if (tables.length === 0) return []
  if (routes.length === 0 && components.length === 0) return []

  const edges: IREdge[] = []

  for (const table of tables) {
    const tableNameLower = table.name.toLowerCase()

    // Route → Table
    for (const route of routes) {
      const fileBase = path.basename(route.filePath).toLowerCase()
      const dirParts = route.filePath.toLowerCase()

      if (fileBase.includes(tableNameLower) || dirParts.includes(`/${tableNameLower}`)) {
        const edgeId = makeEdgeId('queries', route.id, table.id)
        edges.push(
          createEdge({
            id: edgeId,
            from: route.id,
            to: table.id,
            kind: 'queries',
            provenance: route.provenance,
            confidence: 'inferred',
            inferenceChain: [
              `filename match: table "${table.name}" found in route filePath "${route.filePath}"`,
            ],
          }),
        )
      }
    }

    // Component → Table
    for (const component of components) {
      const fileBase = path.basename(component.filePath).toLowerCase()
      const dirParts = component.filePath.toLowerCase()

      if (fileBase.includes(tableNameLower) || dirParts.includes(`/${tableNameLower}`)) {
        const edgeId = makeEdgeId('queries', component.id, table.id)
        edges.push(
          createEdge({
            id: edgeId,
            from: component.id,
            to: table.id,
            kind: 'queries',
            provenance: component.provenance,
            confidence: 'inferred',
            inferenceChain: [
              `filename match: table "${table.name}" found in component filePath "${component.filePath}"`,
            ],
          }),
        )
      }
    }
  }

  return edges
}
