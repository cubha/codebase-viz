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
const DJANGO_FIELD_TYPES = new Set([
  'CharField', 'TextField', 'IntegerField', 'BigIntegerField', 'FloatField', 'DecimalField',
  'BooleanField', 'DateField', 'DateTimeField', 'TimeField', 'EmailField', 'URLField',
  'SlugField', 'UUIDField', 'AutoField', 'BigAutoField', 'ForeignKey', 'OneToOneField',
  'ManyToManyField', 'JSONField', 'PositiveIntegerField', 'SmallIntegerField',
])

async function findModelFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name === 'models.py') {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

function extractStringContent(node: import('web-tree-sitter').SyntaxNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child !== null && child.type === 'string_content') return child.text
  }
  return undefined
}

export async function parseDjangoOrmModels(
  repoRoot: string,
  analyzerVersion: string,
): Promise<TableNode[]> {
  const modelFiles = await findModelFiles(repoRoot)
  if (modelFiles.length === 0) return []

  const parser = await createPythonParser()
  const tables: TableNode[] = []

  for (const filePath of modelFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null || !source.includes('models.Model')) continue

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
        if (base === null) continue
        if (base.text === 'models.Model' || base.text === 'Model') {
          isModel = true
          break
        }
        if (base.type === 'attribute' && base.text.endsWith('.Model')) {
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
          if (stmt === null || stmt.type !== 'expression_statement') continue
          const assign = stmt.child(0)
          if (assign === null || assign.type !== 'assignment') continue

          const left = assign.childForFieldName('left')
          const right = assign.childForFieldName('right')
          if (left === null || right === null) continue
          if (left.type !== 'identifier') continue

          const fieldName = left.text
          if (right.type !== 'call') continue

          const funcNode = right.childForFieldName('function')
          if (funcNode === null) continue

          let fieldTypeName: string | undefined
          if (funcNode.type === 'attribute') {
            const attr = funcNode.lastChild
            if (attr !== null) fieldTypeName = attr.text
          } else if (funcNode.type === 'identifier') {
            fieldTypeName = funcNode.text
          }

          if (fieldTypeName === undefined || !DJANGO_FIELD_TYPES.has(fieldTypeName)) continue

          columns.push({ name: fieldName, type: fieldTypeName, nullable: false })
        }
      }

      const provenance: Provenance = {
        file: relPath,
        line: node.startPosition.row + 1,
        adapter: 'django-orm-parser@0.1',
        analyzerVersion,
      }

      tables.push(
        createTableNode({
          id: makeNodeId('table', relPath, className),
          name: className,
          columns,
          provenance,
          confidence: 'inferred',
          inferenceChain: [`django: models.Model subclass ${className} in ${relPath}`],
        }),
      )
    }
  }

  return tables
}
