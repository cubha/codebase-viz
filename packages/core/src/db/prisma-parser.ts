import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getSchema } from '@mrleebo/prisma-ast'
import {
  createTableNode,
  makeNodeId,
  type TableNode,
  type ColumnDef,
  type Provenance,
} from '@codebase-viz/types'

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '__pycache__', '.svelte-kit'])
const PRISMA_SCALARS = new Set([
  'String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes',
])

async function findPrismaFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.prisma')) {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

interface PrismaField {
  type: string
  name: string
  fieldType: string
  array: boolean
  optional: boolean
  attributes?: Array<{ type: string; name: string }>
}

function isRelationField(field: PrismaField): boolean {
  if (field.attributes?.some(a => a.name === 'relation')) return true
  if (field.array && !PRISMA_SCALARS.has(field.fieldType)) return true
  return false
}

export async function parsePrismaSchema(
  repoRoot: string,
  analyzerVersion: string,
): Promise<TableNode[]> {
  const schemaFiles = await findPrismaFiles(repoRoot)
  if (schemaFiles.length === 0) return []

  const tables: TableNode[] = []

  for (const schemaPath of schemaFiles) {
    const source = await fs.readFile(schemaPath, 'utf-8').catch(() => null)
    if (source === null) continue

    const relPath = path.relative(repoRoot, schemaPath).replace(/\\/g, '/')
    const provenance: Provenance = {
      file: relPath,
      line: 1,
      adapter: 'prisma-parser@0.1',
      analyzerVersion,
    }

    let schema: ReturnType<typeof getSchema>
    try {
      schema = getSchema(source)
    } catch {
      continue
    }

    for (const item of schema.list) {
      if (item.type !== 'model') continue

      const columns: ColumnDef[] = []
      for (const prop of (item as { properties: PrismaField[] }).properties) {
        if (prop.type !== 'field') continue
        if (isRelationField(prop)) continue

        columns.push({
          name: prop.name,
          type: prop.fieldType,
          nullable: prop.optional,
          isPrimaryKey: prop.attributes?.some(a => a.name === 'id') ?? false,
        })
      }

      tables.push(
        createTableNode({
          id: makeNodeId('table', relPath, (item as { name: string }).name),
          name: (item as { name: string }).name,
          columns,
          provenance,
          confidence: 'inferred',
          inferenceChain: [`prisma: model ${(item as { name: string }).name} in ${relPath}`],
        }),
      )
    }
  }

  return tables
}
