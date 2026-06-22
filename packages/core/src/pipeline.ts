import * as path from 'node:path'
import {
  ANALYZER_VERSION,
  createIRGraph,
  EMPTY_ADAPTER_RESULT,
  type IRGraph,
} from '@codebase-viz/types'
import {
  detectStack,
  collectFiles,
  analyzeWithLLM,
  convertToIR,
  verifyNodes,
  mergeGraphs,
  type LLMClientOptions,
} from '@codebase-viz/llm'
import { createDefaultRegistry } from './adapters/index.js'
import { corroborateBackends } from './backend-corroborate.js'

export type LLMOptions = LLMClientOptions

// detectStack → adapter → createIRGraph → (LLM enabled) collectFiles → analyzeWithLLM
// → convertToIR(skipComponents 가드) → verifyNodes → mergeGraphs(framework override 보존)
// cli/extension 공통. 캐시·pair·llmRecommended 가드는 호출자가 책임.
export async function buildIRGraph(
  repoRoot: string,
  llmOptions?: LLMOptions,
): Promise<IRGraph> {
  const stack = await detectStack(repoRoot)
  const registry = createDefaultRegistry()
  const adapter = registry.get(stack.adapterId)

  const result = adapter !== undefined
    ? await adapter.analyze({ repoRoot, stack, analyzerVersion: ANALYZER_VERSION })
    : EMPTY_ADAPTER_RESULT

  let finalGraph: IRGraph = createIRGraph({
    analyzerVersion: ANALYZER_VERSION,
    repoRoot,
    projectName: path.basename(repoRoot),
    metadata: {
      framework: stack.framework,
      hasSupabase: stack.hasSupabase,
      hasPrisma: stack.hasPrisma,
      hasDexie: stack.hasDexie,
      hasFirebase: false,
      ...(adapter !== undefined ? { adapterCategory: adapter.category } : {}),
    },
    nodes: [
      ...result.routeNodes,
      ...result.componentNodes,
      ...result.tableNodes,
      ...(result.serverNodes ?? []),
    ],
    edges: [
      ...result.componentEdges,
      ...result.mapperEdges,
      ...(result.serverEdges ?? []),
    ],
  })

  if (llmOptions === undefined) return finalGraph

  const fileContents = await collectFiles(repoRoot, stack)

  let llmResult
  try {
    llmResult = await analyzeWithLLM(llmOptions, {
      projectName: path.basename(repoRoot),
      framework: stack.framework,
      fileContents,
    })
  } catch (err) {
    // LLM 호출 실패 시 provider/model 컨텍스트와 raw 에러를 한 번에 surface
    const provider = llmOptions.provider ?? 'anthropic'
    const model = llmOptions.model ?? '(default)'
    const errMsg = err instanceof Error ? err.message : String(err)
    const errName = err instanceof Error ? err.name : 'Unknown'
    throw new Error(
      `LLM 호출 실패 [provider=${provider} model=${model}]: ${errName}: ${errMsg}. ` +
      `keyword Not Found이면 모델 ID 또는 API endpoint 확인, 401/403이면 API 키 권한 확인.`,
    )
  }

  // config-based 어댑터에서 LLM/static dirname mismatch로 dedup 실패 → LLM component skip.
  // adapter 존재 여부가 아닌 component 생성 여부로 분기 (monorepo NextAdapter는 단일 appDir만 보므로
  // 0 component 생성 가능 → adapter !== undefined만 보면 LLM까지 차단).
  const adapterHasComponents = result.componentNodes.length > 0
  const { routeNodes: llmRoutes, componentNodes: llmComponents, tableNodes: llmTables, edges: llmEdges } =
    convertToIR(llmResult, ANALYZER_VERSION, { skipComponents: adapterHasComponents })

  const allLLMNodes = [...llmRoutes, ...llmComponents, ...llmTables]
  const { verified } = await verifyNodes(allLLMNodes, repoRoot)

  const corroboratedBackends = corroborateBackends(llmResult.backendServices ?? [], fileContents)

  const llmMeta = {
    // 정적 어댑터가 결정한 framework는 LLM이 덮어쓰지 못한다 (isFileTreeTab2Eligible 화이트리스트
    // 우회로 Tab2 file-tree 표준 손실되는 문제 방지).
    framework: adapter !== undefined ? stack.framework : (llmResult.framework || stack.framework),
    hasSupabase: llmResult.hasSupabase ?? stack.hasSupabase,
    hasPrisma: llmResult.hasPrisma ?? stack.hasPrisma,
    hasDexie: llmResult.hasDexie ?? stack.hasDexie,
    hasFirebase: llmResult.hasFirebase ?? false,
    ...(adapter !== undefined ? { adapterCategory: adapter.category } : {}),
    ...(llmResult.deployTarget !== undefined ? { deployTarget: llmResult.deployTarget } : {}),
    // Evidence-First: LLM backendServices는 수집물에 실제 서버 코드 증거가 있을 때만 상세 렌더.
    // FE-only 환각(spring-boot/PostgreSQL)은 드롭 → renderer가 generic gateway로 fallback.
    ...(corroboratedBackends.length > 0 ? { backends: corroboratedBackends } : {}),
  }
  finalGraph = {
    ...mergeGraphs(finalGraph, verified, llmEdges),
    metadata: llmMeta,
  }

  return finalGraph
}
