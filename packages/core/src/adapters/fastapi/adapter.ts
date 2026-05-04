import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
  EMPTY_ADAPTER_RESULT,
} from '@codebase-viz/types'
import { parseDecorators } from './parsers/decorator-parser.js'
import { parseFastapiComponents } from './parsers/component-parser.js'
import { parseSqlAlchemyModels } from './parsers/orm-parser.js'

export class FastApiAdapter implements IAdapter {
  readonly id = 'fastapi'
  readonly framework = 'fastapi' as const
  readonly parsingLevel = 'L2' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion } = ctx
    const [routeNodes, componentNodes, tableNodes] = await Promise.all([
      parseDecorators(repoRoot, analyzerVersion).catch(() => []),
      parseFastapiComponents(repoRoot, analyzerVersion).catch(() => []),
      parseSqlAlchemyModels(repoRoot, analyzerVersion).catch(() => []),
    ])
    return {
      ...EMPTY_ADAPTER_RESULT,
      routeNodes,
      componentNodes,
      tableNodes,
    }
  }
}

export const fastApiAdapter = new FastApiAdapter()
