import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createComponentNode,
  makeNodeId,
  type ComponentNode,
  type Provenance,
} from '@codebase-viz/types'
import { createPythonParser } from '../../_shared/tree-sitter-loader.js'

const EXCLUDE_DIRS = new Set(['__pycache__', '.git', 'node_modules', 'venv', '.venv', 'env'])

async function findPyFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

export async function parseFastapiComponents(
  repoRoot: string,
  analyzerVersion: string,
): Promise<ComponentNode[]> {
  const pyFiles = await findPyFiles(repoRoot)
  if (pyFiles.length === 0) return []

  const parser = await createPythonParser()
  const nodes: ComponentNode[] = []

  for (const filePath of pyFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null) continue
    if (!source.includes('BaseModel') && !source.includes('APIRouter')) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const tree = parser.parse(source)

    for (let i = 0; i < tree.rootNode.childCount; i++) {
      const node = tree.rootNode.child(i)
      if (node === null || node.type !== 'class_definition') continue

      const nameNode = node.childForFieldName('name')
      if (nameNode === null) continue
      const className = nameNode.text

      const baseClause = node.childForFieldName('superclasses')
      if (baseClause === null) continue

      let isModel = false
      for (let j = 0; j < baseClause.childCount; j++) {
        const base = baseClause.child(j)
        if (base !== null && (base.text === 'BaseModel' || base.text.endsWith('Schema'))) {
          isModel = true
          break
        }
      }
      if (!isModel) continue

      const provenance: Provenance = {
        file: relPath,
        line: node.startPosition.row + 1,
        adapter: 'fastapi-component-parser@0.1',
        analyzerVersion,
      }

      nodes.push(
        createComponentNode({
          id: makeNodeId('component', relPath, className),
          name: className,
          filePath: relPath,
          runtime: 'server',
          provenance,
          confidence: 'inferred',
          inferenceChain: [`fastapi: BaseModel subclass ${className} in ${relPath}`],
        }),
      )
    }
  }

  return nodes
}
