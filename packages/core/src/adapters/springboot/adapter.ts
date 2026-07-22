import {
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
  EMPTY_ADAPTER_RESULT,
} from '@codebase-viz/types'
import { parseAnnotations } from './parsers/annotation-parser.js'
import { parseSpringComponents } from './parsers/component-parser.js'
import { parseSpringDependencies } from './parsers/di-parser.js'
import { parseJpaEntities } from './parsers/orm-parser.js'
import { parseMybatisMappers } from './parsers/mybatis-parser.js'
import { parseMapperXmlEdges } from './parsers/mapper-xml-parser.js'
import { buildControllerRouteEdges } from './parsers/route-controller-edges.js'
import { parseFeignClients } from './parsers/external-call-extractor.js'
import { buildMapperEdges } from '../_shared/mapper-utils.js'
import { parseFlywayMigrations, mergeFlywayTables } from '../../db/flyway-parser.js'

export class SpringBootAdapter implements IAdapter {
  readonly id = 'springboot'
  readonly framework = 'springboot' as const
  readonly parsingLevel = 'L2' as const
  readonly category = 'BE' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion } = ctx
    const [routeNodes, springComponentNodes, jpaNodes, mybatisNodes, flywayNodes, feignNodes] = await Promise.all([
      parseAnnotations(repoRoot, analyzerVersion).catch(() => []),
      parseSpringComponents(repoRoot, analyzerVersion).catch(() => []),
      parseJpaEntities(repoRoot, analyzerVersion).catch(() => []),
      parseMybatisMappers(repoRoot, analyzerVersion).catch(() => []),
      parseFlywayMigrations(repoRoot, analyzerVersion).catch(() => []),
      parseFeignClients(repoRoot, analyzerVersion).catch(() => []),
    ])
    // C3: Feign 클라이언트를 componentNodes에 먼저 합쳐야 di-parser의 @Autowired 필드-타입명
    // 매칭이 기존 메커니즘 그대로 Feign 클라이언트 주입 지점에도 calls 엣지를 만든다(신규 로직 없음).
    // di-parser의 nameToNode는 이름 기준 last-write-wins라, 우연히 이름이 같은 일반 컴포넌트가
    // 이미 있으면 Feign 노드가 그 항목을 덮어써 거짓 DI 엣지를 만들 위험이 있다(scope-critic 지적).
    // 이름이 이미 다른 의미로 쓰이고 있을 땐 외부시스템으로 단정하지 않고 조용히 제외한다(Evidence-First).
    const springComponentNames = new Set(springComponentNodes.map(n => n.name))
    const safeFeignNodes = feignNodes.filter(n => !springComponentNames.has(n.name))
    const componentNodes = [...springComponentNodes, ...safeFeignNodes]

    const diEdges = await parseSpringDependencies(repoRoot, componentNodes, analyzerVersion).catch(() => [])

    // A-ST3: MyBatis Mapper XML ↔ Repository interface 매칭 → XML 노드 + Repository→XML 엣지.
    const { xmlNodes, xmlEdges } = await parseMapperXmlEdges(repoRoot, componentNodes, analyzerVersion)
      .catch(() => ({ xmlNodes: [], xmlEdges: [] }))
    const allComponentNodes = [...componentNodes, ...xmlNodes]
    const routeHandlesEdges = buildControllerRouteEdges(routeNodes, componentNodes)
    const allServerEdges = [...diEdges, ...xmlEdges, ...routeHandlesEdges]

    const tablesByName = new Map(jpaNodes.map(n => [n.name, n]))
    for (const n of mybatisNodes) {
      const existing = tablesByName.get(n.name)
      if (!existing || (existing.columns.length === 0 && n.columns.length > 0))
        tablesByName.set(n.name, n)
    }
    const ormTables = [...tablesByName.values()]

    // Flyway DDL supplements ORM tables (ORM takes precedence)
    const tableNodes = mergeFlywayTables(ormTables, flywayNodes)

    // buildMapperEdges(파일명 ↔ 테이블)는 XML 노드를 대상에서 제외 — 원본 컴포넌트만 전달.
    const mapperEdges = buildMapperEdges(routeNodes, componentNodes, tableNodes, analyzerVersion)
    return {
      ...EMPTY_ADAPTER_RESULT,
      routeNodes,
      componentNodes: allComponentNodes,
      tableNodes,
      mapperEdges,
      serverEdges: allServerEdges,
    }
  }
}

export const springBootAdapter = new SpringBootAdapter()
