import {
  isRouteNode,
  isComponentNode,
  isTableNode,
  type IRGraph,
  type IRNode,
  type IREdge,
  type RouteNode,
  type NodeId,
} from '@codebase-viz/types'
import { groupRoutesByUrl, type NestedGroup } from '../url-grouper.js'

export const DEFAULT_CHUNK_THRESHOLD = 1_000_000
export const DEFAULT_NODE_THRESHOLD = 100
export const CHUNK_SEPARATOR = '%%--CHUNK--%%'

export interface ChunkOptions {
  maxNodesPerGroup: number
  maxDepth: number
}

export function shouldChunk(
  diagramText: string,
  textThreshold = DEFAULT_CHUNK_THRESHOLD,
  nodeCount = 0,
  nodeThreshold = DEFAULT_NODE_THRESHOLD,
): boolean {
  return diagramText.length > textThreshold || (nodeCount > 0 && nodeCount > nodeThreshold)
}

export function wrapDiagramHeader(chunkIndex: number, total: number): string {
  return `%% chunk:${chunkIndex}/${total}`
}

function sliceGraph(parent: IRGraph, nodes: IRNode[]): IRGraph {
  const nodeIds = new Set<NodeId>(nodes.map(n => n.id))
  const edges: IREdge[] = parent.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))
  return {
    schemaVersion: parent.schemaVersion,
    analyzerVersion: parent.analyzerVersion,
    repoRoot: parent.repoRoot,
    ...(parent.projectName !== undefined ? { projectName: parent.projectName } : {}),
    generatedAt: parent.generatedAt,
    ...(parent.metadata !== undefined ? { metadata: parent.metadata } : {}),
    nodes,
    edges,
    ...(parent.warnings !== undefined ? { warnings: parent.warnings } : {}),
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

function collectLeafRouteArrays(groups: NestedGroup[]): RouteNode[][] {
  const result: RouteNode[][] = []
  for (const g of groups) {
    if (g.children.length === 0) {
      if (g.routes.length > 0) result.push(g.routes)
    } else {
      if (g.routes.length > 0) result.push(g.routes)
      result.push(...collectLeafRouteArrays(g.children))
    }
  }
  return result
}

export function chunkByGroups(graph: IRGraph, opts: ChunkOptions): IRGraph[] {
  if (graph.nodes.length === 0) return [graph]

  const routes = graph.nodes.filter(isRouteNode)
  const components = graph.nodes.filter(isComponentNode)
  const tables = graph.nodes.filter(isTableNode)

  if (routes.length > 0) {
    const groups = groupRoutesByUrl(routes)
    const leafArrays = collectLeafRouteArrays(groups)
    const subGraphs: IRGraph[] = []
    for (const groupRoutes of leafArrays) {
      const routeChunks = chunkArray(groupRoutes, opts.maxNodesPerGroup)
      for (const chunk of routeChunks) {
        const routeIds = new Set<NodeId>(chunk.map(r => r.id))
        const reachableComponentIds = new Set<NodeId>()
        for (const e of graph.edges) {
          if (routeIds.has(e.from)) reachableComponentIds.add(e.to)
        }
        const componentsForChunk = components.filter(c => reachableComponentIds.has(c.id))
        const componentIdSet = new Set<NodeId>(componentsForChunk.map(c => c.id))
        const tablesForChunk = tables.filter(t => {
          for (const e of graph.edges) {
            if (componentIdSet.has(e.from) && e.to === t.id) return true
          }
          return false
        })
        subGraphs.push(sliceGraph(graph, [...chunk, ...componentsForChunk, ...tablesForChunk]))
      }
    }
    return subGraphs.length > 0 ? subGraphs : [graph]
  }

  // No routes — chunk by tables (Tab3-only graphs)
  if (tables.length > 0) {
    const tableChunks = chunkArray(tables, opts.maxNodesPerGroup)
    return tableChunks.map(chunk => sliceGraph(graph, chunk))
  }

  // Fallback: chunk all nodes
  const allChunks = chunkArray(graph.nodes, opts.maxNodesPerGroup)
  return allChunks.map(chunk => sliceGraph(graph, chunk))
}

export function joinChunks(chunks: string[]): string {
  if (chunks.length === 0) return ''
  if (chunks.length === 1) return chunks[0]!
  const wrapped = chunks.map((c, i) => `${wrapDiagramHeader(i + 1, chunks.length)}\n${c}`)
  return wrapped.join(`\n${CHUNK_SEPARATOR}\n`)
}
