import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
  EMPTY_ADAPTER_RESULT,
} from '@codebase-viz/types'
import { parseReactRouterFull } from './parsers/route-parser.js'

export class ReactRouterAdapter implements IAdapter {
  readonly id = 'react-router'
  readonly framework = 'react-router' as const
  readonly parsingLevel = 'L2' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion } = ctx
    const { routeNodes, componentNodes, rendersEdges } = await parseReactRouterFull(repoRoot, analyzerVersion)
    return {
      ...EMPTY_ADAPTER_RESULT,
      routeNodes,
      componentNodes,
      componentEdges: rendersEdges,
    }
  }
}

export const reactRouterAdapter = new ReactRouterAdapter()
