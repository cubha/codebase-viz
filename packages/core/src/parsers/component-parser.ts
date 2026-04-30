import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { Project, SyntaxKind } from 'ts-morph'
import {
  createComponentNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type ComponentNode,
  type IREdge,
  type NodeId,
  type Provenance,
} from '@codebase-viz/types'

const EXCLUDE_DIRS = new Set(['node_modules', '.next', '.git', 'dist'])

async function collectTsxFiles(dir: string): Promise<string[]> {
  const results: string[] = []

  async function recurse(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) {
          await recurse(fullPath)
        }
      } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
        results.push(fullPath)
      }
    }
  }

  await recurse(dir)
  return results
}

function findTsxCandidate(
  moduleSpecifier: string,
  fromFileDir: string,
  tsxRelSet: Set<string>,
  normalizedRoot: string,
): string | undefined {
  if (!moduleSpecifier.startsWith('.')) return undefined

  const resolved = path.resolve(fromFileDir, moduleSpecifier)
  const candidates = [
    resolved,
    resolved.replace(/\.js$/, '.tsx'),
    resolved.replace(/\.js$/, '.ts'),
    resolved + '.tsx',
    resolved + '.ts',
  ]

  for (const candidate of candidates) {
    const rel = path.relative(normalizedRoot, candidate)
    if (!rel.startsWith('..') && tsxRelSet.has(rel)) {
      return rel
    }
  }

  return undefined
}

export async function parseComponents(
  repoRoot: string,
): Promise<{ nodes: ComponentNode[]; edges: IREdge[] }> {
  const normalizedRoot = path.resolve(repoRoot)
  const tsxAbsFiles = await collectTsxFiles(normalizedRoot)

  const tsxRelSet = new Set(
    tsxAbsFiles.map(f => path.relative(normalizedRoot, f)),
  )

  const project = new Project({
    compilerOptions: {
      jsx: 4,
      allowJs: true,
    },
    skipAddingFilesFromTsConfig: true,
  })

  for (const absPath of tsxAbsFiles) {
    project.addSourceFileAtPath(absPath)
  }

  // Pass 1: determine name and nodeId for each source file
  const fileNodeMap = new Map<string, { nodeId: NodeId; name: string }>()

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(normalizedRoot, filePath)

    const defaultExport = sourceFile.getDefaultExportSymbol()
    const exportKeys = [...sourceFile.getExportedDeclarations().keys()].filter(
      k => k !== 'default',
    )

    const name =
      defaultExport !== undefined
        ? path.basename(filePath, path.extname(filePath))
        : (exportKeys[0] ?? path.basename(filePath, path.extname(filePath)))

    const nodeId = makeNodeId('component', relPath, name)
    fileNodeMap.set(relPath, { nodeId, name })
  }

  // Pass 2: build nodes and edges
  const nodes: ComponentNode[] = []
  const edges: IREdge[] = []

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(normalizedRoot, filePath)
    const entry = fileNodeMap.get(relPath)
    if (entry === undefined) continue

    const { nodeId, name } = entry

    const statements = sourceFile.getStatements()
    const firstStatement = statements[0]
    const isClient =
      firstStatement?.getKind() === SyntaxKind.ExpressionStatement &&
      firstStatement.getText().includes('use client')

    const provenance: Provenance = {
      file: relPath,
      line: 1,
      adapter: 'nextjs-app-router@0.1',
      analyzerVersion: 'codebase-viz@0.1.0',
    }

    const node: ComponentNode = isClient
      ? createComponentNode({
          id: nodeId,
          name,
          filePath: relPath,
          runtime: 'client',
          provenance,
          confidence: 'verified',
        })
      : createComponentNode({
          id: nodeId,
          name,
          filePath: relPath,
          runtime: 'server',
          provenance,
          confidence: 'inferred',
          inferenceChain: ['no "use client" directive found'],
        })

    nodes.push(node)

    // Import analysis — only relative imports to .tsx files
    const fileDir = path.dirname(filePath)
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue()
      const targetRelPath = findTsxCandidate(
        moduleSpecifier,
        fileDir,
        tsxRelSet,
        normalizedRoot,
      )
      if (targetRelPath === undefined) continue

      const targetEntry = fileNodeMap.get(targetRelPath)
      if (targetEntry === undefined) continue

      const edgeId = makeEdgeId('imports', nodeId, targetEntry.nodeId)
      const edge = createEdge({
        id: edgeId,
        from: nodeId,
        to: targetEntry.nodeId,
        kind: 'imports',
        importDepth: 1,
        provenance: {
          file: relPath,
          line: importDecl.getStartLineNumber(),
          adapter: 'nextjs-app-router@0.1',
          analyzerVersion: 'codebase-viz@0.1.0',
        },
        confidence: 'verified',
      })

      edges.push(edge)
    }
  }

  return { nodes, edges }
}
