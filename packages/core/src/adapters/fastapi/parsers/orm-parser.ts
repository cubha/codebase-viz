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
import {
  extractStringContent,
  parseNullable,
  parsePrimaryKey,
  parseMappedNullable,
  parseColumnType,
  parseForeignKeyRef,
} from '../../_shared/sqlalchemy-utils.js'
import { findPyFiles } from '../../_shared/file-finder.js'

const SQLALCHEMY_BASES = new Set(['Base', 'DeclarativeBase', 'Model'])


export async function parseSqlAlchemyModels(
  repoRoot: string,
  analyzerVersion: string,
): Promise<TableNode[]> {
  const pyFiles = await findPyFiles(repoRoot)
  const parser = await createPythonParser()
  const tables: TableNode[] = []

  for (const filePath of pyFiles) {
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
      let tableName: string = className // 기본값: 클래스명

      const body = node.childForFieldName('body')
      if (body !== null) {
        // 1패스: __tablename__ 추출
        for (let j = 0; j < body.childCount; j++) {
          const stmt = body.child(j)
          if (stmt === null || stmt.type !== 'expression_statement') continue

          const assign = stmt.child(0)
          if (assign === null || assign.type !== 'assignment') continue

          const left = assign.childForFieldName('left')
          const right = assign.childForFieldName('right')
          if (left === null || right === null) continue

          if (left.type === 'identifier' && left.text === '__tablename__') {
            if (right.type === 'string') {
              const extracted = extractStringContent(right)
              if (extracted !== undefined) tableName = extracted
            }
            break
          }
        }

        // 2패스: Column/mapped_column 필드 추출
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
            if (fieldName === '__tablename__') continue
            if (right.type !== 'call') continue
            const funcNode = right.childForFieldName('function')
            if (funcNode === null) continue

            const funcName = funcNode.type === 'attribute' ? funcNode.lastChild?.text : funcNode.text
            if (funcName !== 'Column' && funcName !== 'mapped_column') continue

            const isPrimaryKey = parsePrimaryKey(right)

            const typeAnnotation = assign.childForFieldName('type')
            const mappedNullable = parseMappedNullable(typeAnnotation)
            const nullable = isPrimaryKey ? false : (mappedNullable ?? parseNullable(right))

            const colType = parseColumnType(right, funcName ?? 'Column')
            const argListNode = right.childForFieldName('arguments')
            const fkRef = argListNode !== null ? parseForeignKeyRef(argListNode) : undefined

            columns.push({
              name: fieldName,
              type: colType,
              nullable,
              ...(isPrimaryKey ? { isPrimaryKey: true } : {}),
              ...(fkRef !== undefined ? { references: fkRef } : {}),
            })
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
          name: tableName,
          columns,
          provenance,
          confidence: 'inferred',
          inferenceChain: [`sqlalchemy: Base subclass ${className} in ${relPath}`, `${ORM_CLASS_PREFIX}${className}`],
        }),
      )
    }
  }

  return tables
}
