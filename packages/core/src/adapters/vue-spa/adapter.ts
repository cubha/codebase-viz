import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
  EMPTY_ADAPTER_RESULT,
} from '@codebase-viz/types'
import { parseVueRoutes } from './parsers/route-parser.js'

export class VueSpaAdapter implements IAdapter {
  readonly id = 'vue-spa'
  readonly framework = 'vue-spa' as const
  readonly parsingLevel = 'L2' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion } = ctx
    const routeNodes = await parseVueRoutes(repoRoot, analyzerVersion)
    return { ...EMPTY_ADAPTER_RESULT, routeNodes }
  }
}

export const vueSpaAdapter = new VueSpaAdapter()
