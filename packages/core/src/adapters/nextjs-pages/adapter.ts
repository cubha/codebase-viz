import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
  EMPTY_ADAPTER_RESULT,
} from '@codebase-viz/types'
import { parseNextPagesRoutes } from './parsers/route-parser.js'

export class NextJsPagesAdapter implements IAdapter {
  readonly id = 'nextjs-pages'
  readonly framework = 'nextjs-pages' as const
  readonly parsingLevel = 'L1' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion } = ctx
    const routeNodes = await parseNextPagesRoutes(repoRoot, analyzerVersion)
    return { ...EMPTY_ADAPTER_RESULT, routeNodes }
  }
}

export const nextJsPagesAdapter = new NextJsPagesAdapter()
