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
import { escapePlainLabel } from './helpers/label-escape.js'
import { buildNodeMap, mergeNodeMaps, stripNodeMapMarkers, type NodeMap } from './helpers/node-map.js'
import { findBranchingGroups, chunkGroups, splitGroupsByNodeBound, CHUNK_ROUTE_BUDGET, SINGLE_DIAGRAM_ROUTE_THRESHOLD } from './helpers/layout.js'
import { isFileTreeTab2Eligible } from './fe/infra.js'
import { buildNestedSubgraphLines } from './fe/nested.js'
import { renderScreenSection } from './fe/tab2.js'
import { buildFeFileTreeScreenDiagram } from './fe/tab2-file.js'
import { buildFeDomainLayeredScreenDiagram, isPagesDomainEligible } from './fe/tab2-domain.js'
import { buildRenderingDiagram } from './fe/tab1.js'
import { buildBeArchitectureDiagram } from './be/tab2.js'
import { buildDbScreenDiagram, resolveTab3Kind } from './erd/db-diagram.js'
import { buildSequenceDiagram } from './sequence/sequence-diagram.js'

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

  // CLI .md는 사람이 읽는 산출물 — nodeMap 마커(webview 전용 사이드채널)는 여기 남으면 안 된다.
  const renderingDiagram = stripNodeMapMarkers(buildRenderingDiagram(graph))
  const screenComponentDiagram = stripNodeMapMarkers(buildScreenComponentDiagram(graph))
  const dbScreenDiagram = stripNodeMapMarkers(buildDbScreenDiagram(graph))

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
  // T1 딥링크·T2 hover 사이드채널(webview 전용). sanitizeId(node.id) → {file,line,confidence,...}.
  // renderMermaid(.md CLI 출력)는 이 필드를 emit하지 않는다 — DiagramSet은 webview 경로 전용 산출물.
  nodeMap?: NodeMap
  // Wave B T4: 페어 분석(FE+BE) 전용 sequenceDiagram. buildDiagrams(단일모드)는 항상 undefined —
  // CLI(.md) 미노출. buildCombinedDiagram에서도 drawableEdges(matched fe-be-call)가 0건이면
  // undefined — 빈 다이어그램 대신 필드 자체를 비운다(Less is More). isDiagramCache 필수 shape에는
  // 넣지 않는다(구버전 캐시 전량 무효화 방지 — nodeMap·tab3Kind와 동일한 선례).
  sequence?: string
  // webview가 dbScreen을 erDiagram 파서로 재해석할지 원문 그대로 렌더할지 판정하는 선언(D0).
  // resolveTab3Kind와 어긋나면 webview가 다시 침묵 실패하므로 buildDbScreenDiagram 호출 지점마다
  // 반드시 같은 graph로 계산해 채운다. optional인 이유는 이 필드 없는 구캐시(v1.2.62 이전 산출물)를
  // shape로 걸러야 해서(diagram-cache.ts isDiagramCache) — nodeMap과 동일한 선례.
  tab3Kind?: 'erd' | 'flow'
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

const BE_NOT_FOUND_NOTICE = '  BE_NOT_FOUND["⚠ 페어 폴더에서 백엔드를 인식하지 못했습니다 — FE 단독 뷰로 표시"]:::muted'

function findParentRouteId(componentId: string, feGraph: IRGraph): string | undefined {
  return feGraph.edges.find(e => e.kind === 'renders' && e.to === componentId)?.from
}

// A2: crossEdges 중 실제 매칭(dangling 아님)만 — cross-graph-matcher가 exact match를
// 'verified', dynamic-segment match를 'inferred'+'dynamic-segment-match'로 표시하고,
// 매칭 실패(dangling)는 'inferred'+'no-route-match'로 구분한다(cli/cross-project-integration.test.ts
// 와 동일 판정 기준 — 두 곳이 갈리면 회귀 가드가 무력화되므로 반드시 동일하게 유지).
function isMatchedCrossEdge(edge: IREdge): boolean {
  return edge.kind === 'fe-be-call' &&
    (edge.confidence === 'verified' ||
      (edge.confidence === 'inferred' && edge.inferenceChain?.includes('dynamic-segment-match') === true))
}

// A2: FE·BE 테이블을 합쳐 Tab3 ERD를 그리기 위한 합성 그래프. BE 쪽 metadata(adapterCategory 등)를
// 유지해 Repository/Dao/Mapper 포함 로직(db-diagram.ts BE 분기)이 그대로 동작하게 하고, FE 쪽은
// 테이블 노드 + FE 자체 queries 엣지의 source 노드만 얹는다(FE 컴포넌트 전량을 섞어 sourcesMap을
// 오염시키지 않기 위함).
function buildCombinedTableGraph(feGraph: IRGraph, beGraph: IRGraph): IRGraph {
  const feQueriesEdges = feGraph.edges.filter(e => e.kind === 'queries')
  const feQuerySourceIds = new Set(feQueriesEdges.map(e => e.from))
  const feRelevantNodes = feGraph.nodes.filter(n => isTableNode(n) || feQuerySourceIds.has(n.id))
  return {
    ...beGraph,
    nodes: [...feRelevantNodes, ...beGraph.nodes],
    edges: [...feQueriesEdges, ...beGraph.edges],
  }
}

export function buildCombinedDiagram(
  feGraph: IRGraph,
  beGraph: IRGraph,
  crossEdges: IREdge[],
  opts?: BuildDiagramsOptions,
): DiagramSet {
  // A2 ④: 어댑터가 BE 폴더를 인식 못했거나(pairAdapter undefined) FE+FE 페어면 beGraph가 비어
  // 있다 — 결합 다이어그램을 만들지 않고 FE 단독 뷰로 조용히 강등하지 않는다(silent truncation 금지).
  if (beGraph.nodes.length === 0) {
    const feOnly = buildDiagrams(feGraph, opts)
    return { ...feOnly, rendering: `${feOnly.rendering}\n${BE_NOT_FOUND_NOTICE}` }
  }

  const threshold = opts?.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD
  const nodeThr = opts?.nodeThreshold ?? DEFAULT_NODE_THRESHOLD
  const chunkOpts: ChunkOptions = {
    maxNodesPerGroup: opts?.grouping?.maxNodesPerGroup ?? DEFAULT_GROUPING.maxNodesPerGroup,
    maxDepth: opts?.grouping?.maxDepth ?? DEFAULT_GROUPING.maxDepth,
  }

  // A2 ①: matched-only 필터 — crossEdges에 실제 참여하는 라우트만 Tab1에 렌더한다.
  // 노드 수가 O(전체 라우트)가 아닌 O(crossEdges)가 되어 임계 문제 자체가 소멸한다(braintrust
  // 판정 — 노드 가드 제거는 v1.2.49 freeze를 재현시키므로 기각, 범위축소가 대안).
  const matchedEdges = crossEdges.filter(isMatchedCrossEdge)
  // A2 재보정(scope-critic): matchedBeRouteIds를 matchedEdges 전체에서 뽑으면 FE 부모 라우트를
  // 못 찾는(findParentRouteId undefined) 엣지의 BE 쪽 라우트만 연결선 없이 조용히 새어나간다
  // (부분매칭 시 무경고 orphan BE 노드 leak). drawableEdges(선을 실제로 그릴 엣지)를 먼저 정하고
  // FE·BE 라우트 집합을 **동일 기준**으로 파생시켜 비대칭을 없앤다.
  const drawableEdges = matchedEdges.filter(e => findParentRouteId(e.from, feGraph) !== undefined)
  const matchedBeRouteIds = new Set(drawableEdges.map(e => e.to))
  const matchedFeRouteIds = new Set(
    drawableEdges.map(e => findParentRouteId(e.from, feGraph)!),
  )

  const feRoutes = feGraph.nodes.filter(isRouteNode).filter(r => r.routeFileKind === 'page' && matchedFeRouteIds.has(r.id))
  const beRoutes = beGraph.nodes.filter(isRouteNode).filter(r => r.routeFileKind === 'page' && matchedBeRouteIds.has(r.id))

  // T4: 신규 임계 계산 없이 이미 정해진 drawableEdges를 그대로 소비(v1.2.49 freeze 재발 방지).
  const sequence = drawableEdges.length > 0 ? buildSequenceDiagram(feGraph, beGraph, drawableEdges) : undefined

  const lines: string[] = [RENDERING_INIT, 'graph TD', CLASS_DEFS]

  // FE subgraph
  if (feRoutes.length > 0) {
    lines.push(`  subgraph FE_PROJ["🖥 Frontend · ${escapePlainLabel(feGraph.projectName ?? 'FE')}"]`)
    for (const l of buildNestedSubgraphLines(groupRoutesByUrl(feRoutes), '    ')) lines.push(l)
    lines.push('  end')
  }

  // BE subgraph
  if (beRoutes.length > 0) {
    lines.push(`  subgraph BE_PROJ["⚙ Backend · ${escapePlainLabel(beGraph.projectName ?? 'BE')}"]`)
    for (const l of buildNestedSubgraphLines(groupRoutesByUrl(beRoutes), '    ')) lines.push(l)
    lines.push('  end')
  }

  // Cross-edges: drawable만 그린다(dangling은 실제 BE 노드를 가리키지 않고, 부모 라우트를
  // 못 찾는 엣지는 raw 컴포넌트 id로 fallback하지 않는다 — 어느 subgraph에도 속하지 않은 채
  // 스타일 없는 bare 노드로 새어나가 Less is More를 위반하기 때문. drawableEdges는 위에서
  // feRoutes/beRoutes와 동일 기준으로 이미 계산됨).
  for (const edge of drawableEdges) {
    const visualFrom = findParentRouteId(edge.from, feGraph)!
    lines.push(`  ${sanitizeId(visualFrom)} -.-> ${sanitizeId(edge.to)}`)
  }

  // 매칭된 crossEdges가 있었는데도 실제로 그려진 연결이 0건이면(전량 dangling이거나 전량
  // 부모 라우트 미해석) 빈 껍데기 대신 안내를 남긴다 — beGraph=0 폴백과 같은 원칙(조용한
  // 강등 금지)을 matched=0 케이스에도 적용(scope-critic 지적).
  if (drawableEdges.length === 0 && crossEdges.length > 0) {
    const danglingCount = crossEdges.filter(e => e.kind === 'fe-be-call').length
    lines.push(`  NO_MATCH["⚠ 매칭된 FE↔BE 라우트가 없습니다(crossEdges ${danglingCount}건 중 표시 가능 0건) — 각 프로젝트 단독 탭을 확인하세요"]:::muted`)
  }

  const renderingText = lines.join('\n')
  const matchedRouteCount = feRoutes.length + beRoutes.length

  const combinedTableGraph = buildCombinedTableGraph(feGraph, beGraph)

  // A2 ②: Tab2/Tab3는 buildDiagrams와 동일한 chunk fallback 경유(대형 BE에서 raw 호출 시
  // v1.2.49 webview freeze 계열 재발 — braintrust 실측).
  const screenComponent = buildWithChunkFallback(feGraph, buildScreenComponentDiagram, chunkOpts, threshold, feGraph.nodes.filter(isRouteNode).length, nodeThr)
  const dbScreen = buildDbScreenWithFallback(combinedTableGraph, chunkOpts, threshold, nodeThr)

  // T1/T2 사이드채널: FE·BE 각자의 노드를 자기 그래프 기준으로 매핑 후 병합. BE 쪽만 r:'pair'로
  // 표시해 확장이 pairRepoRoot로 경로를 해석하게 한다. 충돌 시 더 확실한 confidence가 이기고
  // (Evidence-First), 동순위면 FE가 이긴다 — mergeNodeMaps가 buildNodeMap과 동일 규칙 적용.
  const emittedTexts = [renderingText, screenComponent, dbScreen, ...(sequence !== undefined ? [sequence] : [])]
  const feNodeMap = buildNodeMap(feGraph, emittedTexts)
  const beNodeMap = buildNodeMap(beGraph, emittedTexts, { root: 'pair' })
  const nodeMap: NodeMap = mergeNodeMaps(feNodeMap, beNodeMap)

  const tab3Kind = resolveTab3Kind(combinedTableGraph)

  if (!shouldChunk(renderingText, threshold, matchedRouteCount, nodeThr)) {
    return {
      rendering: stripNodeMapMarkers(renderingText),
      screenComponent: stripNodeMapMarkers(screenComponent),
      dbScreen: stripNodeMapMarkers(dbScreen),
      nodeMap,
      tab3Kind,
      ...(sequence !== undefined ? { sequence: stripNodeMapMarkers(sequence) } : {}),
    }
  }

  // 실제 트리거를 문구에 반영한다 — 노드수가 임계를 넘지 않았는데도 "노드 N개 초과"라 적으면
  // 사실과 다른 안내가 된다(예: chunkThreshold를 낮게 잡아 텍스트 길이만으로 트리거된 경우,
  // scope-critic 실측 지적).
  const nodeExceeded = matchedRouteCount > nodeThr
  const fallbackMsg = nodeExceeded
    ? `⚠ 결합 다이어그램 노드 ${matchedRouteCount}개 초과(임계 ${nodeThr}) — 안내만 표시`
    : `⚠ 결합 다이어그램 텍스트 ${renderingText.length}자 초과(임계 ${threshold}) — 안내만 표시`
  return {
    rendering: `graph TD\n  fallback["${fallbackMsg}"]`,
    screenComponent: stripNodeMapMarkers(screenComponent),
    dbScreen: stripNodeMapMarkers(dbScreen),
    nodeMap,
    tab3Kind,
    ...(sequence !== undefined ? { sequence: stripNodeMapMarkers(sequence) } : {}),
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
  // FE 표준 v1.2 (R-T1.7, §9): Tab1은 top-level 도메인 요약이라 노드 수 O(도메인)로 항상 단일.
  // routeCount 기반 chunk fallback에 태우면 >300 routes(예: 516)에서 도메인 그룹별로 재청킹되어
  // wrapper가 청크마다 반복 emit + findBranchingGroups가 부분 트리를 하강해 sub-segment로 산란된다.
  // 직접 호출로 단일 래퍼·전체 top-level 도메인을 보장. (Tab2/Tab3는 leaf 열거라 청킹 유지.)
  const rendering = buildRenderingDiagram(graph)
  const screenComponent = buildWithChunkFallback(graph, buildScreenComponentDiagram, chunkOpts, threshold, routeCount, nodeThr)
  const dbScreen = buildDbScreenWithFallback(graph, chunkOpts, threshold, nodeThr)
  const nodeMap = buildNodeMap(graph, [rendering, screenComponent, dbScreen])
  // 마커는 nodeMap 생성 전용 사이드채널 — 렌더 텍스트에 남기면 CLI .md 출력과 스냅샷이 내부 IR id로
  // 오염된다. nodeMap을 뽑은 직후 제거해 기존 출력과 byte-identical을 유지한다.
  return {
    rendering: stripNodeMapMarkers(rendering),
    screenComponent: stripNodeMapMarkers(screenComponent),
    dbScreen: stripNodeMapMarkers(dbScreen),
    nodeMap,
    tab3Kind: resolveTab3Kind(graph),
  }
}
