import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  isRouteNode,
  isComponentNode,
  isTableNode,
  type IRGraph,
  type IREdge,
  type RouteNode,
} from '@codebase-viz/types'
import { groupRoutesByUrl } from './url-grouper.js'
import {
  shouldChunk,
  chunkByGroups,
  joinChunks,
  CHUNK_SEPARATOR,
  DEFAULT_CHUNK_THRESHOLD,
  DEFAULT_NODE_THRESHOLD,
  type ChunkOptions,
} from './_shared/wrap-fallback.js'
import { RENDERING_INIT, CLASS_DEFS } from './helpers/constants.js'
import { sanitizeId } from './helpers/ids.js'
import { findBranchingGroups, chunkGroups, splitGroupsByNodeBound, CHUNK_ROUTE_BUDGET, SINGLE_DIAGRAM_ROUTE_THRESHOLD } from './helpers/layout.js'
import { isFileTreeTab2Eligible } from './fe/infra.js'
import { buildNestedSubgraphLines } from './fe/nested.js'
import { renderScreenSection } from './fe/tab2.js'
import { buildFeFileTreeScreenDiagram } from './fe/tab2-file.js'
import { buildFeDomainLayeredScreenDiagram, isPagesDomainEligible } from './fe/tab2-domain.js'
import { buildRenderingDiagram } from './fe/tab1.js'
import { buildBeArchitectureDiagram } from './be/tab2.js'
import { buildDbScreenDiagram } from './erd/db-diagram.js'

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

  // v1.2.50 (RR-3): React Router(config-based)이고 컴포넌트가 src/pages/<도메인> 깊은 구조면
  // URL 그룹핑 대신 파일경로 도메인 트리로 레이어링(BE Tab2와 동일하게 도메인별 chunk 분리).
  // chunk 분리되므로 단일 대형 다이어그램 프리즈 위험 없음 → >100 route 게이트 이전에 분기.
  if (graph.metadata?.framework === 'react-router' && isPagesDomainEligible(componentNodes)) {
    return buildFeDomainLayeredScreenDiagram(pageRoutes, rendersEdges, componentNodes)
  }

  const routeGroups = groupRoutesByUrl(pageRoutes)
  const branchingGroups = findBranchingGroups(routeGroups)

  if (pageRoutes.length > SINGLE_DIAGRAM_ROUTE_THRESHOLD) {
    // v1.2.49 B-6/B-7: Tab1과 동일 — routeCount 단독 게이트 + 노드 바운드 청킹.
    // scope: chunked 경로는 react-router 분기 미적용 (v1.2.43+ 평가).
    const chunks = splitGroupsByNodeBound(branchingGroups, CHUNK_ROUTE_BUDGET)
    return joinChunks(chunks.map(gs =>
      renderScreenSection(gs, rendersEdges, importsEdges, componentNodes)
    ))
  }

  // → v1.2.43 ST2: file-based 어댑터(Next/NextPages/Nuxt/SvelteKit/Remix/ReactRouter)는
  // 라우트 → 디렉터리 트리 → 파일 leaf 표현으로 분기. Vue SPA·Angular(config-based)는 현행 유지.
  // BE 어댑터는 위에서 별도 분기 (회귀 0).
  if (isFileTreeTab2Eligible(graph.metadata)) {
    return buildFeFileTreeScreenDiagram(branchingGroups, rendersEdges, importsEdges, componentNodes)
  }

  return renderScreenSection(branchingGroups, rendersEdges, importsEdges, componentNodes)
}

// ST3 → v1.2.43 ST2: file-based FE 어댑터 Tab2 표준.
// 라우트 nested 트리 + 각 라우트 leaf 옆에 컴포넌트의 filePath를 별도 노드로 emit.
// 도메인/디렉터리 nested subgraph는 Tab1과 일관 + leaf = 디렉터리 + 파일명.
// - file-based 라우팅 어댑터 6종(Next.js App·Pages, Nuxt, SvelteKit, Remix, React Router) 공통 적용
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
    `# Data Flow (Screen ↔ Data Source)\n\n${wrapMermaid(dbScreenDiagram)}\n`,
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
    // FE 표준 v1.2 (R-T1.7, §9): Tab1은 top-level 도메인 요약이라 노드 수 O(도메인)로 항상 단일.
    // routeCount 기반 chunk fallback에 태우면 >300 routes(예: 516)에서 도메인 그룹별로 재청킹되어
    // wrapper가 청크마다 반복 emit + findBranchingGroups가 부분 트리를 하강해 sub-segment로 산란된다.
    // 직접 호출로 단일 래퍼·전체 top-level 도메인을 보장. (Tab2/Tab3는 leaf 열거라 청킹 유지.)
    rendering: buildRenderingDiagram(graph),
    screenComponent: buildWithChunkFallback(graph, buildScreenComponentDiagram, chunkOpts, threshold, routeCount, nodeThr),
    dbScreen: buildDbScreenWithFallback(graph, chunkOpts, threshold, nodeThr),
  }
}
