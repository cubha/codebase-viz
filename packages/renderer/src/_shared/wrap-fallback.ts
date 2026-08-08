import {
  isRouteNode,
  isComponentNode,
  isTableNode,
  type IRGraph,
  type IRNode,
  type IREdge,
  type NodeId,
} from '@codebase-viz/types'
import { groupRoutesByUrl } from '../url-grouper.js'
import { chunkGroups, collectNestedRoutes } from '../helpers/layout.js'
import { stripNodeMapMarkers } from '../helpers/node-map.js'

export const DEFAULT_CHUNK_THRESHOLD = 5_000_000
export const DEFAULT_NODE_THRESHOLD = 300
export const CHUNK_SEPARATOR = '%%--CHUNK--%%'

export interface ChunkOptions {
  maxNodesPerGroup: number
  maxDepth: number
}

// 임계 판정은 **webview가 실제로 받는 텍스트** 기준이어야 한다. `%% nodemap:` 마커는 렌더 직전
// 제거되므로 길이에 세면 안 된다 — 현재 실측 영향은 미미하지만(최대 Δ7,900자 = 임계의 0.16%,
// mini-spring-large-app) 마커가 늘면 사용자가 안 보는 텍스트 때문에 청킹이 켜지는 결합이 생긴다.
export function shouldChunk(
  diagramText: string,
  textThreshold = DEFAULT_CHUNK_THRESHOLD,
  nodeCount = 0,
  nodeThreshold = DEFAULT_NODE_THRESHOLD,
): boolean {
  const renderedLength = stripNodeMapMarkers(diagramText).length
  return renderedLength > textThreshold || (nodeCount > 0 && nodeCount > nodeThreshold)
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

export function chunkByGroups(graph: IRGraph, opts: ChunkOptions): IRGraph[] {
  if (graph.nodes.length === 0) return [graph]

  const routes = graph.nodes.filter(isRouteNode)
  const components = graph.nodes.filter(isComponentNode)
  const tables = graph.nodes.filter(isTableNode)

  if (routes.length > 0) {
    const groups = groupRoutesByUrl(routes)
    const subGraphs: IRGraph[] = []
    for (const group of groups) {
      const groupRoutes = collectNestedRoutes([group])
      const routeChunks = chunkGroups(groupRoutes, opts.maxNodesPerGroup)
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
    const tableChunks = chunkGroups(tables, opts.maxNodesPerGroup)
    return tableChunks.map(chunk => sliceGraph(graph, chunk))
  }

  // Fallback: chunk all nodes
  const allChunks = chunkGroups(graph.nodes, opts.maxNodesPerGroup)
  return allChunks.map(chunk => sliceGraph(graph, chunk))
}

export function joinChunks(chunks: string[]): string {
  if (chunks.length === 0) return ''
  if (chunks.length === 1) return chunks[0]!
  const wrapped = chunks.map((c, i) => `${wrapDiagramHeader(i + 1, chunks.length)}\n${c}`)
  return wrapped.join(`\n${CHUNK_SEPARATOR}\n`)
}
