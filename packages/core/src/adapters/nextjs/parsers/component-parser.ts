import * as path from 'node:path'
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
import { loadTsConfigPaths, type PathsMap } from '../../_shared/ts-config-loader.js'
import { walkDir, NEXTJS_EXCLUDE_DIRS } from '../../_shared/file-finder.js'
import { componentNameFromPath } from '../../_shared/component-name.js'

async function collectTsxFiles(dir: string): Promise<string[]> {
  return walkDir(dir, { extensions: new Set(['.tsx']), excludeDirs: NEXTJS_EXCLUDE_DIRS })
}

function resolveModuleSpecifier(
  moduleSpecifier: string,
  fromFileDir: string,
  normalizedRoot: string,
  aliasPaths: PathsMap,
): string | undefined {
  if (moduleSpecifier.startsWith('.')) {
    return path.resolve(fromFileDir, moduleSpecifier)
  }
  for (const [aliasPrefix, targetDir] of aliasPaths) {
    if (moduleSpecifier === aliasPrefix || moduleSpecifier.startsWith(aliasPrefix + '/')) {
      const rest = moduleSpecifier.slice(aliasPrefix.length)
      return path.join(targetDir, rest)
    }
  }
  return undefined
}

function findTsxCandidate(
  moduleSpecifier: string,
  fromFileDir: string,
  tsxRelSet: Set<string>,
  normalizedRoot: string,
  aliasPaths: PathsMap,
): string | undefined {
  const base = resolveModuleSpecifier(moduleSpecifier, fromFileDir, normalizedRoot, aliasPaths)
  if (base === undefined) return undefined

  const candidates = [
    base,
    base.replace(/\.js$/, '.tsx'),
    base.replace(/\.js$/, '.ts'),
    base + '.tsx',
    base + '.ts',
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
  analyzerVersion: string,
): Promise<{ nodes: ComponentNode[]; edges: IREdge[] }> {
  const normalizedRoot = path.resolve(repoRoot)
  const aliasPaths = await loadTsConfigPaths(normalizedRoot)
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
        ? componentNameFromPath(filePath)
        : (exportKeys[0] ?? componentNameFromPath(filePath))

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
      analyzerVersion,
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
        aliasPaths,
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
          analyzerVersion,
        },
        confidence: 'verified',
      })

      edges.push(edge)
    }
  }

  return { nodes, edges }
}
