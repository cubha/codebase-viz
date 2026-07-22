import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'
import {
  createTableNode,
  makeNodeId,
  type TableNode,
  type ColumnDef,
  type Provenance,
} from '@codebase-viz/types'
import { findTsFiles } from '../adapters/_shared/file-finder.js'

const COLUMN_DECORATORS = new Set([
  'Column', 'PrimaryColumn', 'PrimaryGeneratedColumn',
  'CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn',
])
const RELATION_DECORATORS = new Set(['ManyToOne', 'OneToOne'])

function resolveColumnNullable(
  prop: import('ts-morph').PropertyDeclaration,
  isPrimary: boolean,
  colDecorator: import('ts-morph').Decorator,
): boolean {
  if (isPrimary) return false

  const args = colDecorator.getArguments()
  if (args.length > 0) {
    const first = args[0]!
    if (first.isKind(SyntaxKind.ObjectLiteralExpression)) {
      const nullableProp = first.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('nullable')
      if (nullableProp?.isKind(SyntaxKind.PropertyAssignment)) {
        const init = nullableProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
        if (init?.isKind(SyntaxKind.TrueKeyword)) return true
        if (init?.isKind(SyntaxKind.FalseKeyword)) return false
      }
    }
  }

  if (prop.hasQuestionToken()) return true
  const typeText = prop.getTypeNode()?.getText() ?? ''
  if (typeText.includes('| null') || typeText.includes('| undefined') ||
      typeText.includes('null |') || typeText.includes('undefined |')) return true

  return false
}

function resolveEntityName(cls: import('ts-morph').ClassDeclaration): string {
  const decorator = cls.getDecorators().find(d => d.getName() === 'Entity')
  if (decorator === undefined) return cls.getName() ?? 'unknown'
  const args = decorator.getArguments()
  if (args.length === 0) return (cls.getName() ?? 'unknown').toLowerCase()
  const first = args[0]!
  if (first.isKind(SyntaxKind.StringLiteral)) {
    return first.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
  }
  if (first.isKind(SyntaxKind.ObjectLiteralExpression)) {
    const nameProp = first.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('name')
    if (nameProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const init = nameProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (init?.isKind(SyntaxKind.StringLiteral)) {
        return init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
      }
    }
  }
  return (cls.getName() ?? 'unknown').toLowerCase()
}

export async function parseTypeOrmEntities(
  repoRoot: string,
  analyzerVersion: string,
): Promise<TableNode[]> {
  const allFiles = await findTsFiles(repoRoot, { includeTsx: false, excludeDeclarations: true, excludeTests: true })

  const entityFiles: string[] = []
  for (const f of allFiles) {
    const content = await fs.readFile(f, 'utf-8').catch(() => '')
    if (/@Entity\s*\(/.test(content)) entityFiles.push(f)
  }
  if (entityFiles.length === 0) return []

  const project = new Project({
    compilerOptions: {
      target: 99,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      allowJs: false,
      strict: false,
    },
    skipAddingFilesFromTsConfig: true,
  })
  for (const f of entityFiles) project.addSourceFileAtPath(f)

  const tables: TableNode[] = []

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')

    for (const cls of sourceFile.getClasses()) {
      if (!cls.getDecorators().some(d => d.getName() === 'Entity')) continue

      const tableName = resolveEntityName(cls)
      const columns: ColumnDef[] = []

      const provenance: Provenance = {
        file: relPath,
        line: cls.getStartLineNumber(),
        adapter: 'typeorm-parser@0.1',
        analyzerVersion,
      }

      for (const prop of cls.getProperties()) {
        const colDecorator = prop.getDecorators().find(d => COLUMN_DECORATORS.has(d.getName()))
        if (colDecorator !== undefined) {
          let colType = prop.getTypeNode()?.getText() ?? 'unknown'
          const isPrimary = colDecorator.getName() === 'PrimaryColumn'
            || colDecorator.getName() === 'PrimaryGeneratedColumn'

          const args = colDecorator.getArguments()
          if (args.length > 0) {
            const first = args[0]!
            if (first.isKind(SyntaxKind.StringLiteral)) {
              colType = first.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
            } else if (first.isKind(SyntaxKind.ObjectLiteralExpression)) {
              const typeProp = first.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('type')
              if (typeProp?.isKind(SyntaxKind.PropertyAssignment)) {
                const init = typeProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
                if (init?.isKind(SyntaxKind.StringLiteral)) {
                  colType = init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
                }
              }
            }
          }

          const nullable = resolveColumnNullable(prop, isPrimary, colDecorator)
          columns.push({ name: prop.getName(), type: colType, nullable, isPrimaryKey: isPrimary })
          continue
        }

        const relDecorator = prop.getDecorators().find(d => RELATION_DECORATORS.has(d.getName()))
        if (relDecorator !== undefined) {
          const args = relDecorator.getArguments()
          const first = args[0]
          let targetEntity: string | undefined
          if (first !== undefined) {
            if (first.isKind(SyntaxKind.ArrowFunction)) {
              const arrowFn = first.asKindOrThrow(SyntaxKind.ArrowFunction)
              const body = arrowFn.getBody()
              if (body.isKind(SyntaxKind.Identifier)) {
                targetEntity = body.getText()
              } else if (body.isKind(SyntaxKind.Block)) {
                const returnStmt = body.getStatements().find(s => s.isKind(SyntaxKind.ReturnStatement))
                const expr = returnStmt?.asKind(SyntaxKind.ReturnStatement)?.getExpression()
                if (expr?.isKind(SyntaxKind.Identifier)) targetEntity = expr.getText()
              }
            } else {
              const text = first.getText()
              const m = text.match(/=>\s*(\w+)/)
              if (m !== null) targetEntity = m[1]!
            }
          }
          if (targetEntity !== undefined) {
            columns.push({
              name: prop.getName(),
              type: relDecorator.getName(),
              nullable: true,
              references: { table: targetEntity, column: 'id' },
            })
          }
        }
      }

      tables.push(
        createTableNode({
          id: makeNodeId('table', relPath, tableName),
          name: tableName,
          columns,
          provenance,
          confidence: 'inferred',
          inferenceChain: [`typeorm: @Entity('${tableName}') in ${relPath}`],
        }),
      )
    }
  }

  return tables
}
