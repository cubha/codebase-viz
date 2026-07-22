import path from 'node:path'
import {
  createEdge,
  makeEdgeId,
  type IREdge,
  type RouteNode,
  type ComponentNode,
  type TableNode,
} from '@codebase-viz/types'

// basename(파일명, 확장자 제거)에서 tableName 토큰 경계 매칭.
// "superusers"가 "users" 테이블에 우연 매칭되는 false positive 방지 (silence > noise).
function tokenMatch(fileBase: string, tableName: string): boolean {
  if (fileBase === tableName) return true
  // PascalCase / snake_case / kebab-case 정규화: 구분자 제거 후 비교
  // 예: 'user-profile' vs 'userprofile' (UserProfile 테이블 lowercase), 'user_profile' vs 'userprofile'
  const strippedFile = fileBase.replace(/[-_.]/g, '')
  const strippedTable = tableName.replace(/[-_.]/g, '')
  if (strippedFile === tableName || strippedFile === strippedTable) return true
  // 토큰 경계: 앞뒤가 단어 구분자(-, _, ., 문자열 시작/끝)인 경우만 매칭
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:^|[-_.])${escaped}(?:[-_.]|$)`)
  return re.test(fileBase)
}

export function buildMapperEdges(
  routes: RouteNode[],
  components: ComponentNode[],
  tables: TableNode[],
  _analyzerVersion: string,
): IREdge[] {
  if (tables.length === 0) return []
  if (routes.length === 0 && components.length === 0) return []

  const edges: IREdge[] = []

  for (const table of tables) {
    const tableNameLower = table.name.toLowerCase()

    // Route → Table (basename 토큰 경계 매칭만 — dirParts 경로 전체 포함 제거)
    for (const route of routes) {
      const fileBase = path.basename(route.filePath, path.extname(route.filePath)).toLowerCase()
      if (!tokenMatch(fileBase, tableNameLower)) continue
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
            `filename match: table "${table.name}" found in route basename "${path.basename(route.filePath)}"`,
          ],
        }),
      )
    }

    // Component → Table (basename 토큰 경계 매칭만)
    for (const component of components) {
      const fileBase = path.basename(component.filePath, path.extname(component.filePath)).toLowerCase()
      if (!tokenMatch(fileBase, tableNameLower)) continue
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
            `filename match: table "${table.name}" found in component basename "${path.basename(component.filePath)}"`,
          ],
        }),
      )
    }
  }

  return edges
}
