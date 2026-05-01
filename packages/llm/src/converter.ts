import * as path from 'node:path'
import {
  createRouteNode,
  createComponentNode,
  createTableNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type RouteNode,
  type ComponentNode,
  type TableNode,
  type IREdge,
  type RenderingMode,
  type Provenance,
} from '@codebase-viz/types'
import type { LLMAnalysisResult } from './schema.js'

function toRenderingMode(raw: string): RenderingMode {
  const modes: Record<string, RenderingMode> = {
    SSR: 'SSR', CSR: 'CSR', SSG: 'SSG', ISR: 'ISR', PPR: 'PPR',
  }
  return modes[raw.toUpperCase()] ?? 'unknown'
}

function makeProvenance(file: string, analyzerVersion: string): Provenance {
  return { file, line: 1, adapter: 'llm-analyzer@0.1', analyzerVersion }
}

export interface ConvertResult {
  routeNodes: RouteNode[]
  componentNodes: ComponentNode[]
  tableNodes: TableNode[]
  edges: IREdge[]
}

export function convertToIR(
  result: LLMAnalysisResult,
  repoRoot: string,
  analyzerVersion: string,
): ConvertResult {
  void repoRoot
  const routeNodes: RouteNode[] = []
  const componentNodes: ComponentNode[] = []
  const tableNodes: TableNode[] = []
  const edges: IREdge[] = []

  const componentIndex = new Map<string, ComponentNode>()

  for (const route of result.routes) {
    const repoRelFile = route.file.replace(/^\//, '')
    const routeId = makeNodeId('route', repoRelFile, route.path)
    const provenance = makeProvenance(repoRelFile, analyzerVersion)

    const routeNode = createRouteNode({
      id: routeId,
      path: route.path,
      filePath: repoRelFile,
      routeFileKind: 'page',
      dynamicSegmentType: route.path.includes('[') ? 'dynamic' : 'static',
      isGroupRoute: false,
      renderingMode: toRenderingMode(route.mode),
      provenance,
      confidence: 'inferred',
      inferenceChain: [`LLM identified route from ${repoRelFile}`],
    })
    routeNodes.push(routeNode)

    for (const compName of route.components) {
      if (componentIndex.has(compName)) continue

      const compFile = `${path.dirname(repoRelFile)}/${compName}`
      const compId = makeNodeId('component', compFile, compName)
      const compNode = createComponentNode({
        id: compId,
        name: compName,
        filePath: compFile,
        runtime: route.mode === 'CSR' ? 'client' : 'server',
        provenance: makeProvenance(compFile, analyzerVersion),
        confidence: 'inferred',
        inferenceChain: [`LLM identified component on route ${route.path}`],
      })
      componentNodes.push(compNode)
      componentIndex.set(compName, compNode)

      edges.push(createEdge({
        id: makeEdgeId('renders', routeId, compId),
        from: routeId,
        to: compId,
        kind: 'renders',
        provenance,
        confidence: 'inferred',
        inferenceChain: [`LLM: route ${route.path} renders ${compName}`],
      }))
    }
  }

  for (const table of result.tables) {
    const tableFile = `(inferred)/${table.name}`
    const tableId = makeNodeId('table', tableFile, table.name)
    const tableNode = createTableNode({
      id: tableId,
      name: table.name,
      columns: [],
      provenance: makeProvenance(tableFile, analyzerVersion),
      confidence: 'inferred',
      inferenceChain: [`LLM identified table ${table.name}`],
    })
    tableNodes.push(tableNode)

    for (const compName of table.usedBy) {
      const comp = componentIndex.get(compName)
      if (comp === undefined) continue
      edges.push(createEdge({
        id: makeEdgeId('queries', comp.id, tableId),
        from: comp.id,
        to: tableId,
        kind: 'queries',
        provenance: makeProvenance(tableFile, analyzerVersion),
        confidence: 'inferred',
        inferenceChain: [`LLM: ${compName} queries ${table.name}`],
      }))
    }
  }

  return { routeNodes, componentNodes, tableNodes, edges }
}
