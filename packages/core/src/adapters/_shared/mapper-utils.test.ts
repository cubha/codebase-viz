import { describe, it, expect } from 'vitest'
import {
  makeNodeId,
  createRouteNode,
  createComponentNode,
  createTableNode,
  ORM_CLASS_PREFIX,
  type Provenance,
} from '@codebase-viz/types'
import { buildMapperEdges } from './mapper-utils.js'

const provenance: Provenance = {
  file: 'src/routes/user.ts',
  line: 1,
  adapter: 'sveltekit@0.1',
  analyzerVersion: 'codebase-viz@0.1.0',
}

function makeRoute(filePath: string) {
  return createRouteNode({
    id: makeNodeId('route', filePath, 'page'),
    path: '/' + filePath,
    filePath,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    provenance: { ...provenance, file: filePath },
    confidence: 'verified',
  })
}

function makeComponent(filePath: string) {
  return createComponentNode({
    id: makeNodeId('component', filePath, 'UserComp'),
    name: 'UserComp',
    filePath,
    runtime: 'server',
    provenance: { ...provenance, file: filePath },
    confidence: 'verified',
  })
}

function makeTable(name: string) {
  return createTableNode({
    id: makeNodeId('table', `schema/${name}.ts`, name),
    name,
    columns: [],
    provenance: { ...provenance, file: `schema/${name}.ts` },
    confidence: 'verified',
  })
}

describe('buildMapperEdges', () => {
  it('tables가 없으면 빈 배열을 반환한다', () => {
    const route = makeRoute('src/routes/user.ts')
    const result = buildMapperEdges([route], [], [], 'codebase-viz@0.1.0')
    expect(result).toEqual([])
  })

  it('routes와 components가 모두 없으면 빈 배열을 반환한다', () => {
    const table = makeTable('user')
    const result = buildMapperEdges([], [], [table], 'codebase-viz@0.1.0')
    expect(result).toEqual([])
  })

  it('table name이 route filePath에 포함되면 edge를 생성한다', () => {
    const route = makeRoute('src/routes/user.ts')
    const table = makeTable('user')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result).toHaveLength(1)
  })

  it('생성된 edge의 kind가 queries이다', () => {
    const route = makeRoute('src/routes/user.ts')
    const table = makeTable('user')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result[0]?.kind).toBe('queries')
  })

  it('생성된 edge의 confidence가 inferred이다', () => {
    const route = makeRoute('src/routes/user.ts')
    const table = makeTable('user')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    const edge = result[0]
    expect(edge?.confidence).toBe('inferred')
  })

  it('inferenceChain이 포함되어 있다', () => {
    const route = makeRoute('src/routes/user.ts')
    const table = makeTable('user')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    const edge = result[0]
    if (edge?.confidence === 'inferred') {
      expect(edge.inferenceChain.length).toBeGreaterThan(0)
    } else {
      throw new Error('expected inferred edge')
    }
  })

  it('table name이 component filePath에 포함되면 edge를 생성한다', () => {
    const component = makeComponent('src/components/users.svelte')
    const table = makeTable('users')
    const result = buildMapperEdges([], [component], [table], 'codebase-viz@0.1.0')
    expect(result).toHaveLength(1)
    expect(result[0]?.kind).toBe('queries')
  })

  it('table name이 filePath에 없으면 edge를 생성하지 않는다', () => {
    const route = makeRoute('src/routes/dashboard.ts')
    const table = makeTable('orders')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result).toEqual([])
  })

  it('edge from이 route id, to가 table id이다', () => {
    const route = makeRoute('src/routes/user.ts')
    const table = makeTable('user')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result[0]?.from).toBe(route.id)
    expect(result[0]?.to).toBe(table.id)
  })

  it('superusers 파일명은 users 테이블과 매칭 안 됨 (토큰 경계)', () => {
    const route = makeRoute('src/routes/superusers.ts')
    const table = makeTable('users')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result).toEqual([])
  })

  it('디렉토리 경로 매칭은 하지 않음 — route.ts in users/ dir는 users 테이블과 무관', () => {
    const route = makeRoute('src/modules/users/route.ts')
    const table = makeTable('users')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result).toEqual([])
  })

  it('PascalCase 테이블명이 kebab-case 파일명과 매칭된다 (N-8)', () => {
    const route = makeRoute('src/routes/user-profile.ts')
    const table = makeTable('UserProfile')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result).toHaveLength(1)
  })

  it('PascalCase 테이블명이 snake_case 파일명과 매칭된다 (N-8)', () => {
    const route = makeRoute('src/routes/user_profile.ts')
    const table = makeTable('UserProfile')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result).toHaveLength(1)
  })

  it('snake_case 테이블명이 kebab-case 파일명과 매칭된다 (N-8)', () => {
    const route = makeRoute('src/routes/user-profile.ts')
    const table = makeTable('user_profile')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result).toHaveLength(1)
  })

  // v1.2.68: Prisma `@@map` 모델은 테이블명이 DB 이름(tb_account)으로 바뀌었다. 파일명은 코드가 부르는
  // 모델명(Account)을 따르므로, v1.2.67까지 성립하던 모델명 매칭이 끊기지 않게 보존한다.
  it('Prisma @@map 테이블은 모델명(센티넬)으로도 파일명 매칭한다', () => {
    const route = makeRoute('src/routes/account.ts')
    const table = createTableNode({
      id: makeNodeId('table', 'prisma/schema.prisma', 'tb_account'),
      name: 'tb_account',
      columns: [],
      provenance: { ...provenance, file: 'prisma/schema.prisma', adapter: 'prisma-parser@0.1' },
      confidence: 'inferred',
      inferenceChain: ['prisma: model Account in prisma/schema.prisma', `${ORM_CLASS_PREFIX}Account`],
    })
    expect(buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')).toHaveLength(1)
  })

  it('Prisma 외 ORM 센티넬(JPA 등)로는 파일명 매칭 범위를 넓히지 않는다', () => {
    const route = makeRoute('src/routes/deco-sheet.ts')
    const table = createTableNode({
      id: makeNodeId('table', 'src/DecoSheet.java', 'TB_HODS401'),
      name: 'TB_HODS401',
      columns: [],
      provenance: { ...provenance, file: 'src/DecoSheet.java', adapter: 'jpa-orm-parser@0.1' },
      confidence: 'inferred',
      inferenceChain: ['jpa: @Entity class DecoSheet in src/DecoSheet.java', `${ORM_CLASS_PREFIX}DecoSheet`],
    })
    expect(buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')).toEqual([])
  })
})
