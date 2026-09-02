import type { IRGraph, IRNode } from '@codebase-viz/types'
import { isTableNode, isRouteNode, isComponentNode, readOrmClassName } from '@codebase-viz/types'
import { sanitizeId } from '../helpers/ids.js'
import { DB_DIAGRAM_INIT } from '../helpers/constants.js'
import { metadataToInfra } from '../fe/infra.js'
import { buildFeApiCallDiagram } from '../fe/tab3-api.js'
import { isBeRepository } from '../be/leaf.js'

// - group route `(marketing)` · 동적 route `[slug]` 등 URL≠파일경로 케이스에서 가치 큼
// - LLM enabled에서도 ComponentNode.filePath 정적 기반이라 동일 동작
export function getSourceLabel(node: IRNode): string | undefined {
  if (isRouteNode(node)) {
    const clean = node.path.replace(/\//g, '_').replace(/^_/, '') || 'root'
    return sanitizeId(clean)
  }
  if (isComponentNode(node)) return sanitizeId(node.name)
  return undefined
}

// Tab3 렌더 종류 판정. webview(viewer.html)가 dbScreen 텍스트를 erDiagram 파서로 재해석할지
// 원문 그대로 렌더할지 결정하는 데도 쓰인다(DiagramSet.tab3Kind) — buildDbScreenDiagram의 분기와
// 어긋나면 webview가 다시 침묵 실패하므로(D0) 판정 로직을 이 함수 하나로 단일화한다.
//   1. BE 어댑터 → 현행 ER + Repository 합성
//   2. react-router FE + tables===0 → 신규 FE API 호출 다이어그램 (axios/fetch/react-query) = 'flow'
//   3. 그 외(Next.js+Supabase·Vite·Nuxt·SvelteKit·Vue SPA 등 FE+tables>0) → 현행 ER 다이어그램 = 'erd'
export function resolveTab3Kind(graph: IRGraph): 'erd' | 'flow' {
  const tableNodes = graph.nodes.filter(isTableNode)
  if (graph.metadata?.adapterCategory !== 'BE' && tableNodes.length === 0) {
    const infra = metadataToInfra(graph.metadata)
    if (infra.hasReactRouter) return 'flow'
  }
  return 'erd'
}

// T5: 클래스명 배지를 실을 가치가 있는지 판정한다.
// 문자열 완전일치만 거르면 `users ⌗ User`·`posts ⌗ Post` 같은 **무정보 배지가 대부분의 행에** 붙는다
// (fixture 실측: @Entity 36개 중 규칙으로 유도 불가능한 것은 9개뿐, 나머지 27개는 대소문자·복수형·
// snake_case 변환으로 서로 유도된다). Less is More의 "Noise is worse than silence"가 정확히 이 경우다.
// 그래서 대소문자·`_`·후행 복수 `s`를 정규화해 같아지면 싣지 않는다 — `DecoSheet↔TB_HODS401`,
// `CuttingPlan↔TWO_MOLD_CUTING_NRM`처럼 **실제로 못 알아보는 매핑만** 남는다.
// 클래스 개념이 없는 스택(supabase·flyway·mybatis 등)은 애초에 센티넬이 없어 여기 오기 전에 걸러진다.
export function isInformativeOrmClass(ormClass: string | undefined, tableName: string): boolean {
  if (ormClass === undefined || ormClass === '') return false
  const norm = (v: string): string => v.toLowerCase().replace(/_/g, '').replace(/s$/, '')
  return norm(ormClass) !== norm(tableName)
}

export function buildDbScreenDiagram(graph: IRGraph): string {
  const tableNodes = graph.nodes.filter(isTableNode)

  if (resolveTab3Kind(graph) === 'flow') {
    return buildFeApiCallDiagram(graph)
  }

  const queriesEdges = graph.edges.filter(e => e.kind === 'queries')

  // Deduplicate query sources (routes + components that actually query tables)
  const sourcesMap = new Map<string, string>()
  for (const edge of queriesEdges) {
    if (sourcesMap.has(edge.from)) continue
    const src = graph.nodes.find(n => n.id === edge.from)
    if (src === undefined || isTableNode(src)) continue
    const label = getSourceLabel(src)
    if (label !== undefined) sourcesMap.set(edge.from, label)
  }

  const lines: string[] = [DB_DIAGRAM_INIT, 'erDiagram']

  for (const t of tableNodes) {
    const file = t.provenance.file
    if (file !== undefined && file !== '') {
      const ormClass = readOrmClassName(t)
      const classField = isInformativeOrmClass(ormClass, t.name) ? ` class:${sanitizeId(ormClass!)}` : ''
      lines.push(`%% table:${sanitizeId(t.name)} path:${file}${classField}`)
    }
  }

  for (const t of tableNodes) {
    lines.push(`  ${sanitizeId(t.name)} {`)
    for (const col of t.columns) {
      const pkFlag = col.isPrimaryKey === true ? ' PK' : ''
      const fkFlag = col.references !== undefined ? ' FK' : ''
      lines.push(`    ${sanitizeId(col.type)} ${sanitizeId(col.name)}${pkFlag}${fkFlag}`)
    }
    lines.push('  }')
  }

  // BE-specific: include Repository/Dao/Mapper components even without queries edges.
  // Ensures Tab3 tracks the same Repository nodes as Tab2 (cross-tab traceability).
  if (graph.metadata?.adapterCategory === 'BE') {
    for (const node of graph.nodes) {
      if (!isComponentNode(node)) continue
      if (!isBeRepository(node.name)) continue
      if (!sourcesMap.has(node.id)) sourcesMap.set(node.id, sanitizeId(node.name))
    }
  }

  // Source (route/component/action) proxy entities
  for (const label of new Set(sourcesMap.values())) {
    lines.push(`  ${label} {`)
    lines.push(`    string name`)
    lines.push('  }')
  }

  // Table ↔ Table FK relationships (from ColumnDef.references)
  const tableNameSet = new Set(tableNodes.map(t => sanitizeId(t.name)))
  for (const t of tableNodes) {
    for (const col of t.columns) {
      if (col.references === undefined) continue
      const target = sanitizeId(col.references.table)
      if (tableNameSet.has(target)) {
        lines.push(`  ${sanitizeId(t.name)} }o--|| ${target} : "${col.name}"`)
      }
    }
  }

  // Source → Table queries edges
  for (const edge of queriesEdges) {
    const srcLabel = sourcesMap.get(edge.from)
    const tblNode = graph.nodes.find(n => n.id === edge.to)
    if (srcLabel === undefined || tblNode === undefined || !isTableNode(tblNode)) continue
    lines.push(`  ${srcLabel} }|--|| ${sanitizeId(tblNode.name)} : "queries"`)
  }

  return lines.join('\n')
}
