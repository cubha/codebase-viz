import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
  EMPTY_ADAPTER_RESULT,
} from '@codebase-viz/types'
import { parseUrls } from './parsers/urls-parser.js'
import { parseDjangoComponents } from './parsers/component-parser.js'
import { parseDjangoOrmModels } from './parsers/orm-parser.js'

export class DjangoAdapter implements IAdapter {
  readonly id = 'django'
  readonly framework = 'django' as const
  readonly parsingLevel = 'L1' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion } = ctx
    const [routeNodes, componentNodes, tableNodes] = await Promise.all([
      parseUrls(repoRoot, analyzerVersion),
      parseDjangoComponents(repoRoot, analyzerVersion),
      parseDjangoOrmModels(repoRoot, analyzerVersion),
    ])
    return {
      ...EMPTY_ADAPTER_RESULT,
      routeNodes,
      componentNodes,
      tableNodes,
    }
  }
}

export const djangoAdapter = new DjangoAdapter()
