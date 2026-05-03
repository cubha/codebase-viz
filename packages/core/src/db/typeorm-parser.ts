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

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build'])
const COLUMN_DECORATORS = new Set([
  'Column', 'PrimaryColumn', 'PrimaryGeneratedColumn',
  'CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn',
])

async function findTsFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
        && !entry.name.endsWith('.test.ts')) {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
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
  const allFiles = await findTsFiles(repoRoot)

  const entityFiles: string[] = []
  for (const f of allFiles) {
    const content = await fs.readFile(f, 'utf-8').catch(() => '')
    if (/@Entity\s*[\(\(]/.test(content)) entityFiles.push(f)
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
        if (colDecorator === undefined) continue

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

        columns.push({ name: prop.getName(), type: colType, nullable: false, isPrimaryKey: isPrimary })
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
