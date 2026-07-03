import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  buildIRGraph,
  createDefaultRegistry,
  extractFeCalls,
  matchFeCallsToBeRoutes,
  remapCrossEdgeFromIds,
  type LLMOptions,
} from '@codebase-viz/core'
import {
  renderMermaid,
  buildDiagrams,
  DEFAULT_GROUPING,
  type DiagramSet,
  type GroupingOptions,
} from '@codebase-viz/renderer'
import { ANALYZER_VERSION, createIRGraph, EMPTY_ADAPTER_RESULT, isComponentNode, isRouteNode, type IREdge, type IRGraph } from '@codebase-viz/types'
import { detectStack } from '@codebase-viz/llm'

export type { LLMOptions }

export interface AnalysisResult {
  graph: IRGraph
  diagrams: DiagramSet
  pair?: { graph: IRGraph; crossEdges: IREdge[] }
}

export interface RunAnalysisOptions {
  llm?: LLMOptions
  grouping?: GroupingOptions
  pairRepoRoot?: string
}

export async function runAnalysis(
  repoRoot: string,
  options?: RunAnalysisOptions,
): Promise<AnalysisResult> {
  const opts = options ?? {}
  const llmOptions = opts.llm
  const grouping: GroupingOptions = { ...DEFAULT_GROUPING, ...(opts.grouping ?? {}) }

  if (llmOptions === undefined && opts.pairRepoRoot === undefined) {
    const cached = await loadCachedGraph(repoRoot)
    if (cached !== null) {
      return { graph: cached, diagrams: buildDiagrams(cached, { grouping }) }
    }
  }

  // llmRecommended 가드 — adapter 없고 LLM 미지정이면 명시적 에러 surface.
  if (llmOptions === undefined) {
    const stack = await detectStack(repoRoot)
    if (stack.adapterId === undefined && stack.llmRecommended) {
      throw new Error(
        `이 프레임워크(${stack.framework})는 LLM 분석이 필요합니다. API Key를 설정해 주세요.`,
      )
    }
  }

  const finalGraph = await buildIRGraph(repoRoot, llmOptions)

  const outputDir = path.join(repoRoot, '.codebase-viz')
  await renderMermaid(finalGraph, outputDir).catch(() => { /* best-effort */ })
  await saveCachedGraph(repoRoot, finalGraph)

  if (opts.pairRepoRoot !== undefined) {
    const pairResult = await buildPairResult(finalGraph, opts.pairRepoRoot, grouping)
    return { graph: finalGraph, diagrams: buildDiagrams(finalGraph, { grouping }), pair: pairResult }
  }

  return { graph: finalGraph, diagrams: buildDiagrams(finalGraph, { grouping }) }
}

async function buildPairResult(
  feGraph: IRGraph,
  pairRepoRoot: string,
  grouping: Required<GroupingOptions>,
): Promise<{ graph: IRGraph; crossEdges: IREdge[] }> {
  const pairStack = await detectStack(pairRepoRoot)
  const registry = createDefaultRegistry()
  const pairAdapter = registry.get(pairStack.adapterId)
  const pairAdapterResult = pairAdapter !== undefined
    ? await pairAdapter.analyze({ repoRoot: pairRepoRoot, stack: pairStack, analyzerVersion: ANALYZER_VERSION })
    : EMPTY_ADAPTER_RESULT

  const beGraph = createIRGraph({
    analyzerVersion: ANALYZER_VERSION,
    repoRoot: pairRepoRoot,
    projectName: path.basename(pairRepoRoot),
    metadata: {
      framework: pairStack.framework,
      hasSupabase: pairStack.hasSupabase,
      hasPrisma: pairStack.hasPrisma,
      hasDexie: pairStack.hasDexie,
      hasFirebase: false,
      ...(pairAdapter !== undefined ? { adapterCategory: pairAdapter.category } : {}),
    },
    nodes: [
      ...pairAdapterResult.routeNodes,
      ...pairAdapterResult.componentNodes,
      ...pairAdapterResult.tableNodes,
      ...(pairAdapterResult.serverNodes ?? []),
    ],
    edges: [
      ...pairAdapterResult.componentEdges,
      ...pairAdapterResult.mapperEdges,
      ...(pairAdapterResult.serverEdges ?? []),
    ],
  })

  // Extract FE fetch calls from component file paths
  const feComponentFiles = feGraph.nodes
    .filter(isComponentNode)
    .map(n => path.join(feGraph.repoRoot, n.filePath))

  const feCalls = await extractFeCalls(feComponentFiles, feGraph.repoRoot, ANALYZER_VERSION)

  const beRoutes = beGraph.nodes.filter(isRouteNode)
  const rawEdges = matchFeCallsToBeRoutes(feCalls, beRoutes, {
    fromRepoRoot: feGraph.repoRoot,
    toRepoRoot: pairRepoRoot,
    analyzerVersion: ANALYZER_VERSION,
  })
  const crossEdges = remapCrossEdgeFromIds(rawEdges, feGraph)

  return { graph: beGraph, crossEdges }
}


interface CacheEntry {
  analyzerVersion: string
  graph: IRGraph
}

// v1.2.57 이전: extension.ts가 같은 파일명(cache.json)에 diagram cache({savedAt,diagrams,...})를
// 덮어써 graph 캐시가 analyzerVersion 필드 부재로 상시 무효화되던 결함(ARCH-1). cache-graph.json
// 으로 분리하고, shape 가드로 다른 캐시 형태를 오인하지 않게 한다.
const LEGACY_CACHE_FILE = 'cache.json'

function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.analyzerVersion === 'string' && typeof v.graph === 'object' && v.graph !== null
}

export async function loadCachedGraph(repoRoot: string): Promise<IRGraph | null> {
  const dir = path.join(repoRoot, '.codebase-viz')
  const candidates = [path.join(dir, 'cache-graph.json'), path.join(dir, LEGACY_CACHE_FILE)]
  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!isCacheEntry(parsed)) continue
      if (parsed.analyzerVersion !== ANALYZER_VERSION) continue
      return parsed.graph
    } catch {
      continue
    }
  }
  return null
}

export async function saveCachedGraph(repoRoot: string, graph: IRGraph): Promise<void> {
  try {
    const dir = path.join(repoRoot, '.codebase-viz')
    await fs.mkdir(dir, { recursive: true })
    const entry: CacheEntry = { analyzerVersion: ANALYZER_VERSION, graph }
    await fs.writeFile(path.join(dir, 'cache-graph.json'), JSON.stringify(entry), 'utf8')
  } catch {
    // best-effort
  }
}

