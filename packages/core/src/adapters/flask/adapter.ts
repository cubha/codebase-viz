import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
} from '@codebase-viz/types'
import { parseFlaskRoutes } from './parsers/route-parser.js'
import { parseFlaskSqlAlchemyModels } from './parsers/orm-parser.js'
import { detectTsOrmTables } from '../../db/index.js'
import { buildMapperEdges } from '../_shared/mapper-utils.js'

export class FlaskAdapter implements IAdapter {
  readonly id = 'flask'
  readonly framework = 'flask' as const
  readonly parsingLevel = 'L2' as const
  readonly category = 'BE' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion, stack } = ctx
    const hasAnyTsOrm = stack.hasSupabase || stack.hasPrisma || stack.hasDrizzle || stack.hasTypeOrm
    const hasSQLAlchemy = stack.hasSQLAlchemy === true

    const [routeNodes, tableNodes, tsTables] = await Promise.all([
      parseFlaskRoutes(repoRoot, analyzerVersion),
      hasSQLAlchemy ? parseFlaskSqlAlchemyModels(repoRoot, analyzerVersion) : Promise.resolve([]),
      hasAnyTsOrm ? detectTsOrmTables(repoRoot, analyzerVersion) : Promise.resolve([]),
    ])
    const allTables = [...tableNodes, ...tsTables]
    const mapperEdges = buildMapperEdges(routeNodes, [], allTables, analyzerVersion)
    return { routeNodes, componentNodes: [], componentEdges: [], tableNodes: allTables, mapperEdges }
  }
}

export const flaskAdapter = new FlaskAdapter()
