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
import { metadataToInfra, isFileTreeTab2Eligible, type InfraInfo } from './fe/infra.js'
import { buildNestedSubgraphLines } from './fe/nested.js'
import { buildDomainSummaryLines } from './fe/tab1-summary.js'
import { renderScreenSection } from './fe/tab2.js'
import { buildFeFileTreeScreenDiagram } from './fe/tab2-file.js'
import { buildFeDomainLayeredScreenDiagram, isPagesDomainEligible } from './fe/tab2-domain.js'
import { buildBeRenderingDiagram } from './be/tab1.js'
import { buildBeArchitectureDiagram } from './be/tab2.js'
import { buildDbScreenDiagram } from './erd/db-diagram.js'

interface FwWrapper { id: string; label: string }
interface FwConfig {
  check: (infra: InfraInfo, allCSR: boolean) => boolean
  frontendRefId: string
  wrappers: readonly FwWrapper[]
}

// FE Tab1 wrapper 레이어 config. 외부 edge 발사는 항상 frontendRefId(outermost) — mermaid v11 명세.
// check 우선순위: nextjs-SSR > nextjs-CSR > vite > expo > react-router > vue-spa > angular > bare(fallback).
const FW_CONFIGS: readonly FwConfig[] = [
  {
    check: (infra, allCSR) => infra.hasNextjs && !allCSR,
    frontendRefId: 'INFRA',
    wrappers: [
      { id: 'INFRA', label: '☁ VERCEL · Edge Network' },
      { id: 'RUNTIME', label: '⚙ Node.js · Server Runtime' },
      { id: 'FRAMEWORK', label: '▲ Next.js · App Router' },
      { id: 'REACT', label: '⚛ React · SSR Engine' },
    ],
  },
  {
    check: (infra, allCSR) => infra.hasNextjs && allCSR,
    frontendRefId: 'BROWSER',
    wrappers: [
      { id: 'BROWSER', label: '🌐 Browser · Client-Side App' },
      { id: 'FRAMEWORK', label: '▲ Next.js · App Router' },
      { id: 'REACT', label: '⚛ React · CSR Engine' },
    ],
  },
  {
    check: (infra) => infra.hasVite,
    frontendRefId: 'BROWSER',
    wrappers: [
      { id: 'BROWSER', label: '🌐 Browser · Client-Side App' },
      { id: 'BUNDLER', label: '⚡ Vite · Dev/Build' },
      { id: 'REACT', label: '⚛ React · CSR Engine' },
    ],
  },
  {
    check: (infra) => infra.hasExpo,
    frontendRefId: 'MOBILE',
    wrappers: [
      { id: 'MOBILE', label: '📱 Mobile · iOS / Android' },
      { id: 'RN', label: '⚛ React Native · Expo' },
    ],
  },
  {
    check: (infra) => infra.hasReactRouter,
    frontendRefId: 'BROWSER',
    wrappers: [
      { id: 'BROWSER', label: '🌐 Browser · Client-Side App' },
      { id: 'ROUTER', label: '🧭 React Router · SPA' },
      { id: 'REACT', label: '⚛ React · CSR Engine' },
    ],
  },
  {
    check: (infra) => infra.hasVueSpa,
    frontendRefId: 'BROWSER',
    wrappers: [
      { id: 'BROWSER', label: '🌐 Browser · Client-Side App' },
      { id: 'ROUTER', label: '🧭 Vue Router · SPA' },
      { id: 'VUE', label: '💚 Vue · CSR Engine' },
    ],
  },
  {
    check: (infra) => infra.hasAngular,
    frontendRefId: 'BROWSER',
    wrappers: [
      { id: 'BROWSER', label: '🌐 Browser · Client-Side App' },
      { id: 'ROUTER', label: '🧭 Angular Router · SPA' },
      { id: 'ANGULAR', label: '🅰 Angular · CSR Engine' },
    ],
  },
]

function buildRenderingDiagram(graph: IRGraph): string {
  if (graph.metadata?.adapterCategory === 'BE') return buildBeRenderingDiagram(graph)

  const infra = metadataToInfra(graph.metadata)
  // Only page routes — skip loading, layout, error, template, route-handler (same as Tab 2)
  const routeNodes = graph.nodes.filter(isRouteNode).filter(r => r.routeFileKind === 'page')
  if (routeNodes.length === 0) return 'graph TD\n  empty["(no routes found)"]'

  // FE 표준 v1.2 (R-T1.2/R-T1.7, §9): Tab1은 top-level 도메인 요약만 표시 → 노드 수 O(도메인)라
  // 청킹 불필요(폐지). 이전 청킹 게이트(routeCount>100 / branchingGroups>GROUPS_PER_ROW=v1.2.51 C2)는
  // wrapper(R-T1.1)·외부분기(R-T1.5)를 폐기시켜 Tab1을 URL 트리로 전락시키던 결함이었다.
  const branchingGroups = findBranchingGroups(groupRoutesByUrl(routeNodes))

  const tableNodes = graph.nodes.filter(isTableNode)
  const hasDirectDB = infra.hasSupabase || infra.hasDexie || infra.hasPrisma || infra.hasFirebase
  const hasExternalAPI = tableNodes.length > 0 && !hasDirectDB
  const backends = graph.metadata?.backends ?? []
  const allCSR = routeNodes.length > 0 && routeNodes.every(r => r.renderingMode === 'CSR')

  // (Playwright 검증): FE Tab1은 outer `graph LR` 사용.
  // 표준 1 R-T1.2 "동일 Depth = X축"을 mermaid가 형제 subgraph 자동 가로 배치로 충족.
  // 외부 edge가 어느 컨테이너에 incoming해도 LR이 영향받지 않음 (TD + nested direction LR은 무시됨).
  const lines: string[] = [RENDERING_INIT, 'graph LR', CLASS_DEFS]

  // ── 1. FRONTEND LAYER ────────────────────────────────────────────────────
  // frontendRef: outermost wrapper subgraph ID — 외부 data layer edge source.
  // mermaid v11 공식 명세 "subgraph 노드 중 하나라도 외부 edge 가지면
  // 그 subgraph direction 무시"에 따라, 외부 edge는 반드시 *outermost* wrapper에서 발사해야
  // inner sub-cluster의 direction(LR + ~~~ chain)이 보존됨. middle/inner wrapper(REACT, VUE 등)에서
  // 외부 edge 발사하면 부모 direction 상속 연쇄로 top-level sibling이 Y축 stack됨.
  let frontendRef: string | undefined
  const fwConfig = FW_CONFIGS.find(cfg => cfg.check(infra, allCSR))
  if (fwConfig !== undefined) {
    frontendRef = fwConfig.frontendRefId
    let depth = 0
    for (const w of fwConfig.wrappers) {
      lines.push(`${'  '.repeat(depth + 1)}subgraph ${w.id}["${w.label}"]`)
      depth++
    }
    const innerIndent = '  '.repeat(depth + 1)
    for (const l of buildDomainSummaryLines(branchingGroups, innerIndent)) lines.push(l)
    const closeParts: string[] = []
    while (depth > 0) { closeParts.push(`${'  '.repeat(depth)}end`); depth-- }
    lines.push(closeParts.join('\n'))
  } else {
    for (const l of buildDomainSummaryLines(branchingGroups, '  ')) lines.push(l)
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
    // fetchSrc도 frontendRef(outermost wrapper) 사용 — middle wrapper에서 외부 edge 발사 금지.
    const fetchSrc = frontendRef ?? 'BROWSER'
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
  } else {
    // ST1: FE 어댑터에서 axios/fetch/react-query 호출(api-call edges)이 감지됐고
    // 위 모든 데이터 레이어 분기(backends/Supabase/Dexie/Firebase/Prisma/hasExternalAPI)에 해당 없으면
    // 외부 REST API Gateway 노드를 표시. React Router SPA + 다른 SPA들이 주 대상.
    // LLM enabled에서 backends가 채워지면 line 765의 `if backends.length > 0` 분기가 우선이라 충돌 없음.
    const apiCallEdges = graph.edges.filter(e => e.kind === 'api-call')
    if (apiCallEdges.length > 0 && frontendRef !== undefined) {
      const libraries = new Set<string>()
      for (const e of apiCallEdges) {
        if (e.apiCall?.library !== undefined) libraries.add(e.apiCall.library)
      }
      const libLabel = libraries.size > 0 ? Array.from(libraries).join(' · ') : 'REST'
      lines.push(`  subgraph DATALAYER["🔌 API LAYER"]`)
      lines.push(`    subgraph API_G["⚡ External REST API"]`)
      lines.push(`      API_GATEWAY[("Backend Service")]`)
      lines.push('    end\n  end')
      lines.push(`  ${frontendRef} -.->|"${libLabel}"| API_GATEWAY`)
    }
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
    rendering: buildWithChunkFallback(graph, buildRenderingDiagram, chunkOpts, threshold, routeCount, nodeThr),
    screenComponent: buildWithChunkFallback(graph, buildScreenComponentDiagram, chunkOpts, threshold, routeCount, nodeThr),
    dbScreen: buildDbScreenWithFallback(graph, chunkOpts, threshold, nodeThr),
  }
}
