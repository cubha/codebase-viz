import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
} from '@codebase-viz/types'
import { parseRoutes } from './parsers/route-parser.js'
import { parseSvelteComponents } from './parsers/component-parser.js'
import { detectTsOrmTables } from '../../db/index.js'

export class SvelteKitAdapter implements IAdapter {
  readonly id = 'sveltekit'
  readonly framework = 'sveltekit' as const
  readonly parsingLevel = 'L1' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion } = ctx
    const [routeNodes, components, tableNodes] = await Promise.all([
      parseRoutes(repoRoot, analyzerVersion),
      parseSvelteComponents(repoRoot, analyzerVersion),
      detectTsOrmTables(repoRoot, analyzerVersion),
    ])
    return {
      routeNodes,
      componentNodes: components.nodes,
      componentEdges: components.edges,
      tableNodes,
      mapperEdges: [],
    }
  }
}

export const svelteKitAdapter = new SvelteKitAdapter()
