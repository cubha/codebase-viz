import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getSchema } from '@mrleebo/prisma-ast'
import {
  createTableNode,
  makeNodeId,
  ORM_CLASS_PREFIX,
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

interface PrismaAttributeArg {
  type: string
  value: unknown
}

interface PrismaAttribute {
  type: string
  name: string
  kind?: string
  args?: PrismaAttributeArg[]
}

interface PrismaField {
  type: string
  name: string
  fieldType: string
  array: boolean
  optional: boolean
  attributes?: PrismaAttribute[]
}

// `@map("x")`·`@@map("x")`·`@map(name: "x")` 세 형태 모두 실제 DB 이름을 준다. 인자 값은
// prisma-ast가 따옴표를 포함한 원문 문자열로 넘긴다.
function readMapName(attr: PrismaAttribute | undefined): string | undefined {
  const raw = attr?.args?.[0]?.value
  const text = typeof raw === 'string'
    ? raw
    : typeof raw === 'object' && raw !== null && (raw as { key?: unknown }).key === 'name'
      ? (raw as { value?: unknown }).value
      : undefined
  if (typeof text !== 'string') return undefined
  const m = /^"(.+)"$/.exec(text)
  return m?.[1]
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

      const modelName = (item as { name: string }).name
      const properties = (item as { properties: Array<PrismaField | PrismaAttribute> }).properties
      const modelMap = properties.find(
        (p): p is PrismaAttribute => p.type === 'attribute' && (p as PrismaAttribute).kind === 'object' && p.name === 'map',
      )
      const tableName = readMapName(modelMap) ?? modelName

      const columns: ColumnDef[] = []
      for (const prop of properties) {
        if (prop.type !== 'field') continue
        const field = prop as PrismaField
        if (isRelationField(field)) continue

        columns.push({
          name: readMapName(field.attributes?.find(a => a.name === 'map')) ?? field.name,
          type: field.fieldType,
          nullable: field.optional,
          isPrimaryKey: field.attributes?.some(a => a.name === 'id') ?? false,
        })
      }

      tables.push(
        createTableNode({
          id: makeNodeId('table', relPath, tableName),
          name: tableName,
          columns,
          provenance,
          confidence: 'inferred',
          inferenceChain: [`prisma: model ${modelName} in ${relPath}`, `${ORM_CLASS_PREFIX}${modelName}`],
        }),
      )
    }
  }

  return tables
}
