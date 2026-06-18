import type { IREdge, ComponentNode, RouteNode } from '@codebase-viz/types'
import type { NestedGroup } from '../url-grouper.js'
import { sanitizeId, modeClass } from '../helpers/ids.js'
import { FE_TREE_INIT, CLASS_DEFS } from '../helpers/constants.js'
import { groupSubgraphId, sectionLabel } from './labels.js'

// 읽기 전용 lookup 묶음. T1 lookup table·T4 시퀀스 신규 빌더는 본 ctx에 필드 추가만으로 주입 가능.
export interface FileTreeCtx {
  compById: Map<string, ComponentNode>
  rendersEdges: IREdge[]
  importsEdges: IREdge[]
}

function formatFileLeafLabel(filePath: string): string {
  const parts = filePath.split('/')
  const fileName = parts.pop() ?? filePath
  const dir = parts.join('/')
  return dir.length > 0 ? `📂 ${dir}<br/>📄 ${fileName}` : `📄 ${fileName}`
}

export function buildFeFileTreeScreenDiagram(
  routeGroups: NestedGroup[],
  rendersEdges: IREdge[],
  importsEdges: IREdge[],
  componentNodes: ComponentNode[],
): string {
  const compById = new Map(componentNodes.map(c => [c.id, c]))
  const ctx: FileTreeCtx = { compById, rendersEdges, importsEdges }
  const lines: string[] = [FE_TREE_INIT, 'graph LR', CLASS_DEFS]
  const edges: string[] = []
  const fileNodeRendered = new Set<string>()

  emitFeFileTreeLines(routeGroups, '  ', ctx, lines, edges, fileNodeRendered)

  // Tab2 top-level ~~~ chain — leaf composite node ID 또는 subgraph ID 혼합 가능.
  const topIds = collectChildIds(routeGroups, compById, rendersEdges)
  if (topIds.length >= 2) lines.push(`  ${topIds.join(' ~~~ ')}`)

  lines.push(...edges)
  return lines.join('\n')
}

// leaf cluster(children=0 + routes=1) + 매칭 file_leaf 있으면 subgraph 대신
// 단일 합성 노드(route 라벨 + 파일경로) emit. subgraph가 사라져 mermaid v11 외부 edge direction
// inheritance 문제(규칙 B 위반) 자동 회피. sibling은 노드 ~~~ chain로 X축 강제(규칙 A 만족).
export function tryComposeLeafGroup(
  group: NestedGroup,
  compById: Map<string, ComponentNode>,
  rendersEdges: IREdge[],
): { id: string; line: string; comp: ComponentNode; route: RouteNode } | undefined {
  if (group.children.length !== 0) return undefined
  if (group.routes.length !== 1) return undefined
  const r = group.routes[0]!
  const edge = rendersEdges.find(e => e.from === r.id)
  if (edge === undefined) return undefined
  const comp = compById.get(edge.to)
  if (comp === undefined) return undefined
  const id = `leaf_${sanitizeId(r.id)}`
  const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
  const displayPath = r.path.split('/').filter(Boolean).pop() ?? r.path
  const fileLabel = formatFileLeafLabel(comp.filePath)
  const line = `["${displayPath} · ${badge}<br/>${fileLabel}"]:::${modeClass(r.renderingMode)}`
  return { id, line: `${id}${line}`, comp, route: r }
}

// 부모 cluster의 children chain용 ID 수집. leaf composite은 노드 ID, 그 외는 subgraph ID.
export function collectChildIds(
  children: NestedGroup[],
  compById: Map<string, ComponentNode>,
  rendersEdges: IREdge[],
): string[] {
  const ids: string[] = []
  for (const c of children) {
    const segs = c.groupKey.split('/').filter(Boolean)
    if (segs.length === 0) continue
    const composite = tryComposeLeafGroup(c, compById, rendersEdges)
    if (composite !== undefined) {
      ids.push(composite.id)
    } else {
      ids.push(groupSubgraphId(c.groupKey).replace(/_G$/, '_T'))
    }
  }
  return ids
}

export function emitFeFileTreeLines(
  groups: NestedGroup[],
  indent: string,
  ctx: FileTreeCtx,
  lines: string[],
  edges: string[],
  fileNodeRendered: Set<string>,
): void {
  const i2 = indent + '  '
  for (const group of groups) {
    const leafSeg = group.groupKey.split('/').filter(Boolean).pop()
    if (leafSeg === undefined) {
      for (const r of group.routes) {
        emitRouteAndFileLeaf(r, indent, ctx, lines, edges, fileNodeRendered)
      }
      if (group.children.length > 0) {
        emitFeFileTreeLines(group.children, indent, ctx, lines, edges, fileNodeRendered)
      }
      continue
    }
    // leaf composite 가능한 group은 subgraph 없이 단일 노드만 emit.
    const composite = tryComposeLeafGroup(group, ctx.compById, ctx.rendersEdges)
    if (composite !== undefined) {
      lines.push(`${indent}${composite.line}`)
      // 1-depth import child: from 합성 노드 ID로 cross-cluster edge 유지
      if (composite.route.routeFileKind === 'page') {
        const childImports = ctx.importsEdges.filter(e => e.from === composite.comp.id && e.importDepth === 1)
        for (const childEdge of childImports) {
          const childComp = ctx.compById.get(childEdge.to)
          if (childComp === undefined) continue
          const childFileId = `file_${sanitizeId(childComp.id)}`
          if (!fileNodeRendered.has(childFileId)) {
            fileNodeRendered.add(childFileId)
            lines.push(`${indent}${childFileId}["${formatFileLeafLabel(childComp.filePath)}"]:::pkg`)
          }
          edges.push(`  ${composite.id} --> ${childFileId}`)
        }
      }
      continue
    }
    const sgId = groupSubgraphId(group.groupKey).replace(/_G$/, '_T')
    lines.push(`${indent}subgraph ${sgId}["${sectionLabel(leafSeg)}"]`)
    for (const r of group.routes) {
      emitRouteAndFileLeaf(r, i2, ctx, lines, edges, fileNodeRendered)
    }
    if (group.children.length > 0) {
      emitFeFileTreeLines(group.children, i2, ctx, lines, edges, fileNodeRendered)
    }
    lines.push(`${indent}end`)
    // 자식 chain: leaf composite은 노드 ID, 일반 cluster는 subgraph ID로 ~~~ 연결.
    // ⚠️ chain은 부모 cluster 바깥(`end` 다음, `${indent}` 들여쓰기)에 emit해야 작동.
    // 부모 안에 emit하면 plain 노드 chain도 X축이 깨짐.
    // FE 표준 v1.1: nested X축은 보장하지 않으나 chain 효과로 작동하는 케이스는 보너스로 유지.
    if (group.children.length >= 2) {
      const childIds = collectChildIds(group.children, ctx.compById, ctx.rendersEdges)
      if (childIds.length >= 2) lines.push(`${indent}${childIds.join(' ~~~ ')}`)
    }
  }
}

// 1-depth import child component leaf + Y축 edge.
// shared component: 단일 노드 + fan-in edges (fileNodeRendered Set 가드 활용).
// page → page import: 1-hop import edge 동일 처리.
// from 가드: routeFileKind === 'page' Route의 renders target ComponentNode만 (layout/loading 차단).
// 내부 lib(IR componentNodes 미등록)은 자동 필터 (compById.get → undefined).
export function emitRouteAndFileLeaf(
  r: RouteNode,
  indent: string,
  ctx: FileTreeCtx,
  lines: string[],
  edges: string[],
  fileNodeRendered: Set<string>,
): void {
  const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
  const displayPath = r.path.split('/').filter(Boolean).pop() ?? r.path
  lines.push(`${indent}${sanitizeId(r.id)}["${displayPath} · ${badge}"]:::${modeClass(r.renderingMode)}`)

  const edge = ctx.rendersEdges.find(e => e.from === r.id)
  if (edge === undefined) return
  const comp = ctx.compById.get(edge.to)
  if (comp === undefined) return

  const fileId = `file_${sanitizeId(comp.id)}`
  if (!fileNodeRendered.has(fileId)) {
    fileNodeRendered.add(fileId)
    lines.push(`${indent}${fileId}["${formatFileLeafLabel(comp.filePath)}"]:::pkg`)
  }
  // edge를 cluster 안에 emit해야 graph LR에서 cluster width 영향이 형제 X축 layout 방해를 안 함
  // (edge가 root level에 있으면 mermaid가 cluster를 자동 Y로 쌓음).
  lines.push(`${indent}${sanitizeId(r.id)} --> ${fileId}`)

  // page 컴포넌트의 1-depth imports child component leaf + Y축 edge
  // routeFileKind === 'page' 가드 (layout/loading 차단)
  if (r.routeFileKind !== 'page') return
  const childImports = ctx.importsEdges.filter(e => e.from === comp.id && e.importDepth === 1)
  for (const childEdge of childImports) {
    const childComp = ctx.compById.get(childEdge.to)
    if (childComp === undefined) continue  // 외부 lib 자동 필터
    const childFileId = `file_${sanitizeId(childComp.id)}`
    if (!fileNodeRendered.has(childFileId)) {
      fileNodeRendered.add(childFileId)
      lines.push(`${indent}${childFileId}["${formatFileLeafLabel(childComp.filePath)}"]:::pkg`)
    }
    // cross-cluster 가능성 — root level (edges 배열)에 둠
    edges.push(`  ${fileId} --> ${childFileId}`)
  }
}
