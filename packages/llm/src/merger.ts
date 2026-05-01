import type { IRGraph, IRNode, IREdge } from '@codebase-viz/types'

function nodeKey(node: IRNode): string {
  if (node.kind === 'route') return `route:${node.filePath}`
  if (node.kind === 'component') return `component:${node.filePath}:${node.name}`
  return `table:${node.name}`
}

export function mergeGraphs(staticGraph: IRGraph, llmNodes: IRNode[], llmEdges: IREdge[]): IRGraph {
  const mergedNodes: IRNode[] = [...staticGraph.nodes]
  const seenKeys = new Set(staticGraph.nodes.map(nodeKey))

  for (const node of llmNodes) {
    const key = nodeKey(node)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    mergedNodes.push(node)
  }

  const staticEdgeKeys = new Set(staticGraph.edges.map(e => `${e.from}:${e.to}:${e.kind}`))
  const mergedEdges: IREdge[] = [...staticGraph.edges]

  for (const edge of llmEdges) {
    const key = `${edge.from}:${edge.to}:${edge.kind}`
    if (!staticEdgeKeys.has(key)) {
      mergedEdges.push(edge)
    }
  }

  return { ...staticGraph, nodes: mergedNodes, edges: mergedEdges }
}
