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

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.svelte-kit'])
const TABLE_FUNCS = new Set(['pgTable', 'sqliteTable', 'mysqlTable', 'table'])

async function findTsFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
        && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts')) {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

function resolveChainRoot(node: import('ts-morph').Node): string | null {
  let cur = node
  while (cur.isKind(SyntaxKind.CallExpression)) {
    const expr = cur.asKindOrThrow(SyntaxKind.CallExpression).getExpression()
    if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
      cur = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression()
    } else if (expr.isKind(SyntaxKind.Identifier)) {
      return expr.getText()
    } else {
      break
    }
  }
  if (cur.isKind(SyntaxKind.Identifier)) return cur.getText()
  return null
}

export async function parseDrizzleSchema(
  repoRoot: string,
  analyzerVersion: string,
): Promise<TableNode[]> {
  const allFiles = await findTsFiles(repoRoot)

  const drizzleFiles: string[] = []
  for (const f of allFiles) {
    const content = await fs.readFile(f, 'utf-8').catch(() => '')
    if (/\b(pgTable|sqliteTable|mysqlTable)\s*\(/.test(content)) {
      drizzleFiles.push(f)
    }
  }
  if (drizzleFiles.length === 0) return []

  const project = new Project({
    compilerOptions: { target: 99, allowJs: false, strict: false },
    skipAddingFilesFromTsConfig: true,
  })
  for (const f of drizzleFiles) project.addSourceFileAtPath(f)

  const tables: TableNode[] = []

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const provenance: Provenance = {
      file: relPath,
      line: 1,
      adapter: 'drizzle-parser@0.1',
      analyzerVersion,
    }

    for (const varDecl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = varDecl.getInitializer()
      if (!init?.isKind(SyntaxKind.CallExpression)) continue

      const callExpr = init.asKindOrThrow(SyntaxKind.CallExpression)
      const funcName = callExpr.getExpression().getText()
      if (!TABLE_FUNCS.has(funcName)) continue

      const args = callExpr.getArguments()
      if (args.length < 2) continue
      if (!args[0]!.isKind(SyntaxKind.StringLiteral)) continue

      const tableName = args[0]!.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()

      const columns: ColumnDef[] = []
      const secondArg = args[1]!

      let objLiteral: import('ts-morph').Node | undefined
      if (secondArg.isKind(SyntaxKind.ObjectLiteralExpression)) {
        objLiteral = secondArg
      } else if (secondArg.isKind(SyntaxKind.ArrowFunction)) {
        const body = secondArg.asKindOrThrow(SyntaxKind.ArrowFunction).getBody()
        if (body.isKind(SyntaxKind.ParenthesizedExpression)) {
          objLiteral = body.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression()
        }
      }

      if (objLiteral?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        for (const prop of objLiteral.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperties()) {
          if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue
          const pa = prop.asKindOrThrow(SyntaxKind.PropertyAssignment)
          const init2 = pa.getInitializer()
          if (init2 === undefined) continue
          const colType = resolveChainRoot(init2) ?? 'unknown'
          columns.push({ name: pa.getName(), type: colType, nullable: false })
        }
      }

      tables.push(
        createTableNode({
          id: makeNodeId('table', relPath, tableName),
          name: tableName,
          columns,
          provenance,
          confidence: 'inferred',
          inferenceChain: [`drizzle: ${funcName}('${tableName}') in ${relPath}`],
        }),
      )
    }
  }

  return tables
}
