import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  isRouteNode,
  isComponentNode,
  isTableNode,
  type IRGraph,
  type IREdge,
  type IRNode,
  type RouteNode,
  type ComponentNode,
  type IRGraphMetadata,
  type IRBackendService,
} from '@codebase-viz/types'
import { groupRoutesByUrl, type NestedGroup } from './url-grouper.js'
import {
  shouldChunk,
  chunkByGroups,
  joinChunks,
  CHUNK_SEPARATOR,
  DEFAULT_CHUNK_THRESHOLD,
  DEFAULT_NODE_THRESHOLD,
  type ChunkOptions,
} from './_shared/wrap-fallback.js'

function edgeArrow(edge: IREdge): string {
  return edge.confidence === 'inferred' ? '-.->' : '-->'
}

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_')
}

const RENDERING_INIT = `%%{init:{'theme':'base','themeVariables':{'background':'#060810','primaryColor':'#0c1a30','primaryTextColor':'#7dd3fc','primaryBorderColor':'#0e3a6e','edgeLabelBackground':'#0c1a30','lineColor':'#334155','secondaryColor':'#0f172a','clusterBkg':'#060c18','clusterBorder':'#1e3a5f','fontFamily':'JetBrains Mono','fontSize':'14'}}}%%`

const CLASS_DEFS = [
  `  classDef ssr fill:#0d1a0d,stroke:#16a34a,color:#86efac`,
  `  classDef csr fill:#2d1200,stroke:#c2410c,color:#fb923c`,
  `  classDef ssg fill:#1a0d1a,stroke:#7c3aed,color:#c4b5fd`,
  `  classDef isr fill:#1a1a0d,stroke:#ca8a04,color:#fde047`,
  `  classDef ppr fill:#0d1a2d,stroke:#2563eb,color:#93c5fd`,
  `  classDef unk fill:#1a1a1a,stroke:#6b7280,color:#9ca3af`,
].join('\n')

function modeClass(mode: string): string {
  const map: Record<string, string> = {
    SSR: 'ssr', CSR: 'csr', SSG: 'ssg', ISR: 'isr', PPR: 'ppr',
  }
  return map[mode] ?? 'unk'
}

function getTopSection(routePath: string): string {
  const parts = routePath.split('/').filter(Boolean)
  if (parts.length === 0) return 'root'
  const first = parts[0]
  if (first === undefined) return 'root'
  return first.replace(/^\[/, '').replace(/\]$/, '') || 'root'
}

// Convert url-grouper groupKey (e.g. "/blog", "/") to the section key used internally
// (e.g. "blog", "root"). Strips leading slash, returns "root" for empty/root.
function groupKeyToSectionKey(groupKey: string): string {
  const stripped = groupKey.replace(/^\//, '')
  return stripped || 'root'
}

function collectNestedRoutes(groups: NestedGroup[]): RouteNode[] {
  const result: RouteNode[] = []
  for (const g of groups) {
    result.push(...g.routes)
    if (g.children.length > 0) result.push(...collectNestedRoutes(g.children))
  }
  return result
}

// Flatten NestedGroup[] into a Map for buildScreenComponentDiagram (preserves one section per top-level cluster).
function buildSectionsFromRoutes(routes: RouteNode[]): Map<string, RouteNode[]> {
  const groups = groupRoutesByUrl(routes)
  const sections = new Map<string, RouteNode[]>()
  for (const group of groups) {
    const secKey = groupKeyToSectionKey(group.groupKey)
    const allRoutes = collectNestedRoutes([group])
    const existing = sections.get(secKey) ?? []
    for (const r of allRoutes) existing.push(r)
    sections.set(secKey, existing)
  }
  return sections
}

// 그룹 subgraph 안에서는 path가 그룹 prefix와 중복되어 노드 라벨이 길어진다 (Y/X 축 폭발).
// stripGroupPrefix로 prefix 제거 → 노드 width 감소 → mermaid가 한 row에 더 많은 노드 배치 가능.
function stripGroupPrefix(path: string, groupKey: string | undefined): string {
  if (groupKey === undefined || groupKey === '' || groupKey === '/') return path
  // 인덱스 라우트(path === groupKey)는 단축 시 라벨이 '/' 한 글자가 되어 노드 폭이 거의 0이 된다.
  // 원본 path 유지로 노드 폭 확보 (다른 라우트는 prefix 제거되므로 mixed visual은 의도).
  if (path === groupKey) return path
  if (path.startsWith(groupKey + '/')) return path.slice(groupKey.length + 1)
  return path
}

function renderingRouteLabel(r: RouteNode, ind: string, stripPrefix?: string): string {
  const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
  const methodPrefix = r.httpMethod !== undefined ? `${r.httpMethod} ` : ''
  const displayPath = stripGroupPrefix(r.path, stripPrefix)
  return `${ind}${sanitizeId(r.id)}["${methodPrefix}${displayPath} · ${badge}"]:::${modeClass(r.renderingMode)}`
}

// Subgraph ID는 group.groupKey 전체에서 파생 → 다른 module의 동일 leaf segment(예: /admin/users vs /order/users)
// 가 같은 USERS_G로 충돌해 mermaid가 단일 subgraph로 합치는 사고 방지.
function groupSubgraphId(groupKey: string): string {
  const segs = groupKey.split('/').filter(Boolean)
  if (segs.length === 0) return 'ROOT_G'
  return sanitizeId(segs.join('_').toUpperCase()) + '_G'
}

// Emit nested Mermaid subgraphs from NestedGroup[]. Used by buildRenderingDiagram and buildCombinedDiagram.
function buildNestedSubgraphLines(groups: NestedGroup[], indent: string): string[] {
  const lines: string[] = []
  const i2 = indent + '  '
  for (const group of groups) {
    const leafSeg = group.groupKey.split('/').filter(Boolean).pop()
    if (leafSeg === undefined) {
      for (const r of group.routes) lines.push(renderingRouteLabel(r, indent))
      if (group.children.length > 0) lines.push(...buildNestedSubgraphLines(group.children, indent))
    } else {
      const sgId = groupSubgraphId(group.groupKey)
      const label = sectionLabel(leafSeg)
      lines.push(`${indent}subgraph ${sgId}["${label}"]`)
      lines.push(...emitInnerRowSubgraphs(i2, sgId, group.routes.length,
        (i, ind) => renderingRouteLabel(group.routes[i]!, ind, group.groupKey)))
      // v1.1.6 T4: 자식 subgraph가 GROUPS_PER_ROW 초과 시 invisible row 래퍼 + direction LR.
      // 부모 안에서 자식 가로 정렬(within-group), 5개 초과면 Y 줄넘김. NestedGroup tree 유지.
      // mermaid 11.x direction LR: 외부 edge 없는 Tab1에서만 안전 (Tab2는 별도 검증 필요).
      if (group.children.length > 0) {
        if (group.children.length <= GROUPS_PER_ROW) {
          lines.push(...buildNestedSubgraphLines(group.children, i2))
        } else {
          const i3 = i2 + '  '
          const rowChunks = chunkGroups(group.children, GROUPS_PER_ROW)
          rowChunks.forEach((chunk, rowIdx) => {
            const rowId = `${sgId}_CR${rowIdx}`
            lines.push(`${i2}subgraph ${rowId} [" "]`)
            lines.push(`${i3}direction LR`)
            lines.push(...buildNestedSubgraphLines(chunk, i3))
            lines.push(`${i2}end`)
            lines.push(`${i2}style ${rowId} fill:none,stroke:none`)
          })
        }
      }
      lines.push(`${indent}end`)
    }
  }
  return lines
}

const SECTION_EMOJI: Record<string, string> = {
  root: '🏠',
  blog: '📝',
  project: '📁',
  projects: '📁',
  contact: '📬',
  admin: '⚙',
  auth: '🔐',
  about: '👤',
  api: '⚡',
}

function sectionLabel(key: string): string {
  const emoji = SECTION_EMOJI[key] ?? '📄'
  return `${emoji} /${key}`
}

interface InfraInfo {
  hasNextjs: boolean
  hasVite: boolean
  hasExpo: boolean
  hasSupabase: boolean
  hasDexie: boolean
  hasPrisma: boolean
  hasFirebase: boolean
}

function metadataToInfra(meta?: IRGraphMetadata): InfraInfo {
  if (meta === undefined) {
    return { hasNextjs: false, hasVite: false, hasExpo: false, hasSupabase: false, hasDexie: false, hasPrisma: false, hasFirebase: false }
  }
  const fw = meta.framework.toLowerCase()
  return {
    hasNextjs: fw === 'nextjs-app-router' || fw === 'nextjs-pages' || fw.startsWith('next'),
    hasVite: fw === 'vite-react' || fw.includes('vite'),
    hasExpo: fw === 'expo' || fw.includes('expo') || meta.deployTarget === 'mobile',
    hasSupabase: meta.hasSupabase,
    hasDexie: meta.hasDexie,
    hasPrisma: meta.hasPrisma,
    hasFirebase: meta.hasFirebase,
  }
}

function buildRouteSectionLines(sections: Map<string, RouteNode[]>, indent: string): string[] {
  const lines: string[] = []
  const i2 = indent + '  '
  for (const [secKey, nodes] of sections) {
    if (secKey === 'root') {
      for (const r of nodes) {
        const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
        const methodPrefix = r.httpMethod !== undefined ? `${r.httpMethod} ` : ''
        lines.push(`${indent}${sanitizeId(r.id)}["${methodPrefix}${r.path} · ${badge}"]:::${modeClass(r.renderingMode)}`)
      }
    } else {
      const sgId = sanitizeId(secKey.toUpperCase()) + '_G'
      lines.push(`${indent}subgraph ${sgId}["${sectionLabel(secKey)}"]`)
      const groupPrefix = '/' + secKey
      lines.push(...emitInnerRowSubgraphs(i2, sgId, nodes.length, (i, ind) => {
        const r = nodes[i]!
        const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
        const displayPath = stripGroupPrefix(r.path, groupPrefix)
        return `${ind}${sanitizeId(r.id)}["${displayPath} · ${badge}"]:::${modeClass(r.renderingMode)}`
      }))
      lines.push(`${indent}end`)
    }
  }
  return lines
}

const GROUPS_PER_ROW = 5
// Tab2는 section당 8+ 컴포넌트를 가질 수 있어, 동일 row 내 section 수를 제한한다.
// nested comp subgraph 방식에서 section 1개 ≈ 580px, 2개 ≈ 1200px → 2개가 안전 상한.
const TAB2_GROUPS_PER_ROW = 2
// v1.1.53: routes < N 이면 chunked path를 발동시키지 않음.
// 작은 프로젝트(28 routes / 7 top-level)도 group 수가 GROUPS_PER_ROW(5)를 넘기면
// chunked → viewer row-mode Y축 단조 나열되는 문제 회피. mermaid는 100+ nodes nested
// subgraph도 단일 다이어그램으로 충분히 처리 가능. 200+ routes stress test(modules=10)는
// routeCount > 100으로 게이트 통과 → chunked 유지하여 회귀 방지.
const SINGLE_DIAGRAM_ROUTE_THRESHOLD = 100
// Y축 폭발 방지: subgraph 안 노드 수가 임계값을 넘으면 N개씩 invisible inner subgraph로 묶어
// 행 줄넘김을 강제한다 (X축 GROUPS_PER_ROW와 대칭 정책).
const NODES_PER_INNER_ROW = 5

function emitInnerRowSubgraphs(
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
function findBranchingGroups(groups: NestedGroup[]): NestedGroup[] {
  if (groups.length !== 1) return groups
  const [single] = groups
  if (single === undefined || single.children.length === 0 || single.routes.length > 0) return groups
  return findBranchingGroups(single.children)
}

function chunkGroups<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

// Row 다이어그램(chunked 경로): NestedGroup tree를 그대로 보존하여 nested subgraph emit.
// v1.1.5 이전: collectNestedRoutes로 평면화 → 재귀 그룹핑 결과 폐기 → /api 안에 100+ 형제 평면 배치 → mermaid 세로 압축
// v1.1.6: buildNestedSubgraphLines 재사용 → /api → /v1 → /admin → /users 식 depth 보존 → leaf subgraph 노드 수 자연 감소
function buildRouteRowDiagram(groups: NestedGroup[]): string {
  const lines = [RENDERING_INIT, 'graph TD', CLASS_DEFS]
  lines.push(...buildNestedSubgraphLines(groups, '  '))
  return lines.join('\n')
}

// Tab2 nested subgraph emit. v1.1.6: NestedGroup tree 보존하여 chunked 경로에서도 재귀 그룹핑 유지.
// 각 group의 routes를 그 group subgraph 안에 배치 + 그 group의 routes에 연결된 comp들을 nested comp subgraph로 추가.
// comp first-claim: 같은 comp가 여러 group route에 연결되면 첫 group이 owner, 나머지는 edge만.
function buildScreenSubgraphLines(
  groups: NestedGroup[],
  indent: string,
  routeToComps: Map<string, string[]>,
  rendersEdges: IREdge[],
  connectedComponents: ComponentNode[],
  compNodeRendered: Set<string>,
  allEdges: string[],
): string[] {
  const lines: string[] = []
  const i2 = indent + '  '
  for (const group of groups) {
    const leafSeg = group.groupKey.split('/').filter(Boolean).pop()
    if (leafSeg === undefined) {
      for (const r of group.routes) {
        const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
        lines.push(`${indent}${sanitizeId(r.id)}["${r.path} · ${badge}"]:::${modeClass(r.renderingMode)}`)
      }
      if (group.children.length > 0) {
        lines.push(...buildScreenSubgraphLines(group.children, indent, routeToComps, rendersEdges, connectedComponents, compNodeRendered, allEdges))
      }
      continue
    }
    const sgId = groupSubgraphId(group.groupKey).replace(/_G$/, '_S')
    lines.push(`${indent}subgraph ${sgId}["${sectionLabel(leafSeg)}"]`)
    lines.push(...emitInnerRowSubgraphs(i2, sgId, group.routes.length, (i, ind) => {
      const r = group.routes[i]!
      const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
      const displayPath = stripGroupPrefix(r.path, group.groupKey)
      return `${ind}${sanitizeId(r.id)}["${displayPath} · ${badge}"]:::${modeClass(r.renderingMode)}`
    }))

    const compsInGroup: string[] = []
    for (const r of group.routes) {
      const comps = routeToComps.get(r.id) ?? []
      for (const compId of comps) {
        const edge = rendersEdges.find(e => e.from === r.id && e.to === compId)
        if (edge !== undefined) {
          allEdges.push(`  ${sanitizeId(r.id)} ${edgeArrow(edge)} ${sanitizeId(compId)}`)
        }
        if (compNodeRendered.has(compId)) continue
        compNodeRendered.add(compId)
        const comp = connectedComponents.find(c => c.id === compId)
        if (comp === undefined) continue
        const label = comp.runtime === 'client' ? `${comp.name} [CSR]` : comp.name
        compsInGroup.push(`${sanitizeId(comp.id)}["${label}"]`)
      }
    }
    if (compsInGroup.length > 0) {
      const compSgId = sgId + '_C'
      lines.push(`${i2}subgraph ${compSgId}`)
      lines.push(...emitInnerRowSubgraphs(i2 + '  ', compSgId, compsInGroup.length,
        (i, ind) => `${ind}${compsInGroup[i]!}`))
      lines.push(`${i2}end`)
    }

    // v1.1.6 T4: Tab2도 자식 subgraph가 GROUPS_PER_ROW 초과 시 invisible row 래퍼 + direction LR.
    // mermaid v11 명세: 외부 edge는 immediate parent subgraph의 direction만 무시. ROW wrapper는
    // ancestor이므로 direction LR 유효 → 사용자 요구("부모 안에서 자식 가로") 충족.
    if (group.children.length > 0) {
      if (group.children.length <= GROUPS_PER_ROW) {
        lines.push(...buildScreenSubgraphLines(group.children, i2, routeToComps, rendersEdges, connectedComponents, compNodeRendered, allEdges))
      } else {
        const i3 = i2 + '  '
        const rowChunks = chunkGroups(group.children, GROUPS_PER_ROW)
        rowChunks.forEach((chunk, rowIdx) => {
          const rowId = `${sgId}_CR${rowIdx}`
          lines.push(`${i2}subgraph ${rowId} [" "]`)
          lines.push(`${i3}direction LR`)
          lines.push(...buildScreenSubgraphLines(chunk, i3, routeToComps, rendersEdges, connectedComponents, compNodeRendered, allEdges))
          lines.push(`${i2}end`)
          lines.push(`${i2}style ${rowId} fill:none,stroke:none`)
        })
      }
    }
    lines.push(`${indent}end`)
  }
  return lines
}

function renderScreenSection(
  routeGroups: NestedGroup[],
  allRendersEdges: IREdge[],
  importsEdges: IREdge[],
  allComponentNodes: ComponentNode[],
): string {
  const pageRoutes = collectNestedRoutes(routeGroups)
  const pageRouteIds = new Set(pageRoutes.map(r => r.id))
  const rowRendersEdges = allRendersEdges.filter(e => pageRouteIds.has(e.from))
  const connectedCompIds = new Set(rowRendersEdges.map(e => e.to))
  const connectedComponents = allComponentNodes.filter(c => connectedCompIds.has(c.id))

  const routeToComps = new Map<string, string[]>()
  for (const edge of rowRendersEdges) {
    if (!connectedCompIds.has(edge.to)) continue
    const list = routeToComps.get(edge.from) ?? []
    list.push(edge.to)
    routeToComps.set(edge.from, list)
  }

  const lines: string[] = [RENDERING_INIT, 'graph TB', CLASS_DEFS]
  const compNodeRendered = new Set<string>()
  const allEdges: string[] = []

  lines.push(...buildScreenSubgraphLines(routeGroups, '  ', routeToComps, rowRendersEdges, connectedComponents, compNodeRendered, allEdges))

  for (const e of allEdges) lines.push(e)

  const connectedIdSet = new Set(connectedComponents.map(c => c.id))
  for (const edge of importsEdges) {
    if (connectedIdSet.has(edge.from) && connectedIdSet.has(edge.to)) {
      lines.push(`  ${sanitizeId(edge.from)} ${edgeArrow(edge)} ${sanitizeId(edge.to)}`)
    }
  }

  if (pageRoutes.length === 0 && connectedComponents.length === 0) {
    lines.push('  empty["(no screen/component data)"]')
  }

  return lines.join('\n')
}

// Path-segment-aware longest common prefix.
// Finds the longest shared URL prefix (up to segment boundaries).
// Single path: strips the last segment (leaf endpoint) to return its parent prefix.
function pathSegmentLcp(paths: string[]): string {
  if (paths.length === 0) return ''
  const segArrays = paths.map(p => p.split('/').filter(Boolean))
  if (paths.length === 1) {
    const segs = segArrays[0]!
    return segs.length > 1 ? '/' + segs.slice(0, -1).join('/') : ''
  }
  const minLen = Math.min(...segArrays.map(a => a.length))
  let lcpCount = 0
  for (let i = 0; i < minLen; i++) {
    const seg = segArrays[0]![i]!
    if (segArrays.every(a => a[i] === seg)) lcpCount++
    else break
  }
  if (lcpCount === 0) return ''
  return '/' + segArrays[0]!.slice(0, lcpCount).join('/')
}

// 패키지 segments 추출: src/main/{java,kotlin}/ 이후 + 파일명 제외
function extractPackageSegments(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, '/')
  const javaMatch = normalized.match(/^(?:.*\/)?src\/main\/(?:java|kotlin)\/(.+)$/)
  const after = javaMatch !== null ? (javaMatch[1] ?? normalized) : normalized
  const segments = after.split('/').filter(Boolean)
  if (segments.length > 0) segments.pop()
  return segments
}

function commonPrefixLen(segArrays: string[][]): number {
  if (segArrays.length === 0) return 0
  const minLen = Math.min(...segArrays.map(a => a.length))
  let i = 0
  for (; i < minLen; i++) {
    const seg = segArrays[0]?.[i]
    if (seg === undefined || !segArrays.every(a => a[i] === seg)) break
  }
  return i
}

type PkgTreeNode = {
  children: Map<string, PkgTreeNode>
  files: Array<{ filePath: string; routes: RouteNode[] }>
}

function buildPkgTree(
  fileRoutes: Array<{ filePath: string; segments: string[]; routes: RouteNode[] }>,
): PkgTreeNode {
  const root: PkgTreeNode = { children: new Map(), files: [] }
  for (const { filePath, segments, routes } of fileRoutes) {
    let cur = root
    for (const seg of segments) {
      let child = cur.children.get(seg)
      if (child === undefined) {
        child = { children: new Map(), files: [] }
        cur.children.set(seg, child)
      }
      cur = child
    }
    cur.files.push({ filePath, routes })
  }
  return root
}

function emitControllerFileSubgraph(
  indent: string,
  parentId: string,
  filePath: string,
  routes: RouteNode[],
): string[] {
  const controllerName = path.basename(filePath, path.extname(filePath))
  const sgId = `${parentId}__${sanitizeId(controllerName)}`
  const prefix = pathSegmentLcp(routes.map(r => r.path))
  const titleSuffix = prefix !== '' ? ` [${prefix}]` : ''
  const lines: string[] = []
  lines.push(`${indent}subgraph ${sgId}["📄 ${controllerName}${titleSuffix}"]`)
  lines.push(...emitInnerRowSubgraphs(indent + '  ', sgId, routes.length, (i, ind) => {
    const r = routes[i]!
    const suffix = prefix !== '' && r.path.startsWith(prefix)
      ? (r.path.slice(prefix.length) || '/')
      : r.path
    const methodPrefix = r.httpMethod !== undefined ? `${r.httpMethod} ` : ''
    return `${ind}${sanitizeId(r.id)}["${methodPrefix}${suffix}"]:::ssr`
  }))
  lines.push(`${indent}end`)
  return lines
}

function emitPkgTreeSubgraphs(
  node: PkgTreeNode,
  indent: string,
  parentId: string,
): string[] {
  const lines: string[] = []
  for (const [seg, child] of node.children) {
    const sgId = `${parentId}__${sanitizeId(seg)}`
    lines.push(`${indent}subgraph ${sgId}["📦 ${seg}"]`)
    lines.push(...emitPkgTreeSubgraphs(child, indent + '  ', sgId))
    lines.push(`${indent}end`)
  }
  for (const { filePath, routes } of node.files) {
    lines.push(...emitControllerFileSubgraph(indent, parentId, filePath, routes))
  }
  return lines
}

// Tab1 BE: 패키지 경로 기반 nested grouping.
// src/main/{java,kotlin}/ 이후 segments를 트리화 → 중첩 subgraph 생성.
// - 모든 Controller가 공유하는 공통 prefix(예: com.wina) 자동 strip
// - 마지막 segment가 모두 `controller(s)`일 때 strip (Spring 패키지 컨벤션)
// - leaf = Controller 파일 단위 subgraph + URL prefix LCP 자동 추출
function buildBeRenderingDiagram(graph: IRGraph): string {
  const routeNodes = graph.nodes.filter(isRouteNode)
  if (routeNodes.length === 0) return 'graph TD\n  empty["(no endpoints found)"]'

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
  const trimmed = fileRoutes.map(f => ({
    ...f,
    segments: f.segments.slice(lcpLen, trimController ? -1 : undefined),
  }))

  const tree = buildPkgTree(trimmed)
  const lines: string[] = [RENDERING_INIT, 'graph TD', CLASS_DEFS]
  lines.push(...emitPkgTreeSubgraphs(tree, '  ', 'BE_ROOT'))
  return lines.join('\n')
}

function buildRenderingDiagram(graph: IRGraph): string {
  if (graph.metadata?.adapterCategory === 'BE') return buildBeRenderingDiagram(graph)

  const infra = metadataToInfra(graph.metadata)
  // Only page routes — skip loading, layout, error, template, route-handler (same as Tab 2)
  const routeNodes = graph.nodes.filter(isRouteNode).filter(r => r.routeFileKind === 'page')
  if (routeNodes.length === 0) return 'graph TD\n  empty["(no routes found)"]'

  const routeGroups = groupRoutesByUrl(routeNodes)
  const branchingGroups = findBranchingGroups(routeGroups)
  if (
    branchingGroups.length > GROUPS_PER_ROW &&
    routeNodes.length > SINGLE_DIAGRAM_ROUTE_THRESHOLD
  ) {
    // v1.1.6: 1 top-level branch = 1 chunk (의미 단위 청크).
    // v1.1.53: routeCount 게이트 추가 — 작은 프로젝트는 single-diagram로 유지.
    return joinChunks(branchingGroups.map(g => buildRouteRowDiagram([g])))
  }

  const tableNodes = graph.nodes.filter(isTableNode)
  const hasDirectDB = infra.hasSupabase || infra.hasDexie || infra.hasPrisma || infra.hasFirebase
  const hasExternalAPI = tableNodes.length > 0 && !hasDirectDB
  const backends = graph.metadata?.backends ?? []
  const allCSR = routeNodes.length > 0 && routeNodes.every(r => r.renderingMode === 'CSR')

  const lines: string[] = [RENDERING_INIT, 'graph TD', CLASS_DEFS]

  // ── 1. FRONTEND LAYER ────────────────────────────────────────────────────
  // frontendRef: subgraph node ID to use as source for data layer edges.
  // undefined for backend-only frameworks (Django, Flask, SpringBoot, etc.)
  let frontendRef: string | undefined
  if (infra.hasNextjs && !allCSR) {
    frontendRef = 'REACT'
    lines.push(`  subgraph INFRA["☁ VERCEL · Edge Network"]`)
    lines.push(`    subgraph RUNTIME["⚙ Node.js · Server Runtime"]`)
    lines.push(`      subgraph FRAMEWORK["▲ Next.js · App Router"]`)
    lines.push(`        subgraph REACT["⚛ React · SSR Engine"]`)
    if (infra.hasSupabase) lines.push(`          SSR_FETCH["(SSR data fetch)"]:::unk`)
    for (const l of buildNestedSubgraphLines(routeGroups, '          ')) lines.push(l)
    lines.push('        end\n      end\n    end\n  end')
  } else if (infra.hasNextjs && allCSR) {
    frontendRef = 'REACT'
    lines.push(`  subgraph BROWSER["🌐 Browser · Client-Side App"]`)
    lines.push(`    subgraph FRAMEWORK["▲ Next.js · App Router"]`)
    lines.push(`      subgraph REACT["⚛ React · CSR Engine"]`)
    for (const l of buildNestedSubgraphLines(routeGroups, '        ')) lines.push(l)
    lines.push('      end\n    end\n  end')
  } else if (infra.hasVite) {
    frontendRef = 'REACT'
    lines.push(`  subgraph BROWSER["🌐 Browser · Client-Side App"]`)
    lines.push(`    subgraph BUNDLER["⚡ Vite · Dev/Build"]`)
    lines.push(`      subgraph REACT["⚛ React · CSR Engine"]`)
    for (const l of buildNestedSubgraphLines(routeGroups, '        ')) lines.push(l)
    lines.push('      end\n    end\n  end')
  } else if (infra.hasExpo) {
    frontendRef = 'RN'
    lines.push(`  subgraph MOBILE["📱 Mobile · iOS / Android"]`)
    lines.push(`    subgraph RN["⚛ React Native · Expo"]`)
    for (const l of buildNestedSubgraphLines(routeGroups, '      ')) lines.push(l)
    lines.push('    end\n  end')
  } else {
    for (const l of buildNestedSubgraphLines(routeGroups, '  ')) lines.push(l)
  }

  // ── 2. DATA / BACKEND LAYER (always outside frontend, unconditional) ─────
  if (backends.length > 0) {
    // Detailed backend from LLM analysis (monorepo / explicit backend detected)
    for (let i = 0; i < backends.length; i++) {
      const be = backends[i]!
      const beId = `BACKEND_${i}`
      const dbId = `DB_${i}`
      const dbLabel = be.dbType === 'postgresql' ? '🐘 PostgreSQL' :
                      be.dbType === 'mysql' ? '🐬 MySQL' :
                      be.dbType === 'mongodb' ? '🍃 MongoDB' : '🗄 Database'
      const visibleMods = (be.modules ?? []).slice(0, 8)
      const extraModCount = (be.modules ?? []).length - visibleMods.length
      lines.push(`  subgraph ${beId}["⚙ ${be.name} · ${be.framework}"]`)
      if (visibleMods.length > 0) {
        lines.push(`    subgraph MODULES_${i}["Core Modules"]`)
        for (const mod of visibleMods) {
          lines.push(`      ${sanitizeId(mod)}_${i}["${mod}"]`)
        }
        if (extraModCount > 0) lines.push(`      MORE_${i}["+ ${extraModCount} more"]`)
        lines.push('    end')
      }
      lines.push(`    ${dbId}[("${dbLabel}")]`)
      if (visibleMods.length > 0) {
        for (const mod of visibleMods) {
          lines.push(`    ${sanitizeId(mod)}_${i} --> ${dbId}`)
        }
      }
      lines.push('  end')
      if (frontendRef !== undefined) lines.push(`  ${frontendRef} -.->|"REST"| ${beId}`)
    }
  } else if (infra.hasSupabase) {
    const fetchSrc = (infra.hasNextjs && !allCSR) ? 'SSR_FETCH' : (frontendRef ?? 'REACT')
    lines.push(`  subgraph DATALAYER["🗄 DATA LAYER"]`)
    lines.push(`    subgraph SUPABASE_G["⚡ Supabase · BaaS"]`)
    lines.push(`      PG_SB[("PostgreSQL")]`)
    if (infra.hasNextjs && !allCSR) lines.push(`      SB_AUTH["Auth · OAuth"]`)
    lines.push('    end\n  end')
    if (frontendRef !== undefined) lines.push(`  ${fetchSrc} -.->|"supabase-js"| PG_SB`)
  } else if (infra.hasDexie) {
    lines.push(`  subgraph LOCALDATA["💾 LOCAL DATA LAYER"]`)
    lines.push(`    subgraph DEXIE_G["📦 Dexie.js · IndexedDB"]`)
    lines.push(`      IDB[("IndexedDB")]`)
    lines.push('    end\n  end')
    if (frontendRef !== undefined) lines.push(`  ${frontendRef} -.->|"dexie"| IDB`)
  } else if (infra.hasFirebase) {
    lines.push(`  subgraph DATALAYER["🔥 DATA LAYER"]`)
    lines.push(`    subgraph FIREBASE_G["Firebase · BaaS"]`)
    lines.push(`      FS[("Firestore")]`)
    lines.push('    end\n  end')
    if (frontendRef !== undefined) lines.push(`  ${frontendRef} -.->|"firebase"| FS`)
  } else if (infra.hasPrisma) {
    lines.push(`  subgraph DATALAYER["🗄 DATA LAYER"]`)
    lines.push(`    subgraph PRISMA_G["Prisma ORM"]`)
    lines.push(`      PG_DB[("Database")]`)
    lines.push('    end\n  end')
    if (frontendRef !== undefined) lines.push(`  ${frontendRef} -.->|"prisma"| PG_DB`)
  } else if (hasExternalAPI) {
    lines.push(`  subgraph DATALAYER["🔌 API LAYER"]`)
    lines.push(`    subgraph API_G["⚡ REST API · Backend"]`)
    lines.push(`      API_SVC[("Backend Service")]`)
    lines.push('    end\n  end')
    if (frontendRef !== undefined) lines.push(`  ${frontendRef} -.->|"REST"| API_SVC`)
  }

  return lines.join('\n')
}

function isBeController(name: string): boolean { return name.endsWith('Controller') }
function isBeService(name: string): boolean { return name.endsWith('Service') || name.endsWith('ServiceImpl') }
function isBeRepository(name: string): boolean {
  return name.endsWith('Repository') || name.endsWith('Dao') || name.endsWith('Mapper')
}

// Tab2 BE: 3-tier DI architecture — Controller → Service → Repository.
// `calls` edges (from di-parser) are rendered as the DI chain.
function buildBeArchitectureDiagram(graph: IRGraph): string {
  const componentNodes = graph.nodes.filter(isComponentNode)
  if (componentNodes.length === 0) return 'graph TD\n  empty["(no BE components found)"]'

  const controllers = componentNodes.filter(c => isBeController(c.name))
  const services = componentNodes.filter(c => !isBeController(c.name) && isBeService(c.name))
  const repositories = componentNodes.filter(c => !isBeController(c.name) && !isBeService(c.name) && isBeRepository(c.name))
  const others = componentNodes.filter(c => !isBeController(c.name) && !isBeService(c.name) && !isBeRepository(c.name))
  const callsEdges = graph.edges.filter(e => e.kind === 'calls')

  const lines: string[] = [RENDERING_INIT, 'graph TD', CLASS_DEFS]

  if (controllers.length > 0) {
    lines.push('  subgraph CTRL_G["🎯 Controllers"]')
    for (const c of controllers) lines.push(`    ${sanitizeId(c.id)}["${c.name}"]:::ssr`)
    lines.push('  end')
  }
  if (services.length > 0) {
    lines.push('  subgraph SVC_G["⚙ Services"]')
    for (const c of services) lines.push(`    ${sanitizeId(c.id)}["${c.name}"]:::unk`)
    lines.push('  end')
  }
  if (repositories.length > 0) {
    lines.push('  subgraph REPO_G["🗄 Repositories"]')
    for (const c of repositories) lines.push(`    ${sanitizeId(c.id)}["${c.name}"]:::ssg`)
    lines.push('  end')
  }
  if (others.length > 0) {
    lines.push('  subgraph COMP_G["📦 Components"]')
    for (const c of others) lines.push(`    ${sanitizeId(c.id)}["${c.name}"]:::unk`)
    lines.push('  end')
  }
  for (const edge of callsEdges) {
    lines.push(`  ${sanitizeId(edge.from)} ${edgeArrow(edge)} ${sanitizeId(edge.to)}`)
  }

  return lines.join('\n')
}

function buildScreenComponentDiagram(graph: IRGraph): string {
  if (graph.metadata?.adapterCategory === 'BE') return buildBeArchitectureDiagram(graph)
  const allRouteNodes = graph.nodes.filter(isRouteNode)
  const componentNodes = graph.nodes.filter(isComponentNode)

  // Only page-type routes — remove loading, layout, template, error, route-handler
  const allPageRoutes = allRouteNodes.filter(r => r.routeFileKind === 'page')

  // Build path → display route map; prefer verified (static) over inferred (LLM duplicates)
  const pathToDisplayRoute = new Map<string, RouteNode>()
  for (const r of allPageRoutes) {
    const existing = pathToDisplayRoute.get(r.path)
    if (existing === undefined || r.confidence === 'verified') {
      pathToDisplayRoute.set(r.path, r)
    }
  }
  const pageRoutes = Array.from(pathToDisplayRoute.values())
  const pageRouteIds = new Set(pageRoutes.map(r => r.id))

  // Remap renders edges: inferred/non-display routes → display route by path, deduplicate
  const seenEdgeKeys = new Set<string>()
  const rendersEdges = graph.edges
    .filter(e => e.kind === 'renders')
    .map(e => {
      if (pageRouteIds.has(e.from)) return e
      // Try to find source route in graph nodes
      const src = allRouteNodes.find(r => r.id === e.from)
      if (src !== undefined) {
        const target = pathToDisplayRoute.get(src.path)
        return target !== undefined ? { ...e, from: target.id } : null
      }
      // Source was rejected by verifier — parse URL path from ID: "route:<file>:<routePath>"
      const colonIdx = e.from.indexOf(':', 'route:'.length)
      if (e.from.startsWith('route:') && colonIdx !== -1) {
        const routePath = e.from.slice(colonIdx + 1)
        const target = pathToDisplayRoute.get(routePath)
        return target !== undefined ? { ...e, from: target.id } : null
      }
      return null
    })
    .filter((e): e is IREdge => {
      if (e === null) return false
      const key = `${e.from}:${e.to}`
      if (seenEdgeKeys.has(key)) return false
      seenEdgeKeys.add(key)
      return true
    })

  const importsEdges = graph.edges.filter(e => e.kind === 'imports')

  const routeGroups = groupRoutesByUrl(pageRoutes)
  const branchingGroups = findBranchingGroups(routeGroups)

  if (
    branchingGroups.length > TAB2_GROUPS_PER_ROW &&
    pageRoutes.length > SINGLE_DIAGRAM_ROUTE_THRESHOLD
  ) {
    // v1.1.6: 1 top-level branch = 1 chunk (Tab1과 동일 정책)
    // v1.1.53: routeCount 게이트 추가 — 작은 프로젝트는 single-diagram로 유지.
    return joinChunks(branchingGroups.map(g =>
      renderScreenSection([g], rendersEdges, importsEdges, componentNodes)
    ))
  }

  return renderScreenSection(branchingGroups, rendersEdges, importsEdges, componentNodes)
}

// MySQL Workbench 스타일 — th(테이블명 헤더): 어두운 청회색 배경 + 밝은 텍스트
// td(컬럼 행): 밝은 배경(attributeBackgroundColor*) + 어두운 텍스트(textColor)
// primaryTextColor가 헤더 텍스트를 override하므로 textColor(전역)는 td 텍스트에만 실효
const DB_DIAGRAM_INIT = `%%{init:{'theme':'base','themeVariables':{'background':'#060810','primaryColor':'#2a4055','primaryTextColor':'#f8fafc','primaryBorderColor':'#1e4060','lineColor':'#f59e0b','secondaryColor':'#0f172a','tertiaryColor':'#1a0a20','attributeBackgroundColorEven':'#ffffff','attributeBackgroundColorOdd':'#f1f5f9','textColor':'#1e293b','nodeBorder':'#1e4060','clusterBkg':'#0a0e1a','fontFamily':'JetBrains Mono','fontSize':'14'}}}%%`

function getSourceLabel(node: IRNode): string | undefined {
  if (isRouteNode(node)) {
    const clean = node.path.replace(/\//g, '_').replace(/^_/, '') || 'root'
    return sanitizeId(clean)
  }
  if (isComponentNode(node)) return sanitizeId(node.name)
  return undefined
}

function buildDbScreenDiagram(graph: IRGraph): string {
  const tableNodes = graph.nodes.filter(isTableNode)
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
      lines.push(`%% table:${sanitizeId(t.name)} path:${file}`)
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

function wrapMermaid(diagram: string): string {
  return `\`\`\`mermaid\n${diagram}\n\`\`\``
}

export async function renderMermaid(graph: IRGraph, outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true })

  const renderingDiagram = buildRenderingDiagram(graph)
  const screenComponentDiagram = buildScreenComponentDiagram(graph)
  const dbScreenDiagram = buildDbScreenDiagram(graph)

  await fs.writeFile(
    path.join(outputDir, 'rendering.md'),
    `# Rendering Architecture\n\n${wrapMermaid(renderingDiagram)}\n`,
    'utf8',
  )

  await fs.writeFile(
    path.join(outputDir, 'screen-component.md'),
    `# Screen–Component Mapping\n\n${wrapMermaid(screenComponentDiagram)}\n`,
    'utf8',
  )

  await fs.writeFile(
    path.join(outputDir, 'db-screen.md'),
    `# DB–Screen Mapping\n\n${wrapMermaid(dbScreenDiagram)}\n`,
    'utf8',
  )
}

export interface DiagramSet {
  rendering: string
  screenComponent: string
  dbScreen: string
}

export interface GroupingOptions {
  maxNodesPerGroup?: number
  maxDepth?: number
}

export interface BuildDiagramsOptions {
  grouping?: GroupingOptions
  chunkThreshold?: number
  nodeThreshold?: number
}

export const DEFAULT_GROUPING: Required<GroupingOptions> = {
  maxNodesPerGroup: 30,
  maxDepth: 8,
}

function buildWithChunkFallback(
  graph: IRGraph,
  build: (g: IRGraph) => string,
  chunkOpts: ChunkOptions,
  threshold: number,
  nodeCount = 0,
  nodeThreshold = DEFAULT_NODE_THRESHOLD,
): string {
  const text = build(graph)
  if (text.includes(CHUNK_SEPARATOR)) return text
  if (!shouldChunk(text, threshold, nodeCount, nodeThreshold)) return text
  // BE 어댑터의 Tab2는 컴포넌트 그래프이므로 라우트 기준 chunking이 무의미.
  // chunkByGroups는 라우트만 분할 → 각 chunk에 컴포넌트 미포함 → "(no BE components found)" 반복 결함 회피.
  if (graph.metadata?.adapterCategory === 'BE') return text
  const subGraphs = chunkByGroups(graph, chunkOpts)
  if (subGraphs.length <= 1) return text
  const parts = subGraphs.map(g => build(g))
  return joinChunks(parts)
}

const COMBINED_FALLBACK = '⚠ 결합 다이어그램 1M 초과 — chunk 분할로 fallback'

function findParentRouteId(componentId: string, feGraph: IRGraph): string | undefined {
  return feGraph.edges.find(e => e.kind === 'renders' && e.to === componentId)?.from
}

export function buildCombinedDiagram(
  feGraph: IRGraph,
  beGraph: IRGraph,
  crossEdges: IREdge[],
  opts?: BuildDiagramsOptions,
): DiagramSet {
  const threshold = opts?.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD

  // Tab1: FE subgraph + BE subgraph + cross-edges
  const feRoutes = feGraph.nodes.filter(isRouteNode).filter(r => r.routeFileKind === 'page')
  const beRoutes = beGraph.nodes.filter(isRouteNode).filter(r => r.routeFileKind === 'page')

  const lines: string[] = [RENDERING_INIT, 'graph TD', CLASS_DEFS]

  // FE subgraph
  if (feRoutes.length > 0) {
    lines.push(`  subgraph FE_PROJ["🖥 Frontend · ${feGraph.projectName ?? 'FE'}"]`)
    for (const l of buildNestedSubgraphLines(groupRoutesByUrl(feRoutes), '    ')) lines.push(l)
    lines.push('  end')
  }

  // BE subgraph
  if (beRoutes.length > 0) {
    lines.push(`  subgraph BE_PROJ["⚙ Backend · ${beGraph.projectName ?? 'BE'}"]`)
    for (const l of buildNestedSubgraphLines(groupRoutesByUrl(beRoutes), '    ')) lines.push(l)
    lines.push('  end')
  }

  // Cross-edges: find parent RouteNode for ComponentNode from ids
  for (const edge of crossEdges) {
    if (edge.kind !== 'fe-be-call') continue
    const visualFrom = findParentRouteId(edge.from, feGraph) ?? edge.from
    lines.push(`  ${sanitizeId(visualFrom)} -.-> ${sanitizeId(edge.to)}`)
  }

  const renderingText = lines.join('\n')
  const totalRouteCount = feRoutes.length + beRoutes.length

  if (!shouldChunk(renderingText, threshold, totalRouteCount)) {
    return {
      rendering: renderingText,
      screenComponent: buildScreenComponentDiagram(feGraph),
      dbScreen: buildDbScreenDiagram(beGraph),
    }
  }

  return {
    rendering: `graph TD\n  fallback["${COMBINED_FALLBACK}"]`,
    screenComponent: buildScreenComponentDiagram(feGraph),
    dbScreen: buildDbScreenDiagram(beGraph),
  }
}

// Tab3 전용: tableCount 기반 임계값 + 테이블 슬라이스 분할
function buildDbScreenWithFallback(
  graph: IRGraph,
  chunkOpts: ChunkOptions,
  threshold: number,
  nodeThr: number,
): string {
  const text = buildDbScreenDiagram(graph)
  if (text.includes(CHUNK_SEPARATOR)) return text
  const tableCount = graph.nodes.filter(isTableNode).length
  if (!shouldChunk(text, threshold, tableCount, nodeThr)) return text

  // 테이블 슬라이스 — 각 chunk에 해당 테이블로 향하는 edges의 source 노드도 포함
  const tables = graph.nodes.filter(isTableNode)
  const tableChunks = chunkGroups(tables, chunkOpts.maxNodesPerGroup)
  if (tableChunks.length <= 1) return text

  const parts = tableChunks.map(tableSlice => {
    const tableIds = new Set(tableSlice.map(t => t.id))
    const relatedEdges = graph.edges.filter(e => tableIds.has(e.to) || tableIds.has(e.from))
    const sourceIds = new Set(relatedEdges.map(e => e.from).filter(id => !tableIds.has(id)))
    const subNodes = [...tableSlice, ...graph.nodes.filter(n => sourceIds.has(n.id))]
    const subNodeIds = new Set(subNodes.map(n => n.id))
    const subGraph: IRGraph = {
      ...graph,
      nodes: subNodes,
      edges: graph.edges.filter(e => subNodeIds.has(e.from) && subNodeIds.has(e.to)),
    }
    return buildDbScreenDiagram(subGraph)
  })
  return joinChunks(parts)
}

export function buildDiagrams(graph: IRGraph, opts?: BuildDiagramsOptions): DiagramSet {
  const chunkOpts: ChunkOptions = {
    maxNodesPerGroup: opts?.grouping?.maxNodesPerGroup ?? DEFAULT_GROUPING.maxNodesPerGroup,
    maxDepth: opts?.grouping?.maxDepth ?? DEFAULT_GROUPING.maxDepth,
  }
  const threshold = opts?.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD
  const nodeThr = opts?.nodeThreshold ?? DEFAULT_NODE_THRESHOLD
  const routeCount = graph.nodes.filter(isRouteNode).length
  return {
    rendering: buildWithChunkFallback(graph, buildRenderingDiagram, chunkOpts, threshold, routeCount, nodeThr),
    screenComponent: buildWithChunkFallback(graph, buildScreenComponentDiagram, chunkOpts, threshold, routeCount, nodeThr),
    dbScreen: buildDbScreenWithFallback(graph, chunkOpts, threshold, nodeThr),
  }
}
