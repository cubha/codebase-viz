import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
  EMPTY_ADAPTER_RESULT,
} from '@codebase-viz/types'
import { parseRemixRoutes } from './parsers/route-parser.js'

export class RemixAdapter implements IAdapter {
  readonly id = 'remix'
  readonly framework = 'remix' as const
  readonly parsingLevel = 'L1' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion } = ctx
    const routeNodes = await parseRemixRoutes(repoRoot, analyzerVersion)
    return { ...EMPTY_ADAPTER_RESULT, routeNodes }
  }
}

export const remixAdapter = new RemixAdapter()
