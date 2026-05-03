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

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.nuxt', 'dist', '.output'])
const VUE_SCRIPT_RE = /<script(?:\s[^>]*)?>(?<content>[\s\S]*?)<\/script>/

async function findVueFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.vue')) {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

export async function parseNuxtComponents(
  repoRoot: string,
  analyzerVersion: string,
): Promise<{ nodes: ComponentNode[]; edges: IREdge[] }> {
  const vueFiles = await findVueFiles(repoRoot)
  if (vueFiles.length === 0) return { nodes: [], edges: [] }

  const nodes: ComponentNode[] = []
  const edges: IREdge[] = []

  const project = new Project({
    compilerOptions: { target: 99, allowJs: true, strict: false },
    useInMemoryFileSystem: true,
  })

  for (const filePath of vueFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const name = path.basename(filePath, '.vue')

    const provenance: Provenance = {
      file: relPath,
      line: 1,
      adapter: 'nuxt-component-parser@0.1',
      analyzerVersion,
    }

    const nodeId = makeNodeId('component', relPath, name)
    nodes.push(
      createComponentNode({
        id: nodeId,
        name,
        filePath: relPath,
        runtime: relPath.includes('pages/') ? 'server' : 'client',
        provenance,
        confidence: 'inferred',
        inferenceChain: [`nuxt: .vue file detected`],
      }),
    )

    const match = VUE_SCRIPT_RE.exec(source)
    if (match?.groups?.['content'] === undefined) continue

    const scriptContent = match.groups['content']
    const sf = project.createSourceFile(`${relPath}.ts`, scriptContent, { overwrite: true })

    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue()
      if (!spec.startsWith('.') && !spec.startsWith('~/') && !spec.startsWith('@/')) continue

      let resolvedRel: string
      if (spec.startsWith('~/') || spec.startsWith('@/')) {
        resolvedRel = spec.replace(/^[~@]\//, '') + (spec.endsWith('.vue') ? '' : '.vue')
      } else {
        const resolved = path.resolve(path.dirname(filePath), spec)
        resolvedRel = path.relative(repoRoot, resolved).replace(/\\/g, '/')
        if (!resolvedRel.endsWith('.vue')) resolvedRel += '.vue'
      }

      const toId = makeNodeId('component', resolvedRel, path.basename(resolvedRel, '.vue'))
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
          inferenceChain: [`nuxt: import '${spec}' in ${relPath}`],
        }),
      )
    }
  }

  return { nodes, edges }
}
