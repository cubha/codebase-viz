import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
  EMPTY_ADAPTER_RESULT,
} from '@codebase-viz/types'
import { parseAngularRoutes } from './parsers/route-parser.js'

export class AngularAdapter implements IAdapter {
  readonly id = 'angular'
  readonly framework = 'angular' as const
  readonly parsingLevel = 'L2' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion } = ctx
    const routeNodes = await parseAngularRoutes(repoRoot, analyzerVersion)
    return { ...EMPTY_ADAPTER_RESULT, routeNodes }
  }
}

export const angularAdapter = new AngularAdapter()
