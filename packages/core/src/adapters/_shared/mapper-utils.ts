import path from 'node:path'
import {
  createEdge,
  makeEdgeId,
  readOrmClassName,
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

// Prisma는 v1.2.67까지 모델명을 테이블명으로 썼고, 파일명도 코드가 부르는 모델명을 따른다. `@@map`으로
// 테이블명이 DB 이름으로 바뀐 뒤에도 그 매칭이 끊기지 않게 모델명(센티넬)을 키로 보존한다.
// 다른 ORM(JPA·Django 등)은 원래 테이블명으로만 매칭했으므로 클래스명 키를 새로 열지 않는다 —
// 엣지를 늘리는 동작 변경이라 Less is More 관점의 별도 판단 대상이다.
function fileMatchKeys(table: TableNode): string[] {
  const keys = [table.name.toLowerCase()]
  if (!table.provenance.adapter.startsWith('prisma-parser')) return keys
  const model = readOrmClassName(table)?.toLowerCase()
  if (model !== undefined && model !== keys[0]) keys.push(model)
  return keys
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
    const matchKeys = fileMatchKeys(table)

    // Route → Table (basename 토큰 경계 매칭만 — dirParts 경로 전체 포함 제거)
    for (const route of routes) {
      const fileBase = path.basename(route.filePath, path.extname(route.filePath)).toLowerCase()
      if (!matchKeys.some(key => tokenMatch(fileBase, key))) continue
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
      if (!matchKeys.some(key => tokenMatch(fileBase, key))) continue
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
