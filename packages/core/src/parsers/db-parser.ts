import * as path from 'node:path'
import * as fs from 'node:fs'
import { Project, SyntaxKind, type TypeNode } from 'ts-morph'
import {
  createTableNode,
  makeNodeId,
  type TableNode,
  type ColumnDef,
  type Provenance,
} from '@codebase-viz/types'

const CANDIDATE_PATHS = [
  'src/types/supabase.ts',
  'types/supabase.ts',
  'lib/types/supabase.ts',
]

function normalizeType(rawType: string): string {
  const base = rawType.replace(/\s*\|\s*null/, '').trim()
  const map: Record<string, string> = {
    string: 'text',
    number: 'int8',
    boolean: 'bool',
  }
  return map[base] ?? base
}

function extractStringLiteral(typeNode: TypeNode): string | undefined {
  if (!typeNode.isKind(SyntaxKind.LiteralType)) return undefined
  const literal = typeNode.asKindOrThrow(SyntaxKind.LiteralType).getLiteral()
  const text = literal.getText()
  if (text.startsWith('"') || text.startsWith("'")) {
    return text.slice(1, -1)
  }
  return undefined
}

export async function parseTables(repoRoot: string): Promise<TableNode[]> {
  let supabaseTypePath: string | undefined
  for (const candidate of CANDIDATE_PATHS) {
    const p = path.join(repoRoot, candidate)
    if (fs.existsSync(p)) {
      supabaseTypePath = p
      break
    }
  }

  if (supabaseTypePath === undefined) {
    return []
  }

  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const sourceFile = project.addSourceFileAtPath(supabaseTypePath)

  const databaseType = sourceFile.getTypeAlias('Database')
  if (databaseType === undefined) return []

  const dbTypeNode = databaseType.getTypeNode()
  if (dbTypeNode === undefined || !dbTypeNode.isKind(SyntaxKind.TypeLiteral)) return []
  const dbTypeLiteral = dbTypeNode.asKindOrThrow(SyntaxKind.TypeLiteral)

  const publicProp = dbTypeLiteral.getProperty('public')
  if (publicProp === undefined) return []
  const publicTypeNode = publicProp.getTypeNode()
  if (publicTypeNode === undefined || !publicTypeNode.isKind(SyntaxKind.TypeLiteral)) return []
  const publicTypeLiteral = publicTypeNode.asKindOrThrow(SyntaxKind.TypeLiteral)

  const tablesProp = publicTypeLiteral.getProperty('Tables')
  if (tablesProp === undefined) return []
  const tablesTypeNode = tablesProp.getTypeNode()
  if (tablesTypeNode === undefined || !tablesTypeNode.isKind(SyntaxKind.TypeLiteral)) return []
  const tablesTypeLiteral = tablesTypeNode.asKindOrThrow(SyntaxKind.TypeLiteral)

  const repoRelativePath = path.relative(repoRoot, supabaseTypePath)
  const provenance: Provenance = {
    file: repoRelativePath,
    line: 1,
    adapter: 'supabase-types@0.1',
    analyzerVersion: 'codebase-viz@0.1.0',
  }

  const tables: TableNode[] = []

  for (const tableProp of tablesTypeLiteral.getProperties()) {
    const tableName = tableProp.getName()
    const tableTypeNode = tableProp.getTypeNode()
    if (tableTypeNode === undefined || !tableTypeNode.isKind(SyntaxKind.TypeLiteral)) continue
    const tableTypeLiteral = tableTypeNode.asKindOrThrow(SyntaxKind.TypeLiteral)

    // Build FK map from Relationships before processing Row
    const fkMap = new Map<string, { table: string; column: string }>()
    const relProp = tableTypeLiteral.getProperty('Relationships')
    if (relProp !== undefined) {
      const relTypeNode = relProp.getTypeNode()
      if (relTypeNode !== undefined && relTypeNode.isKind(SyntaxKind.TupleType)) {
        for (const element of relTypeNode.asKindOrThrow(SyntaxKind.TupleType).getElements()) {
          if (!element.isKind(SyntaxKind.TypeLiteral)) continue
          const relLiteral = element.asKindOrThrow(SyntaxKind.TypeLiteral)

          const colsProp = relLiteral.getProperty('columns')
          const refRelProp = relLiteral.getProperty('referencedRelation')
          const refColsProp = relLiteral.getProperty('referencedColumns')
          if (colsProp === undefined || refRelProp === undefined || refColsProp === undefined) continue

          const colsTypeNode = colsProp.getTypeNode()
          if (colsTypeNode === undefined || !colsTypeNode.isKind(SyntaxKind.TupleType)) continue
          const firstColEl = colsTypeNode.asKindOrThrow(SyntaxKind.TupleType).getElements()[0]
          if (firstColEl === undefined) continue
          const fkColName = extractStringLiteral(firstColEl)
          if (fkColName === undefined) continue

          const refRelTypeNode = refRelProp.getTypeNode()
          if (refRelTypeNode === undefined) continue
          const refTableName = extractStringLiteral(refRelTypeNode)
          if (refTableName === undefined) continue

          const refColsTypeNode = refColsProp.getTypeNode()
          if (refColsTypeNode === undefined || !refColsTypeNode.isKind(SyntaxKind.TupleType)) continue
          const firstRefColEl = refColsTypeNode.asKindOrThrow(SyntaxKind.TupleType).getElements()[0]
          if (firstRefColEl === undefined) continue
          const refColName = extractStringLiteral(firstRefColEl)
          if (refColName === undefined) continue

          fkMap.set(fkColName, { table: refTableName, column: refColName })
        }
      }
    }

    // Parse Row columns
    const rowProp = tableTypeLiteral.getProperty('Row')
    if (rowProp === undefined) continue
    const rowTypeNode = rowProp.getTypeNode()
    if (rowTypeNode === undefined || !rowTypeNode.isKind(SyntaxKind.TypeLiteral)) continue
    const rowTypeLiteral = rowTypeNode.asKindOrThrow(SyntaxKind.TypeLiteral)

    const columns: ColumnDef[] = []
    for (const colProp of rowTypeLiteral.getProperties()) {
      const colName = colProp.getName()
      const colTypeNode = colProp.getTypeNode()
      if (colTypeNode === undefined) continue

      const rawType = colTypeNode.getText()
      const nullable = rawType.includes('| null') || rawType.includes('null |')
      const fk = fkMap.get(colName)

      const col: ColumnDef = {
        name: colName,
        type: normalizeType(rawType),
        nullable,
        ...(colName === 'id' ? { isPrimaryKey: true } : {}),
        ...(fk !== undefined ? { references: fk } : {}),
      }
      columns.push(col)
    }

    tables.push(
      createTableNode({
        id: makeNodeId('table', repoRelativePath, tableName),
        name: tableName,
        columns,
        provenance,
        confidence: 'verified',
      }),
    )
  }

  return tables
}
