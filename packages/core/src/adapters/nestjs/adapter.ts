import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
} from '@codebase-viz/types'
import { parseControllers, parseModulesAndProviders } from './parsers/decorator-parser.js'
import { detectTsOrmTables } from '../../db/index.js'
import { buildMapperEdges } from '../_shared/mapper-utils.js'

export class NestJsAdapter implements IAdapter {
  readonly id = 'nestjs'
  readonly framework = 'nestjs' as const
  readonly parsingLevel = 'L2' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion, stack } = ctx
    const hasAnyTsOrm = stack.hasPrisma || stack.hasDrizzle || stack.hasTypeOrm

    const [controllerResult, moduleResult, tableNodes] = await Promise.all([
      parseControllers(repoRoot, analyzerVersion),
      parseModulesAndProviders(repoRoot, analyzerVersion),
      hasAnyTsOrm ? detectTsOrmTables(repoRoot, analyzerVersion) : Promise.resolve([]),
    ])
    const allComponents = [
      ...controllerResult.controllers,
      ...moduleResult.modules,
      ...moduleResult.services,
    ]
    const mapperEdges = buildMapperEdges(controllerResult.routes, allComponents, tableNodes, analyzerVersion)
    return {
      routeNodes: controllerResult.routes,
      componentNodes: allComponents,
      componentEdges: moduleResult.edges,
      tableNodes,
      mapperEdges,
    }
  }
}

export const nestJsAdapter = new NestJsAdapter()
