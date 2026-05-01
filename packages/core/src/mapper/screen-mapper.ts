import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { Project, SyntaxKind } from 'ts-morph'
import {
  createEdge,
  createComponentNode,
  makeEdgeId,
  makeNodeId,
  isComponentNode,
  isRouteNode,
  isTableNode,
  type IRGraph,
  type IREdge,
  type IRNode,
  type TableNode,
  type ComponentNode,
  type Provenance,
} from '@codebase-viz/types'

const SERVER_FILE_GLOBS = ['src/actions', 'src/utils', 'app/actions', 'app/utils', 'lib/actions', 'lib/utils']

function makeProvenance(repoRoot: string, absPath: string, line: number): Provenance {
  return {
    file: path.relative(repoRoot, absPath).replace(/\\/g, '/'),
    line,
    adapter: 'supabase-mapper@0.1',
    analyzerVersion: 'codebase-viz@0.1.0',
  }
}

async function extractTableCalls(
  project: Project,
  absPath: string,
  tableMap: Map<string, TableNode>,
): Promise<string[]> {
  let sourceFile
  try {
    sourceFile = project.addSourceFileAtPath(absPath)
  } catch {
    return []
  }

  const found: string[] = []
  for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = callExpr.getExpression()
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) continue
    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    if (propAccess.getName() !== 'from') continue

    const args = callExpr.getArguments()
    const firstArg = args[0]
    if (firstArg === undefined || !firstArg.isKind(SyntaxKind.StringLiteral)) continue

    const tableName = firstArg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
    if (tableMap.has(tableName) && !found.includes(tableName)) {
      found.push(tableName)
    }
  }
  return found
}

export async function mapScreenToTable(graph: IRGraph): Promise<IREdge[]> {
  const tableMap = new Map<string, TableNode>()
  for (const node of graph.nodes) {
    if (isTableNode(node)) tableMap.set(node.name, node)
  }

  if (tableMap.size === 0) return []

  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const edges: IREdge[] = []
  const seenEdgeIds = new Set<string>()

  const addEdge = (fromId: string, tableName: string, provFile: string, provLine: number) => {
    const tableNode = tableMap.get(tableName)
    if (tableNode === undefined) return
    const edgeId = makeEdgeId('queries', fromId as ReturnType<typeof makeNodeId>, tableNode.id)
    if (seenEdgeIds.has(edgeId)) return
    seenEdgeIds.add(edgeId)
    edges.push(
      createEdge({
        id: edgeId,
        from: fromId as ReturnType<typeof makeNodeId>,
        to: tableNode.id,
        kind: 'queries',
        provenance: { file: provFile, line: provLine, adapter: 'supabase-mapper@0.1', analyzerVersion: 'codebase-viz@0.1.0' },
        confidence: 'verified',
      }),
    )
  }

  // Scan componentNodes (existing)
  for (const node of graph.nodes.filter(isComponentNode)) {
    const absPath = path.join(graph.repoRoot, node.filePath)
    const tables = await extractTableCalls(project, absPath, tableMap)
    for (const t of tables) addEdge(node.id, t, node.filePath, 1)
  }

  // Scan routeNodes (server components + route handlers)
  for (const node of graph.nodes.filter(isRouteNode)) {
    const absPath = path.join(graph.repoRoot, node.filePath)
    const tables = await extractTableCalls(project, absPath, tableMap)
    for (const t of tables) addEdge(node.id, t, node.filePath, 1)
  }

  return edges
}

async function walkTs(dir: string): Promise<string[]> {
  const results: string[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...(await walkTs(full)))
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        results.push(full)
      }
    }
  } catch {
    // directory doesn't exist — skip
  }
  return results
}

export async function mapServerFilesToTable(
  repoRoot: string,
  tableNodes: TableNode[],
): Promise<{ nodes: ComponentNode[]; edges: IREdge[] }> {
  if (tableNodes.length === 0) return { nodes: [], edges: [] }

  const tableMap = new Map<string, TableNode>(tableNodes.map(t => [t.name, t]))
  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const nodes: ComponentNode[] = []
  const edges: IREdge[] = []
  const seenEdgeIds = new Set<string>()

  for (const relDir of SERVER_FILE_GLOBS) {
    const absDir = path.join(repoRoot, relDir)
    const files = await walkTs(absDir)

    for (const absPath of files) {
      const tables = await extractTableCalls(project, absPath, tableMap)
      if (tables.length === 0) continue

      const relPath = path.relative(repoRoot, absPath).replace(/\\/g, '/')
      // stem: e.g. "src/actions/blog.ts" → "blog"
      const stem = path.basename(absPath, path.extname(absPath))
      const nodeId = makeNodeId('component', relPath, stem)

      // Create virtual ComponentNode for this server file
      const compNode = createComponentNode({
        id: nodeId,
        name: stem,
        filePath: relPath,
        runtime: 'server',
        provenance: makeProvenance(repoRoot, absPath, 1),
        confidence: 'inferred',
        inferenceChain: ['server-file-scan'],
      })

      if (!nodes.some(n => n.id === nodeId)) nodes.push(compNode)

      for (const tableName of tables) {
        const tableNode = tableMap.get(tableName)
        if (tableNode === undefined) continue
        const edgeId = makeEdgeId('queries', nodeId, tableNode.id)
        if (seenEdgeIds.has(edgeId)) continue
        seenEdgeIds.add(edgeId)
        edges.push(
          createEdge({
            id: edgeId,
            from: nodeId,
            to: tableNode.id,
            kind: 'queries',
            provenance: makeProvenance(repoRoot, absPath, 1),
            confidence: 'inferred',
            inferenceChain: ['server-file-scan'],
          }),
        )
      }
    }
  }

  return { nodes, edges }
}
