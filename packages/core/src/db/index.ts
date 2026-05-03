import { parsePrismaSchema } from './prisma-parser.js'
import { parseDrizzleSchema } from './drizzle-parser.js'
import { parseTypeOrmEntities } from './typeorm-parser.js'
import type { TableNode } from '@codebase-viz/types'

export { parsePrismaSchema } from './prisma-parser.js'
export { parseDrizzleSchema } from './drizzle-parser.js'
export { parseTypeOrmEntities } from './typeorm-parser.js'

export async function detectTsOrmTables(
  repoRoot: string,
  analyzerVersion: string,
): Promise<TableNode[]> {
  const [prisma, drizzle, typeorm] = await Promise.all([
    parsePrismaSchema(repoRoot, analyzerVersion).catch(() => [] as TableNode[]),
    parseDrizzleSchema(repoRoot, analyzerVersion).catch(() => [] as TableNode[]),
    parseTypeOrmEntities(repoRoot, analyzerVersion).catch(() => [] as TableNode[]),
  ])
  return [...prisma, ...drizzle, ...typeorm]
}
