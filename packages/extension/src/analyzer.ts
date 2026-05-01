import * as path from 'node:path'
import * as os from 'node:os'
import { parseRoutes, parseComponents, parseTables, mapScreenToTable } from '@codebase-viz/core'
import { renderMermaid } from '@codebase-viz/renderer'
import { createIRGraph, type IRGraph } from '@codebase-viz/types'
import {
  detectStack,
  collectFiles,
  analyzWithLLM,
  convertToIR,
  verifyNodes,
  mergeGraphs,
} from '@codebase-viz/llm'

export interface LLMOptions {
  apiKey: string
  model?: string
}

export async function runAnalysis(
  repoRoot: string,
  llmOptions?: LLMOptions,
): Promise<IRGraph> {
  const [routeNodes, { nodes: componentNodes, edges: componentEdges }, tableNodes] =
    await Promise.all([
      parseRoutes(repoRoot),
      parseComponents(repoRoot),
      parseTables(repoRoot),
    ])

  const staticGraph = createIRGraph({
    analyzerVersion: 'codebase-viz@0.1.0',
    repoRoot,
    projectName: path.basename(repoRoot),
    nodes: [...routeNodes, ...componentNodes, ...tableNodes],
    edges: componentEdges,
  })

  const mapperEdges = await mapScreenToTable(staticGraph)
  let graph: IRGraph = { ...staticGraph, edges: [...staticGraph.edges, ...mapperEdges] }

  if (llmOptions !== undefined) {
    const stack = await detectStack(repoRoot)
    const fileContents = await collectFiles(repoRoot, stack.framework)

    const llmResult = await analyzWithLLM(llmOptions, {
      projectName: path.basename(repoRoot),
      framework: stack.framework,
      fileContents,
    })

    const { routeNodes: llmRoutes, componentNodes: llmComponents, tableNodes: llmTables, edges: llmEdges } =
      convertToIR(llmResult, repoRoot, 'codebase-viz@0.1.0')

    const allLLMNodes = [...llmRoutes, ...llmComponents, ...llmTables]
    const { verified } = await verifyNodes(allLLMNodes, repoRoot)

    graph = mergeGraphs(graph, verified, llmEdges)
  }

  // Also write .md files to project dir for reference
  const outputDir = path.join(repoRoot, '.codesight')
  await renderMermaid(graph, outputDir).catch(() => { /* best-effort */ })

  return graph
}

export async function getCacheDir(): Promise<string> {
  return path.join(os.homedir(), '.codesight', 'cache')
}
