import * as path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'
import {
  createEdge,
  makeEdgeId,
  isComponentNode,
  isTableNode,
  type IRGraph,
  type IREdge,
  type TableNode,
  type Provenance,
} from '@codebase-viz/types'

export async function mapScreenToTable(graph: IRGraph): Promise<IREdge[]> {
  const tableMap = new Map<string, TableNode>()
  for (const node of graph.nodes) {
    if (isTableNode(node)) {
      tableMap.set(node.name, node)
    }
  }

  const componentNodes = graph.nodes.filter(isComponentNode)
  if (componentNodes.length === 0 || tableMap.size === 0) return []

  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const edges: IREdge[] = []
  const seenEdgeIds = new Set<string>()

  for (const componentNode of componentNodes) {
    const absPath = path.join(graph.repoRoot, componentNode.filePath)
    let sourceFile
    try {
      sourceFile = project.addSourceFileAtPath(absPath)
    } catch {
      continue
    }

    for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = callExpr.getExpression()
      if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) continue

      const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
      if (propAccess.getName() !== 'from') continue

      const args = callExpr.getArguments()
      const firstArg = args[0]
      if (firstArg === undefined || !firstArg.isKind(SyntaxKind.StringLiteral)) continue

      const tableName = firstArg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
      const tableNode = tableMap.get(tableName)
      if (tableNode === undefined) continue

      const edgeId = makeEdgeId('queries', componentNode.id, tableNode.id)
      if (seenEdgeIds.has(edgeId)) continue
      seenEdgeIds.add(edgeId)

      const provenance: Provenance = {
        file: componentNode.filePath,
        line: callExpr.getStartLineNumber(),
        adapter: 'supabase-mapper@0.1',
        analyzerVersion: 'codebase-viz@0.1.0',
      }

      edges.push(
        createEdge({
          id: edgeId,
          from: componentNode.id,
          to: tableNode.id,
          kind: 'queries',
          provenance,
          confidence: 'verified',
        }),
      )
    }
  }

  return edges
}
