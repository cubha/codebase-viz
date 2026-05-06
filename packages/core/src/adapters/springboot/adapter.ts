import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
  EMPTY_ADAPTER_RESULT,
} from '@codebase-viz/types'
import { parseAnnotations } from './parsers/annotation-parser.js'
import { parseSpringComponents } from './parsers/component-parser.js'
import { parseJpaEntities } from './parsers/orm-parser.js'
import { parseMybatisMappers } from './parsers/mybatis-parser.js'
import { buildMapperEdges } from '../_shared/mapper-utils.js'

export class SpringBootAdapter implements IAdapter {
  readonly id = 'springboot'
  readonly framework = 'springboot' as const
  readonly parsingLevel = 'L2' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion } = ctx
    const [routeNodes, componentNodes, jpaNodes, mybatisNodes] = await Promise.all([
      parseAnnotations(repoRoot, analyzerVersion).catch(() => []),
      parseSpringComponents(repoRoot, analyzerVersion).catch(() => []),
      parseJpaEntities(repoRoot, analyzerVersion).catch(() => []),
      parseMybatisMappers(repoRoot, analyzerVersion).catch(() => []),
    ])

    // Merge: JPA nodes take precedence (more columns), MyBatis supplements missing tables
    const tablesByName = new Map(jpaNodes.map(n => [n.name, n]))
    for (const n of mybatisNodes) {
      const existing = tablesByName.get(n.name)
      if (!existing || (existing.columns.length === 0 && n.columns.length > 0))
        tablesByName.set(n.name, n)
    }
    const tableNodes = [...tablesByName.values()]
    const mapperEdges = buildMapperEdges(routeNodes, componentNodes, tableNodes, analyzerVersion)
    return {
      ...EMPTY_ADAPTER_RESULT,
      routeNodes,
      componentNodes,
      tableNodes,
      mapperEdges,
    }
  }
}

export const springBootAdapter = new SpringBootAdapter()
