import type { IRGraph, IREdge, RouteNode, ComponentNode } from '@codebase-viz/types'
import { isRouteNode, isComponentNode } from '@codebase-viz/types'
import type { NestedGroup } from '../url-grouper.js'
import { groupRoutesByUrl } from '../url-grouper.js'
import { sanitizeId, modeClass } from '../helpers/ids.js'
import { RENDERING_INIT, CLASS_DEFS } from '../helpers/constants.js'
import { nodeMapMarker, entryConfidenceRank } from '../helpers/node-map.js'
import { groupSubgraphId, sectionLabel } from './labels.js'

// 읽기 전용 lookup 묶음. T1 lookup table·T4 시퀀스 신규 빌더는 본 ctx에 필드 추가만으로 주입 가능.
export interface ApiCallCtx {
  routeToComp: Map<string, string>
  compById: Map<string, ComponentNode>
  compToApiCalls: Map<string, IREdge[]>
  repEdgeByEndpointId: Map<string, IREdge>
}

// endpoint 박스(ep_*)는 graph.nodes에 없는 합성 노드라 nodeMap 마커는 IR 노드가 아닌 엣지를
// 가리켜야 한다(node-map.ts toEntryFromEdge). 같은 endpoint를 여러 컴포넌트가 호출하면
// route-tree 순회 순서에 따라 먼저 emit되는 쪽이 마커 대상이 되던 first-wins는 Evidence-First
// 위반(inferred 호출이 verified보다 먼저 순회되면 inferred가 대표가 됨) — emit 전에 endpoint별
// 대표 엣지를 순서 무관하게 사전 선정한다. 규칙은 pickRepresentativeRoute와 동일(verified 우선,
// 동순위는 id 사전순).
function pickRepresentativeApiCallEdges(edges: readonly IREdge[]): Map<string, IREdge> {
  const byEndpoint = new Map<string, IREdge>()
  for (const edge of edges) {
    if (edge.apiCall === undefined) continue
    const endpointId = `ep_${sanitizeId(`${edge.apiCall.method}_${edge.apiCall.path}`)}`
    const existing = byEndpoint.get(endpointId)
    if (existing === undefined) {
      byEndpoint.set(endpointId, edge)
      continue
    }
    const rank = entryConfidenceRank(edge.confidence)
    const existingRank = entryConfidenceRank(existing.confidence)
    if (rank < existingRank || (rank === existingRank && edge.id < existing.id)) {
      byEndpoint.set(endpointId, edge)
    }
  }
  return byEndpoint
}

// React Router Tab3 = Route별 API 호출 다이어그램.
// - 도메인 subgraph (Tab1·Tab2와 일관)
// - 각 라우트 leaf → rendersEdge로 매핑된 Page Component → api-call edges
// - API endpoint 노드는 method+path를 라벨로 합성 (graph.nodes에 미등록, edge.to NodeId로만 식별)
// - library별 클래스 차등 (axios/fetch/react-query)
export function buildFeApiCallDiagram(graph: IRGraph): string {
  const routeNodes = graph.nodes.filter(isRouteNode).filter(r => r.routeFileKind === 'page')
  const componentNodes = graph.nodes.filter(isComponentNode)
  const rendersEdges = graph.edges.filter(e => e.kind === 'renders')
  const apiCallEdges = graph.edges.filter(e => e.kind === 'api-call')

  if (routeNodes.length === 0) return 'graph TD\n  empty["(no routes found)"]'
  if (apiCallEdges.length === 0) return 'graph TD\n  empty["(no API calls detected)"]'

  const compById = new Map(componentNodes.map(c => [c.id, c]))
  const routeToComp = new Map<string, string>()
  for (const e of rendersEdges) {
    if (!routeToComp.has(e.from)) routeToComp.set(e.from, e.to)
  }
  const compToApiCalls = new Map<string, typeof apiCallEdges>()
  for (const e of apiCallEdges) {
    const list = compToApiCalls.get(e.from) ?? []
    list.push(e)
    compToApiCalls.set(e.from, list)
  }
  const repEdgeByEndpointId = pickRepresentativeApiCallEdges(apiCallEdges)
  const ctx: ApiCallCtx = { routeToComp, compById, compToApiCalls, repEdgeByEndpointId }

  const lines: string[] = [RENDERING_INIT, 'graph LR', CLASS_DEFS]
  lines.push('  classDef apiAxios fill:#1a0d1a,stroke:#a855f7,color:#e9d5ff')
  lines.push('  classDef apiFetch fill:#0d1a1a,stroke:#06b6d4,color:#a5f3fc')
  lines.push('  classDef apiQuery fill:#1a0d0d,stroke:#f43f5e,color:#fecdd3')
  const edgeLines: string[] = []
  const endpointEmitted = new Set<string>()

  const routeGroups = groupRoutesByUrl(routeNodes)
  emitFeApiCallTreeLines(routeGroups, '  ', ctx, lines, edgeLines, endpointEmitted)
  lines.push(...edgeLines)
  return lines.join('\n')
}

export function emitFeApiCallTreeLines(
  groups: NestedGroup[],
  indent: string,
  ctx: ApiCallCtx,
  lines: string[],
  edges: string[],
  endpointEmitted: Set<string>,
): void {
  const i2 = indent + '  '
  for (const group of groups) {
    const leafSeg = group.groupKey.split('/').filter(Boolean).pop()
    if (leafSeg === undefined) {
      for (const r of group.routes) {
        emitRouteApiCalls(r, indent, ctx, lines, edges, endpointEmitted)
      }
      if (group.children.length > 0) {
        emitFeApiCallTreeLines(group.children, indent, ctx, lines, edges, endpointEmitted)
      }
      continue
    }
    const sgId = groupSubgraphId(group.groupKey).replace(/_G$/, '_API')
    lines.push(`${indent}subgraph ${sgId}["${sectionLabel(leafSeg)}"]`)
    for (const r of group.routes) {
      emitRouteApiCalls(r, i2, ctx, lines, edges, endpointEmitted)
    }
    if (group.children.length > 0) {
      emitFeApiCallTreeLines(group.children, i2, ctx, lines, edges, endpointEmitted)
    }
    lines.push(`${indent}end`)
  }
}

export function emitRouteApiCalls(
  r: RouteNode,
  indent: string,
  ctx: ApiCallCtx,
  lines: string[],
  edges: string[],
  endpointEmitted: Set<string>,
): void {
  const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
  const displayPath = r.path.split('/').filter(Boolean).pop() ?? r.path
  lines.push(`${indent}${sanitizeId(r.id)}["${displayPath} · ${badge}"]:::${modeClass(r.renderingMode)}`)

  const compId = ctx.routeToComp.get(r.id)
  if (compId === undefined) return
  const calls = ctx.compToApiCalls.get(compId) ?? []
  for (const call of calls) {
    if (call.apiCall === undefined) continue
    const { method, path: apiPath, library } = call.apiCall
    const endpointId = `ep_${sanitizeId(`${method}_${apiPath}`)}`
    if (!endpointEmitted.has(endpointId)) {
      endpointEmitted.add(endpointId)
      // 라벨(화면 표시)도 마커(딥링크 타겟)와 같은 대표 엣지를 써야 한다 — 각자 다른 호출을
      // 기준으로 삼으면 화면엔 inferred 근거(⟿ fetch)가 보이는데 클릭하면 verified 호출의
      // file:line(다른 컴포넌트)로 점프하는 라벨-마커 불일치가 생긴다(scope-critic 지적).
      // method/path는 endpointId 구성 요소라 call과 repEdge가 항상 같지만, library·confidence
      // (화살표 스타일)는 다를 수 있으므로 repEdge 기준으로 통일한다.
      const repEdge = ctx.repEdgeByEndpointId.get(endpointId)
      if (repEdge !== undefined) lines.push(nodeMapMarker(indent, endpointId, repEdge.id))
      const repLibrary = repEdge?.apiCall?.library ?? library
      const repConfidence = repEdge?.confidence ?? call.confidence
      const cls = repLibrary === 'fetch' ? 'apiFetch' : repLibrary === 'react-query' ? 'apiQuery' : 'apiAxios'
      const arrow = repConfidence === 'inferred' ? '⟿' : '→'
      lines.push(`${indent}${endpointId}["${method} ${apiPath} ${arrow} ${repLibrary}"]:::${cls}`)
    }
    const edgeArrowChar = call.confidence === 'inferred' ? '-.->' : '-->'
    edges.push(`  ${sanitizeId(r.id)} ${edgeArrowChar} ${endpointId}`)
  }
}
