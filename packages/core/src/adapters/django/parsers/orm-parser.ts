import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createTableNode,
  makeNodeId,
  type TableNode,
  type ColumnDef,
  type Provenance,
  ORM_CLASS_PREFIX,
} from '@codebase-viz/types'
import { createPythonParser } from '../../_shared/tree-sitter-loader.js'
import { walkDir, PY_EXCLUDE_DIRS } from '../../_shared/file-finder.js'

const DJANGO_FIELD_TYPES = new Set([
  'CharField', 'TextField', 'IntegerField', 'BigIntegerField', 'FloatField', 'DecimalField',
  'BooleanField', 'DateField', 'DateTimeField', 'TimeField', 'EmailField', 'URLField',
  'SlugField', 'UUIDField', 'AutoField', 'BigAutoField', 'ForeignKey', 'OneToOneField',
  'ManyToManyField', 'JSONField', 'PositiveIntegerField', 'SmallIntegerField',
])

async function findModelFiles(repoRoot: string): Promise<string[]> {
  return walkDir(repoRoot, {
    excludeDirs: PY_EXCLUDE_DIRS,
    nameFilter: n => n === 'models.py',
  })
}

function extractStringContent(node: import('web-tree-sitter').SyntaxNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child !== null && child.type === 'string_content') return child.text
  }
  return undefined
}

const RELATION_FIELDS = new Set(['ForeignKey', 'OneToOneField', 'ManyToManyField'])

function extractNullable(argListNode: import('web-tree-sitter').SyntaxNode | null): boolean {
  if (argListNode === null) return false
  for (let i = 0; i < argListNode.namedChildCount; i++) {
    const arg = argListNode.namedChild(i)
    if (arg === null || arg.type !== 'keyword_argument') continue
    const nameNode = arg.childForFieldName('name')
    const valueNode = arg.childForFieldName('value')
    if (nameNode?.text === 'null' && valueNode?.text === 'True') return true
  }
  return false
}

function extractRelationTarget(argListNode: import('web-tree-sitter').SyntaxNode | null): string | undefined {
  if (argListNode === null) return undefined
  for (let i = 0; i < argListNode.namedChildCount; i++) {
    const arg = argListNode.namedChild(i)
    if (arg === null) continue
    // keyword_argument는 건너뜀 (positional argument만)
    if (arg.type === 'keyword_argument') continue
    // string 노드
    if (arg.type === 'string') {
      const content = extractStringContent(arg)
      if (content !== undefined) {
        // 'app.Model' 형태에서 마지막 세그먼트만
        const parts = content.split('.')
        return parts[parts.length - 1]
      }
    }
    // identifier 노드
    if (arg.type === 'identifier') {
      return arg.text
    }
    // attribute 노드 (e.g. auth.User)
    if (arg.type === 'attribute') {
      const parts = arg.text.split('.')
      return parts[parts.length - 1]
    }
  }
  return undefined
}

function extractDbTable(bodyNode: import('web-tree-sitter').SyntaxNode): string | undefined {
  for (let i = 0; i < bodyNode.childCount; i++) {
    const child = bodyNode.child(i)
    if (child === null || child.type !== 'class_definition') continue
    const nameNode = child.childForFieldName('name')
    if (nameNode === null || nameNode.text !== 'Meta') continue
    // Meta 클래스 바디 탐색
    const metaBody = child.childForFieldName('body')
    if (metaBody === null) continue
    for (let j = 0; j < metaBody.childCount; j++) {
      const stmt = metaBody.child(j)
      if (stmt === null || stmt.type !== 'expression_statement') continue
      const assign = stmt.child(0)
      if (assign === null || assign.type !== 'assignment') continue
      const left = assign.childForFieldName('left')
      const right = assign.childForFieldName('right')
      if (left === null || right === null) continue
      if (left.text !== 'db_table') continue
      // string 노드에서 값 추출
      if (right.type === 'string') {
        return extractStringContent(right)
      }
    }
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
      let tableName = className

      if (body !== null) {
        // Meta 클래스에서 db_table 추출
        const dbTable = extractDbTable(body)
        if (dbTable !== undefined) tableName = dbTable

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

          const argListNode = right.childForFieldName('arguments')
          const nullable = extractNullable(argListNode)

          let resolvedType = fieldTypeName
          let references: { table: string; column: string } | undefined
          if (RELATION_FIELDS.has(fieldTypeName)) {
            const target = extractRelationTarget(argListNode)
            if (target !== undefined) {
              resolvedType = `${fieldTypeName}→${target}`
              references = { table: target, column: 'id' }
            }
          }

          columns.push({
            name: fieldName,
            type: resolvedType,
            nullable,
            ...(references !== undefined ? { references } : {}),
          })
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
          id: makeNodeId('table', relPath, tableName),
          name: tableName,
          columns,
          provenance,
          confidence: 'inferred',
          inferenceChain: [`django: models.Model subclass ${className} in ${relPath}`, `${ORM_CLASS_PREFIX}${className}`],
        }),
      )
    }
  }

  return tables
}
