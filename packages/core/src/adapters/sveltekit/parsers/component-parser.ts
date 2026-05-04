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
const SERVER_FILE_RE = /^(.+)\.server\.(ts|js)$/

interface CollectedFiles {
  svelteFiles: string[]
  serverFiles: string[]
}

async function collectSvelteAndServerFiles(repoRoot: string): Promise<CollectedFiles> {
  const svelteFiles: string[] = []
  const serverFiles: string[] = []

  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.svelte')) {
          svelteFiles.push(path.join(dir, entry.name))
        } else if (SERVER_FILE_RE.test(entry.name)) {
          serverFiles.push(path.join(dir, entry.name))
        }
      }
    }
  }

  await recurse(repoRoot)
  return { svelteFiles, serverFiles }
}

const dirCache = new Map<string, Set<string>>()

async function getDirFiles(dir: string): Promise<Set<string>> {
  if (dirCache.has(dir)) return dirCache.get(dir)!
  const entries = await fs.readdir(dir).catch(() => [] as string[])
  const set = new Set(entries)
  dirCache.set(dir, set)
  return set
}

function detectRuntime(
  filePath: string,
  dirFiles: Set<string>,
): 'client' | 'shared' {
  const name = path.basename(filePath, '.svelte')
  const hasServer =
    dirFiles.has(`${name}.server.ts`) || dirFiles.has(`${name}.server.js`)
  return hasServer ? 'shared' : 'client'
}

export async function parseSvelteComponents(
  repoRoot: string,
  analyzerVersion: string,
): Promise<{ nodes: ComponentNode[]; edges: IREdge[] }> {
  dirCache.clear()

  const { svelteFiles, serverFiles } = await collectSvelteAndServerFiles(repoRoot)
  if (svelteFiles.length === 0 && serverFiles.length === 0) return { nodes: [], edges: [] }

  const nodes: ComponentNode[] = []
  const edges: IREdge[] = []
  const nodeIdByRelPath = new Map<string, import('@codebase-viz/types').NodeId>()

  const project = new Project({
    compilerOptions: { target: 99, allowJs: true, strict: false },
    useInMemoryFileSystem: true,
  })

  // Build a set of server file paths that have a matching .svelte file
  const svelteBasenames = new Set<string>()
  for (const filePath of svelteFiles) {
    const dir = path.dirname(filePath)
    const name = path.basename(filePath, '.svelte')
    svelteBasenames.add(`${dir}::${name}`)
  }

  // Process .svelte files
  for (const filePath of svelteFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const name = path.basename(filePath, '.svelte')

    const dirFiles = await getDirFiles(path.dirname(filePath))
    const runtime = detectRuntime(filePath, dirFiles)

    const provenance: Provenance = {
      file: relPath,
      line: 1,
      adapter: 'sveltekit-component-parser@0.1',
      analyzerVersion,
    }

    const nodeId = makeNodeId('component', relPath, name)
    nodeIdByRelPath.set(relPath, nodeId)

    const inferenceChain =
      runtime === 'shared'
        ? [`sveltekit: .svelte + .server.{ext} → shared`]
        : [`sveltekit: .svelte file detected → client`]

    nodes.push(
      createComponentNode({
        id: nodeId,
        name,
        filePath: relPath,
        runtime,
        provenance,
        confidence: 'inferred',
        inferenceChain,
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

  // Process server-only files (no matching .svelte counterpart)
  for (const filePath of serverFiles) {
    const dir = path.dirname(filePath)
    const fileName = path.basename(filePath)
    const match = SERVER_FILE_RE.exec(fileName)
    if (match === null) continue
    const baseName = match[1]
    if (baseName === undefined) continue
    const svelteKey = `${dir}::${baseName}`

    // Skip if there is a matching .svelte file (already handled as 'shared')
    if (svelteBasenames.has(svelteKey)) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const name = baseName // e.g. '+page.server'

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
        runtime: 'server',
        provenance,
        confidence: 'inferred',
        inferenceChain: [`sveltekit: .server.{ext} only → server`],
      }),
    )
  }

  return { nodes, edges }
}
