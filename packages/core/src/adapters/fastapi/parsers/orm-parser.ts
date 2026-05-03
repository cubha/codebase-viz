import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createTableNode,
  makeNodeId,
  type TableNode,
  type ColumnDef,
  type Provenance,
} from '@codebase-viz/types'
import { createPythonParser } from '../../_shared/tree-sitter-loader.js'

const EXCLUDE_DIRS = new Set(['__pycache__', '.git', 'node_modules', 'venv', '.venv', 'env'])
const SQLALCHEMY_BASES = new Set(['Base', 'DeclarativeBase', 'Model'])
const SQLALCHEMY_COLUMN_TYPES = new Set([
  'String', 'Integer', 'Float', 'Boolean', 'DateTime', 'Date', 'Text', 'JSON',
  'BigInteger', 'Numeric', 'LargeBinary', 'UUID', 'Enum',
])

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

export async function parseSqlAlchemyModels(
  repoRoot: string,
  analyzerVersion: string,
): Promise<TableNode[]> {
  const pyFiles = await findPyFiles(repoRoot)
  const modelFiles = pyFiles.filter(f => {
    // check heuristic - will read content below
    return true
  })

  const parser = await createPythonParser()
  const tables: TableNode[] = []

  for (const filePath of modelFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null) continue
    if (!source.includes('Column') && !source.includes('mapped_column')) continue
    if (!source.includes('Base') && !source.includes('DeclarativeBase')) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const tree = parser.parse(source)

    for (let i = 0; i < tree.rootNode.childCount; i++) {
      const node = tree.rootNode.child(i)
      if (node === null || node.type !== 'class_definition') continue

      const nameNode = node.childForFieldName('name')
      if (nameNode === null) continue

      const baseClause = node.childForFieldName('superclasses')
      if (baseClause === null) continue

      let isModel = false
      for (let j = 0; j < baseClause.childCount; j++) {
        const base = baseClause.child(j)
        if (base !== null && SQLALCHEMY_BASES.has(base.text)) {
          isModel = true
          break
        }
      }
      if (!isModel) continue

      const className = nameNode.text
      const columns: ColumnDef[] = []

      const body = node.childForFieldName('body')
      if (body !== null) {
        for (let j = 0; j < body.childCount; j++) {
          const stmt = body.child(j)
          if (stmt === null) continue

          if (stmt.type === 'expression_statement') {
            const assign = stmt.child(0)
            if (assign === null || assign.type !== 'assignment') continue
            const left = assign.childForFieldName('left')
            const right = assign.childForFieldName('right')
            if (left === null || right === null || left.type !== 'identifier') continue

            const fieldName = left.text
            if (right.type !== 'call') continue
            const funcNode = right.childForFieldName('function')
            if (funcNode === null) continue

            const funcName = funcNode.type === 'attribute' ? funcNode.lastChild?.text : funcNode.text
            if (funcName !== 'Column' && funcName !== 'mapped_column') continue

            columns.push({ name: fieldName, type: funcName, nullable: false })
          }
        }
      }

      const provenance: Provenance = {
        file: relPath,
        line: node.startPosition.row + 1,
        adapter: 'sqlalchemy-orm-parser@0.1',
        analyzerVersion,
      }

      if (columns.length === 0) continue

      tables.push(
        createTableNode({
          id: makeNodeId('table', relPath, className),
          name: className,
          columns,
          provenance,
          confidence: 'inferred',
          inferenceChain: [`sqlalchemy: Base subclass ${className} in ${relPath}`],
        }),
      )
    }
  }

  return tables
}
