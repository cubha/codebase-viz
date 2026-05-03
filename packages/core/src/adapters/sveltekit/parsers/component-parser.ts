import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Project } from 'ts-morph'
import {
  createComponentNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type ComponentNode,
  type IREdge,
  type Provenance,
} from '@codebase-viz/types'

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.svelte-kit', 'dist', 'build'])
const SVELTE_SCRIPT_RE = /<script(?:\s(?!context)[^>]*)?>(?<content>[\s\S]*?)<\/script>/

async function findSvelteFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.svelte')) {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

export async function parseSvelteComponents(
  repoRoot: string,
  analyzerVersion: string,
): Promise<{ nodes: ComponentNode[]; edges: IREdge[] }> {
  const svelteFiles = await findSvelteFiles(repoRoot)
  if (svelteFiles.length === 0) return { nodes: [], edges: [] }

  const nodes: ComponentNode[] = []
  const edges: IREdge[] = []
  const nodeIdByRelPath = new Map<string, import('@codebase-viz/types').NodeId>()

  const project = new Project({
    compilerOptions: { target: 99, allowJs: true, strict: false },
    useInMemoryFileSystem: true,
  })

  for (const filePath of svelteFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const name = path.basename(filePath, '.svelte')

    const provenance: Provenance = {
      file: relPath,
      line: 1,
      adapter: 'sveltekit-component-parser@0.1',
      analyzerVersion,
    }

    const nodeId = makeNodeId('component', relPath, name)
    nodeIdByRelPath.set(relPath, nodeId)

    nodes.push(
      createComponentNode({
        id: nodeId,
        name,
        filePath: relPath,
        runtime: 'client',
        provenance,
        confidence: 'inferred',
        inferenceChain: [`sveltekit: .svelte file detected`],
      }),
    )

    const match = SVELTE_SCRIPT_RE.exec(source)
    if (match?.groups?.['content'] === undefined) continue

    const scriptContent = match.groups['content']
    const sf = project.createSourceFile(`${relPath}.ts`, scriptContent, { overwrite: true })

    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue()
      if (!spec.startsWith('.') && !spec.startsWith('$lib')) continue

      let resolvedRel: string
      if (spec.startsWith('$lib')) {
        resolvedRel = spec.replace('$lib', 'src/lib') + '.svelte'
      } else {
        const resolved = path.resolve(path.dirname(filePath), spec)
        resolvedRel = path.relative(repoRoot, resolved).replace(/\\/g, '/')
        if (!resolvedRel.endsWith('.svelte')) resolvedRel += '.svelte'
      }

      const toId = makeNodeId('component', resolvedRel, path.basename(resolvedRel, '.svelte'))
      const edgeId = makeEdgeId('imports', nodeId, toId)
      edges.push(
        createEdge({
          id: edgeId,
          from: nodeId,
          to: toId,
          kind: 'imports',
          importDepth: 1,
          provenance,
          confidence: 'inferred',
          inferenceChain: [`sveltekit: import '${spec}' in ${relPath}`],
        }),
      )
    }
  }

  return { nodes, edges }
}
